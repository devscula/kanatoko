// Failure reasons, verified suggestions, and the cost of keeping enchantments a plan discards. Suggestions and the keep
// alternative re-solve modified problems and offer only those that produce a plan.
//
// Re-solves go through a function the caller passes in, since solve.ts imports this module and not the other way
// around. Only re-solves that can finish run (isCheap, canCheckSuggestion), suggestions get at most 12 of them, and the
// whole diagnosis stays within diagnosticsBudgetMs. Whenever a candidate goes unchecked, suggestionsComplete is false,
// so that the UI does not claim that no single change helps.

import { areCompatible, isApplicable, isEnchantmentInEdition, multiplier } from '../data/gameData.ts'
import { GAME_DATA } from '../data/gameData.generated.ts'
import type { Edition, EnchantmentId } from '../data/types.ts'
import { inputWeight } from './baseline.ts'
import { estimateComplexity } from './complexity.ts'
import { LIMITS, type Limits } from './limits.ts'
import { groupInputs } from './normalize.ts'
import { summarize } from './planBuilder.ts'
import { levelEntries, meetsLevels, pwp, SURVIVAL_LEVEL_CAP } from './rules.ts'
import type {
  AdvancedProblem,
  DiscardedEnchantment,
  EnchantLevels,
  FailureReason,
  FailureReasonCode,
  KeepAlternative,
  NormalizedProblem,
  Problem,
  ReferencePlan,
  Settings,
  SimpleEnchantmentRequest,
  SimpleProblem,
  SolveOk,
  SolveOptions,
  SolveResult,
  Suggestion,
  Warning,
} from './types.ts'

export const MAX_SUGGESTION_RESOLVES = 12

/** Every static reason but target-penalty-too-high, which the cap causes. */
const CAP_INDEPENDENT_STATIC_REASONS: ReadonlySet<FailureReasonCode> = new Set<FailureReasonCode>([
  'goal-not-in-edition',
  'goal-not-applicable',
  'goal-conflict',
  'goal-conflicts-with-target',
  'goal-enchantment-missing',
  'goal-level-unreachable',
])

/** ok makes a suggestion and the others rule it out; too-complex, cancelled or a spent budget settle nothing. */
const DECIDED_STATUSES: ReadonlySet<SolveResult['status']> = new Set<SolveResult['status']>(['ok', 'infeasible', 'invalid', 'empty'])

/** The cap is passed both in Settings.levelCap and in options.levelCapOverride; the override wins. */
export type Resolver = (problem: Problem, settings: Settings, options: SolveOptions) => SolveResult

export interface DiagnosticsContext {
  readonly problem: Problem
  readonly np: NormalizedProblem
  readonly settings: Settings
  /** Re-solves reuse levelCapOverride and limits, never forceMethod. */
  readonly options?: SolveOptions
  readonly resolve: Resolver
  readonly now?: () => number                // ms, performance.now by default
}

export interface Diagnosis {
  readonly reasons: readonly FailureReason[]
  readonly suggestions: readonly Suggestion[]
  readonly suggestionsComplete: boolean
  readonly capExcluded: boolean
  readonly reference: ReferencePlan | null
  readonly warnings: readonly Warning[]
  readonly elapsedMs: number
}

export interface SearchFailure {
  /**
   * When every input must be used and the full set has no valid root but a smaller subset (with the target, if any) has
   * one: the inputs outside the best such subset. Otherwise null.
   */
  readonly unusableInputs: readonly number[] | null
  /**
   * Some step anywhere in the search was refused only because no level changed, which in Bedrock is an unverified rule.
   * Nothing is re-checked, so this can be true when something else makes the problem infeasible.
   */
  readonly noEffectRefusals?: boolean
}

/** levelCap is widened for SolveOptions.levelCapOverride. */
export type DiagnosticsSettings = Pick<Settings, 'edition' | 'rename'> & { readonly levelCap: number | null }

/**
 * Reasons the goal cannot be met that need no search; the search runs only when there are none. A goal enchantment that
 * is not in the edition or cannot go on the target skips the later checks (conflicts, missing, unreachable): they would
 * mean nothing and would lead to wrong suggestions such as adding a book.
 */
export function staticReasons(np: NormalizedProblem, settings: DiagnosticsSettings): FailureReason[] {
  const { edition } = settings
  const reasons: FailureReason[] = []
  const target = np.targetIndex === null ? null : np.inputs[np.targetIndex]
  const goal = np.goal === null ? [] : levelEntries(np.goal)

  for (const [id] of goal) if (!isEnchantmentInEdition(edition, id)) reasons.push({ code: 'goal-not-in-edition', enchantment: id })
  const inEdition = goal.filter(([id]) => isEnchantmentInEdition(edition, id))
  // In book-only mode the book accepts any enchantment
  const targetType = target?.itemType ?? null
  const applicable = ([id]: readonly [EnchantmentId, number]): boolean => targetType === null || isApplicable(edition, targetType, id)
  for (const entry of inEdition) if (!applicable(entry)) reasons.push({ code: 'goal-not-applicable', enchantment: entry[0] })
  const possible = inEdition.filter(applicable)

  possible.forEach(([a], i) => {
    for (const [b] of possible.slice(i + 1)) if (!areCompatible(edition, a, b)) reasons.push({ code: 'goal-conflict', a, b })
  })
  if (target !== null) {
    for (const [id] of possible) {
      // An anvil never removes enchantments, so an exclusive enchantment on the target stays
      for (const [existing] of levelEntries(target.enchantments)) {
        if (existing !== id && !areCompatible(edition, id, existing)) reasons.push({ code: 'goal-conflicts-with-target', enchantment: id, existing })
      }
    }
  }
  for (const [id, required] of possible) {
    const reachable = np.reachable[id] ?? 0
    if (reachable === 0) reasons.push({ code: 'goal-enchantment-missing', enchantment: id })
    else if (reachable < required) reasons.push({ code: 'goal-level-unreachable', enchantment: id, required, reachable })
  }

  if (target !== null && settings.levelCap !== null && pwp(target.anvilUses) + 1 > settings.levelCap) {
    // Every combine step on the target is refused (in Bedrock, a rename-only step too), so only the target alone can be
    // the answer. A Java rename-only step is clamped to 39 and never refused.
    const goalUnmet = np.goal !== null && !meetsLevels(target.enchantments, np.goal)
    const mustUseOthers = !np.useOnlyNeeded && np.inputs.length > 1
    const bedrockRename = settings.rename && edition === 'bedrock'
    if (goalUnmet || mustUseOthers || bedrockRename) reasons.push({ code: 'target-penalty-too-high', priorWorkPenalty: pwp(target.anvilUses) })
  }
  return reasons
}

/**
 * With a cap, re-solves without it first: if that finds a plan, the reason is 'too-expensive' with that plan as the
 * reference. Unusable inputs reported by the search add 'cannot-use-all-inputs'; with neither reason, it is 'no-plan'.
 */
export function diagnoseFailure(ctx: DiagnosticsContext, search: SearchFailure): Diagnosis {
  const run = new DiagnosticsRun(ctx)
  const cap = run.levelCap
  let reference: ReferencePlan | null = null
  let tooExpensive: Omit<Extract<FailureReason, { code: 'too-expensive' }>, 'minAchievableMaxStep'> | null = null
  // Whether the uncapped re-solve settled; if not, neither 'too-expensive' nor its suggestions can be known
  let uncappedStatus: SolveResult['status'] | null = null
  if (cap !== null) {
    const uncappedResult = run.resolveResult(ctx.problem, null)
    uncappedStatus = uncappedResult?.status ?? null
    const uncapped = uncappedResult?.status === 'ok' ? uncappedResult : null
    const stepsOverCap = uncapped?.plan.steps.filter((step) => step.cost.total > cap).map((step) => step.index) ?? []
    if (uncapped !== null && stepsOverCap.length > 0) {
      // Summarize again under the original cap, which decides whether applying a finished book is too expensive
      reference = { plan: uncapped.plan, summary: summarize(uncapped.plan, ctx.np, { edition: ctx.settings.edition, levelCap: cap }), overCap: true }
      tooExpensive = { code: 'too-expensive', uncappedTotal: uncapped.summary.totalLevels, uncappedMaxStep: uncapped.summary.maxStepLevels, stepsOverCap }
    }
  }
  const unusable = search.unusableInputs !== null && search.unusableInputs.length > 0 ? search.unusableInputs : null

  // Suggestions depend only on the reason codes, so too-expensive does not need minAchievableMaxStep yet
  const provisional: FailureReason[] = []
  if (tooExpensive !== null) provisional.push({ ...tooExpensive, minAchievableMaxStep: null })
  if (unusable !== null) provisional.push({ code: 'cannot-use-all-inputs', unusable })
  if (provisional.length === 0) provisional.push({ code: 'no-plan' })
  const checked = run.suggest(provisional)
  const uncappedDecided = cap === null || (uncappedStatus !== null && DECIDED_STATUSES.has(uncappedStatus))

  const reasons = provisional.map((reason): FailureReason =>
    reason.code === 'too-expensive' ? { ...reason, minAchievableMaxStep: run.minAchievableMaxStep(reason.uncappedMaxStep) } : reason,
  )
  // Bedrock refusing a step that changes nothing is unverified; it matters when every input is forced into the plan
  const warnings: Warning[] = ctx.settings.edition === 'bedrock' && !ctx.np.useOnlyNeeded && search.noEffectRefusals === true
    ? [{ code: 'bedrock-unverified-value', detail: 'no-effect-refused' }]
    : []
  return {
    reasons,
    suggestions: checked.suggestions,
    suggestionsComplete: checked.complete && uncappedDecided,
    // The cap is ruled out only when the uncapped re-solve finished without a plan
    capExcluded: cap === null || uncappedStatus === 'infeasible',
    reference,
    warnings,
    elapsedMs: run.elapsedMs(),
  }
}

export function diagnoseStaticFailure(ctx: DiagnosticsContext, reasons: readonly FailureReason[]): Diagnosis {
  const run = new DiagnosticsRun(ctx)
  const checked = run.suggest(reasons)
  return {
    reasons,
    suggestions: checked.suggestions,
    suggestionsComplete: checked.complete,
    capExcluded: staticCapExcluded(reasons, run.levelCap),
    reference: null,
    warnings: [],
    elapsedMs: run.elapsedMs(),
  }
}

export function staticCapExcluded(reasons: readonly FailureReason[], levelCap: number | null): boolean {
  return levelCap === null || reasons.every((reason) => CAP_INDEPENDENT_STATIC_REASONS.has(reason.code))
}

/**
 * The cost of also keeping the discarded enchantments. Those that can end up on the result and are compatible with the
 * goal and with those already added join the goal, heaviest first, and the problem is re-solved once. null without a
 * goal (a maximal result already keeps what can be kept), when nothing can be added, or when the re-solve is not cheap,
 * runs out of time or finds no plan. Simple mode never discards anything: every input can go on the target and none
 * conflict, or the static reasons stop it.
 */
export function keepAlternative(ctx: DiagnosticsContext, discarded: readonly DiscardedEnchantment[]): KeepAlternative | null {
  const { np, problem } = ctx
  if (np.goal === null || problem.mode !== 'advanced' || problem.goal === null) return null
  const edition = ctx.settings.edition
  const eligible = new Set(np.eligible)
  const candidates = discarded
    .filter((item) => eligible.has(item.id))
    .sort((a, b) => bookWeight(edition, b.id, b.inputLevel) - bookWeight(edition, a.id, a.inputLevel) || dataPosition(a.id) - dataPosition(b.id))
  const kept: EnchantLevels = {}
  const goalIds = levelEntries(np.goal).map(([id]) => id)
  for (const item of candidates) {
    const others = [...goalIds, ...levelEntries(kept).map(([id]) => id)]
    if (others.every((other) => areCompatible(edition, item.id, other))) kept[item.id] = item.inputLevel
  }
  if (levelEntries(kept).length === 0) return null

  const raised: EnchantLevels = { ...problem.goal }
  for (const [id, level] of levelEntries(kept)) raised[id] = Math.max(raised[id] ?? 0, level)
  const run = new DiagnosticsRun(ctx)
  const variant: AdvancedProblem = { ...problem, goal: raised }
  // keep delays an ok result, so it uses the narrower cheapness rule; null only hides the hint and never claims anything wrong
  if (!run.isCheap(variant)) return null
  const result = run.resolve(variant, run.levelCap)
  if (result === null) return null
  return { enchantments: kept, totalLevels: result.summary.totalLevels, maxStepLevels: result.summary.maxStepLevels }
}

class DiagnosticsRun {
  readonly levelCap: number | null
  private readonly ctx: DiagnosticsContext
  private readonly limits: Limits
  private readonly now: () => number
  private readonly startedAt: number

  constructor(ctx: DiagnosticsContext) {
    this.ctx = ctx
    this.limits = { ...LIMITS, ...ctx.options?.limits }
    this.now = ctx.now ?? (() => performance.now())
    this.startedAt = this.now()
    const override = ctx.options?.levelCapOverride
    this.levelCap = override !== undefined ? override : ctx.settings.levelCap
  }

  elapsedMs(): number {
    return this.now() - this.startedAt
  }

  private remainingMs(): number {
    return this.limits.diagnosticsBudgetMs - this.elapsedMs()
  }

  isCheap(problem: Problem): boolean {
    const estimate = estimateComplexity(problem, this.settingsFor(this.levelCap), this.limits)
    return estimate.fastPathEligible || estimate.effectiveComplexity <= this.limits.suggestionMaxComplexity
  }

  /**
   * Besides cheap problems, a goal with useOnlyNeeded and objective levels or xp lets bound pruning finish the exact
   * search quickly, so such problems are checked up to the hard limit.
   */
  private canCheckSuggestion(problem: Problem): boolean {
    const settings = this.settingsFor(this.levelCap)
    const estimate = estimateComplexity(problem, settings, this.limits)
    if (estimate.fastPathEligible || estimate.effectiveComplexity <= this.limits.suggestionMaxComplexity) return true
    const boundedByGoal = problem.mode === 'simple' || (problem.goal !== null && problem.useOnlyNeeded)
    return boundedByGoal && settings.objective !== 'finalPwp' && estimate.level !== 'too-complex'
  }

  resolve(problem: Problem, cap: number | null): SolveOk | null {
    const result = this.resolveResult(problem, cap)
    return result?.status === 'ok' ? result : null
  }

  /** null when the budget is spent. A re-solve gets only what remains of it and ends as too-complex beyond that. */
  resolveResult(problem: Problem, cap: number | null): SolveResult | null {
    const remaining = this.remainingMs()
    if (remaining <= 0) return null
    const options: SolveOptions = {
      levelCapOverride: cap,
      limits: { ...this.ctx.options?.limits, exactTimeBudgetMs: Math.min(this.limits.exactTimeBudgetMs, remaining) },
      skipDiagnostics: true,
      skipBaseline: true,
    }
    return this.ctx.resolve(problem, this.settingsFor(cap), options)
  }

  private settingsFor(cap: number | null): Settings {
    return { ...this.ctx.settings, levelCap: cap === null ? null : SURVIVAL_LEVEL_CAP }
  }

  /**
   * The smallest cap that admits a plan. A cap of uncappedMaxStep always does, and raising the cap only admits more
   * plans, so a binary search works. null when the original problem is not cheap or a re-solve does not settle, since a
   * partial search does not prove a minimum.
   */
  minAchievableMaxStep(uncappedMaxStep: number): number | null {
    if (this.levelCap === null) return null
    const estimate = estimateComplexity(this.ctx.problem, this.ctx.settings, this.limits)
    if (estimate.effectiveComplexity > this.limits.suggestionMaxComplexity) return null
    let low = this.levelCap + 1
    let high = uncappedMaxStep
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      const status = this.resolveResult(this.ctx.problem, middle)?.status
      if (status === 'ok') high = middle
      else if (status === 'infeasible') low = middle + 1
      else return null
    }
    return low
  }

  /**
   * complete is false when some candidate was skipped as too large, left over when the re-solves or the budget ran out,
   * or re-solved without a settled answer.
   */
  suggest(reasons: readonly FailureReason[]): { readonly suggestions: Suggestion[]; readonly complete: boolean } {
    const found: Suggestion[] = []
    let resolves = 0
    let complete = true
    for (const candidate of suggestionCandidates(this.ctx, reasons, this.limits)) {
      if (resolves >= MAX_SUGGESTION_RESOLVES || this.remainingMs() <= 0) {
        complete = false
        break
      }
      if (!this.canCheckSuggestion(candidate.problem)) {
        complete = false
        continue
      }
      resolves++
      const result = this.resolveResult(candidate.problem, this.levelCap)
      if (result?.status === 'ok') found.push(candidate.suggestion(result.summary.totalLevels, result.summary.maxStepLevels))
      else if (result === null || !DECIDED_STATUSES.has(result.status)) complete = false
    }
    // Stable sort: ties keep candidate order (heavier enchantments and inputs first)
    return { suggestions: found.sort((a, b) => a.totalLevels - b.totalLevels || a.maxStepLevels - b.maxStepLevels), complete }
  }
}

interface Candidate {
  readonly key: string                       // so that no candidate is re-solved twice
  readonly problem: Problem
  readonly suggestion: (totalLevels: number, maxStepLevels: number) => Suggestion
}

/** Goal enchantments and inputs are tried heaviest first, so that the likeliest fixes fit in the 12 re-solves. */
function* suggestionCandidates(ctx: DiagnosticsContext, reasons: readonly FailureReason[], limits: Limits): Generator<Candidate> {
  const { problem, np, settings } = ctx
  const edition = settings.edition
  const seen = new Set<string>()
  const goal = np.goal === null ? [] : levelEntries(np.goal)
  const goalByWeight = [...goal].sort(([a, la], [b, lb]) => bookWeight(edition, b, lb) - bookWeight(edition, a, la) || dataPosition(a) - dataPosition(b))
  const everyInputUsed = !np.useOnlyNeeded

  const drop = (id: EnchantmentId): Candidate | null => {
    const variant = withoutGoalEnchantment(problem, id)
    return variant && { key: `drop:${id}`, problem: variant, suggestion: (totalLevels, maxStepLevels) => ({ code: 'drop-goal-enchantment', enchantment: id, totalLevels, maxStepLevels }) }
  }
  const lower = (id: EnchantmentId, level: number): Candidate | null => {
    const variant = withLowerGoalLevel(problem, id, level, limits.maxStackCount)
    return variant && { key: `lower:${id}:${level}`, problem: variant, suggestion: (totalLevels, maxStepLevels) => ({ code: 'lower-goal-level', enchantment: id, level, totalLevels, maxStepLevels }) }
  }
  const addBook = (id: EnchantmentId): Candidate | null => {
    const level = np.goal?.[id]
    const variant = level === undefined ? null : withExtraBook(problem, id, level, limits.maxStackCount)
    return variant && level !== undefined
      ? { key: `add:${id}`, problem: variant, suggestion: (totalLevels, maxStepLevels) => ({ code: 'add-book', enchantment: id, level, totalLevels, maxStepLevels }) }
      : null
  }
  const remove = (input: number): Candidate | null => {
    const variant = withoutInput(problem, np, input)
    return variant && { key: `remove:${input}`, problem: variant, suggestion: (totalLevels, maxStepLevels) => ({ code: 'remove-input', input, totalLevels, maxStepLevels }) }
  }
  const enableUseOnlyNeeded = (): Candidate | null => {
    const variant = withUseOnlyNeeded(problem)
    return variant && { key: 'use-only-needed', problem: variant, suggestion: (totalLevels, maxStepLevels) => ({ code: 'enable-use-only-needed', totalLevels, maxStepLevels }) }
  }
  // Identical inputs are tried once, as the last input of their group; for books that means one copy fewer
  const representatives = (inputs: readonly number[]): number[] => {
    const groupOf = new Map<number, number>()
    groupInputs(np).forEach((group, g) => group.inputs.forEach((input) => groupOf.set(input, g)))
    const chosen = new Map<number, number>()
    for (const input of inputs) chosen.set(groupOf.get(input) ?? -1 - input, input)
    return [...chosen.values()]
  }
  const byInputWeight = (inputs: readonly number[]): number[] =>
    [...inputs].sort((a, b) => inputWeight(np.inputs[b], edition) - inputWeight(np.inputs[a], edition) || a - b)

  const perReason = (reason: FailureReason): (Candidate | null)[] => {
    switch (reason.code) {
      case 'goal-not-in-edition':
      case 'goal-not-applicable':
      case 'goal-conflicts-with-target':
        return [drop(reason.enchantment)]
      case 'goal-conflict':
        return [drop(reason.a), drop(reason.b)]
      case 'goal-enchantment-missing':
        return [addBook(reason.enchantment)]
      case 'goal-level-unreachable':
        return [addBook(reason.enchantment), lower(reason.enchantment, reason.required - 1)]
      case 'too-expensive': {
        const goalChanges = goalByWeight.flatMap(([id, level]) => [drop(id), lower(id, level - 1)])
        if (!everyInputUsed) return goalChanges
        const others = np.inputs.map((_, i) => i).filter((i) => i !== np.targetIndex)
        return [...goalChanges, enableUseOnlyNeeded(), ...byInputWeight(representatives(others)).map(remove)]
      }
      case 'cannot-use-all-inputs':
        return [...representatives(reason.unusable).map(remove), enableUseOnlyNeeded()]
      case 'no-plan':
        // Even without a known reason, dropping one goal enchantment may help (a goal of one enchantment cannot be dropped)
        return goalByWeight.map(([id]) => drop(id))
      case 'target-penalty-too-high':
        return []
    }
  }

  for (const reason of reasons) {
    for (const candidate of perReason(reason)) {
      if (candidate === null || seen.has(candidate.key)) continue
      seen.add(candidate.key)
      yield candidate
    }
  }
}

// Problem edits for suggestions

/** null when it is the only goal enchantment, which would leave nothing to make. */
function withoutGoalEnchantment(problem: Problem, id: EnchantmentId): Problem | null {
  if (problem.mode === 'simple') {
    const rest = problem.enchantments.filter((request) => request.id !== id)
    return rest.length === problem.enchantments.length || rest.length === 0 ? null : { ...problem, enchantments: rest }
  }
  if (problem.goal === null) return null
  const rest = Object.fromEntries(Object.entries(problem.goal).filter(([key, level]) => key !== id && level !== undefined)) as EnchantLevels
  const remaining = levelEntries(rest).length
  return remaining === levelEntries(problem.goal).length || remaining === 0 ? null : { ...problem, goal: rest }
}

/**
 * The UI applies the lower-goal-level suggestion with this same function. Book stacks above level become books of level
 * and merge with any stack already there. A single book of level comes back without sources, the shape the input form
 * uses by default. null when level is out of range or a merged count exceeds maxStackCount.
 */
export function lowerRequestLevel(request: SimpleEnchantmentRequest, level: number, maxStackCount: number): SimpleEnchantmentRequest | null {
  if (level < 1 || level >= request.level) return null
  const counts = new Map<number, number>()
  for (const stack of request.sources ?? [{ level: request.level, count: 1 }]) {
    const at = Math.min(stack.level, level)
    counts.set(at, (counts.get(at) ?? 0) + stack.count)
  }
  if ([...counts.values()].some((count) => count > maxStackCount)) return null
  const sources = [...counts].sort(([a], [b]) => a - b).map(([at, count]) => ({ level: at, count }))
  const single = sources.length === 1 && sources[0].level === level && sources[0].count === 1
  return single ? { id: request.id, level } : { id: request.id, level, sources }
}

function withLowerGoalLevel(problem: Problem, id: EnchantmentId, level: number, maxStackCount: number): SimpleProblem | null {
  if (problem.mode !== 'simple') return null
  const request = problem.enchantments.find((r) => r.id === id)
  const lowered = request === undefined ? null : lowerRequestLevel(request, level, maxStackCount)
  return lowered === null ? null : { ...problem, enchantments: problem.enchantments.map((r) => (r === request ? lowered : r)) }
}

function withExtraBook(problem: Problem, id: EnchantmentId, level: number, maxStackCount: number): Problem | null {
  if (problem.mode === 'advanced') return { ...problem, books: [...problem.books, { enchantments: { [id]: level }, anvilUses: 0 }] }
  const request = problem.enchantments.find((r) => r.id === id)
  if (request === undefined) return null
  const sources = request.sources ?? [{ level: request.level, count: 1 }]
  const same = sources.findIndex((stack) => stack.level === level)
  if (same >= 0 && sources[same].count + 1 > maxStackCount) return null
  const added = same >= 0 ? sources.map((stack, i) => (i === same ? { ...stack, count: stack.count + 1 } : stack)) : [...sources, { level, count: 1 }]
  return { ...problem, enchantments: problem.enchantments.map((r) => (r === request ? { ...r, sources: added } : r)) }
}

function withoutInput(problem: Problem, np: NormalizedProblem, input: number): AdvancedProblem | null {
  if (problem.mode !== 'advanced') return null
  const origin = np.inputs[input]?.origin
  if (origin?.source === 'extra-item') return { ...problem, extraItems: problem.extraItems.filter((_, i) => i !== origin.index) }
  if (origin?.source !== 'book') return null
  const book = problem.books[origin.index]
  const count = book.count ?? 1
  const books = count > 1 ? problem.books.map((b, i) => (i === origin.index ? { ...b, count: count - 1 } : b)) : problem.books.filter((_, i) => i !== origin.index)
  return { ...problem, books }
}

function withUseOnlyNeeded(problem: Problem): AdvancedProblem | null {
  return problem.mode === 'advanced' && problem.goal !== null && !problem.useOnlyNeeded ? { ...problem, useOnlyNeeded: true } : null
}

const DATA_POSITION: ReadonlyMap<EnchantmentId, number> = new Map(GAME_DATA.enchantments.map((e, i) => [e.id, i]))

function dataPosition(id: EnchantmentId): number {
  return DATA_POSITION.get(id) ?? Number.MAX_SAFE_INTEGER
}

/** Only for ordering, so an enchantment outside the edition can count as 0. */
function bookWeight(edition: Edition, id: EnchantmentId, level: number): number {
  return isEnchantmentInEdition(edition, id) ? multiplier(edition, id, 'book') * level : 0
}
