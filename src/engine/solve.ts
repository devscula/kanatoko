// solveSync and createSolveTask (the worker) share one pipeline. It is a generator, and each yield means "this slice is
// used up, hand control back to the worker". solveSync runs it with an unlimited slice.
//
// Diagnostic re-solves are sliced too. diagnostics.ts takes re-solves as a synchronous function (Resolver), so the
// diagnosis is replayed: re-solve results are memoized, a request for one not yet known stops the diagnosis, that
// re-solve then runs in slices, and the diagnosis starts over, getting memoized results at once. The diagnostics budget
// is measured as the sum of the memoized re-solve times, so every replay makes the same decisions; re-solves are what
// the budget is there to bound anyway.

import { GAME_DATA } from '../data/gameData.generated.ts'
import { allInputsBaselineSeed, computeBaseline } from './baseline.ts'
import { PACKED_SLOT_CAPACITY, enchantmentUniverse } from './compile.ts'
import { estimateNormalizedComplexity } from './complexity.ts'
import {
  diagnoseFailure,
  diagnoseStaticFailure,
  keepAlternative,
  staticCapExcluded,
  staticReasons,
  type DiagnosticsContext,
  type Diagnosis,
  type Resolver,
} from './diagnostics.ts'
import { ExactSearch, type ExactOk, type ExactOutcome, type ExactPlan, type ExactSeed, type ExactStats } from './exactSearch.ts'
import { checkAdditive, ineligibleFastPathStats, solveTreeTable, type FastPathStats, type TreeTablePlan } from './fastPath.ts'
import { LIMITS, type Limits } from './limits.ts'
import { normalizeProblem } from './normalize.ts'
import {
  buildPlan,
  discardedEnchantments,
  objectState,
  PlanBuildError,
  planWarnings,
  summarize,
  type ExpectedPlanValues,
  type PlanContext,
} from './planBuilder.ts'
import { anvilObjectOf, canonicalLevels, meetsLevels, renameOnly, SURVIVAL_LEVEL_CAP } from './rules.ts'
import type {
  Assumptions,
  ComplexityEstimate,
  FailureReason,
  MaximalAlternative,
  NormalizedProblem,
  Plan,
  PlanNode,
  Problem,
  ReferencePlan,
  Settings,
  SolveInfeasible,
  SolveMethod,
  SolveOk,
  SolveOptions,
  SolveResult,
  SolveStats,
  SolveTooComplex,
  Warning,
  WarningCode,
  WorkerResponse,
} from './types.ts'
import { validateProblem } from './validate.ts'

/** elapsedMs counts only the time spent inside run(). */
export type SolveTaskProgress = Pick<Extract<WorkerResponse, { type: 'progress' }>, 'phase' | 'done' | 'total' | 'elapsedMs'>

/**
 * Call run(sliceMs) until it returns true, then read result(). After cancel() between runs, the next run returns true
 * and the result is { status: 'cancelled' }.
 */
export interface SolveTask {
  /**
   * Can run slightly over sliceMs: the exact search reads the clock every 512 pairs. Throws on an engine bug, such as a
   * PlanBuildError when the search and the anvil rules disagree.
   */
  run(sliceMs: number): boolean
  result(): SolveResult
  readonly progress: SolveTaskProgress
  cancel(): void
}

export function solveSync(problem: Problem, settings: Settings, options: SolveOptions = {}): SolveResult {
  const task = createSolveTask(problem, settings, options)
  while (!task.run(Number.POSITIVE_INFINITY)) {
    // An unlimited slice finishes in one call; the loop is only a safeguard
  }
  return task.result()
}

/** Nothing is computed until the first run(). */
export function createSolveTask(problem: Problem, settings: Settings, options: SolveOptions = {}): SolveTask {
  return new PipelineTask(problem, settings, options)
}

// Task driver

interface TaskHost {
  remaining(): number                        // ms left in the current slice
  elapsed(): number                          // ms spent inside run() for this task
  setProgress(source: () => PhaseProgress): void
}

type PhaseProgress = Omit<SolveTaskProgress, 'elapsedMs'>

type Steps<T> = Generator<void, T, void>

const now = (): number => performance.now()

class PipelineTask implements SolveTask, TaskHost {
  private readonly steps: Steps<SolveResult>
  private outcome: SolveResult | null = null
  /** The generator is finished after an exception, so later runs rethrow it. */
  private failure: { readonly error: unknown } | null = null
  private cancelRequested = false
  private activeMs = 0
  private inSlice = false
  private sliceStart = 0
  private deadline = 0
  private progressSource: () => PhaseProgress = () => ({ phase: 'fast', done: 0, total: 1 })

  constructor(problem: Problem, settings: Settings, options: SolveOptions) {
    this.steps = solvePipeline(problem, settings, options, this)
  }

  run(sliceMs: number): boolean {
    if (this.failure !== null) throw this.failure.error
    if (this.outcome !== null) return true
    if (this.cancelRequested) {
      this.steps.return({ status: 'cancelled' })
      this.outcome = { status: 'cancelled' }
      return true
    }
    this.inSlice = true
    this.sliceStart = now()
    this.deadline = this.sliceStart + sliceMs
    try {
      const step = this.steps.next()
      if (step.done === true) this.outcome = step.value
    } catch (error) {
      this.failure = { error }
      throw error
    } finally {
      this.activeMs += now() - this.sliceStart
      this.inSlice = false
    }
    return this.outcome !== null
  }

  result(): SolveResult {
    if (this.outcome === null) throw new Error('the solve task has not finished: call run() until it returns true')
    return this.outcome
  }

  get progress(): SolveTaskProgress {
    return { ...this.progressSource(), elapsedMs: this.elapsed() }
  }

  cancel(): void {
    this.cancelRequested = true
  }

  remaining(): number {
    return this.deadline - now()
  }

  elapsed(): number {
    return this.activeMs + (this.inSlice ? now() - this.sliceStart : 0)
  }

  setProgress(source: () => PhaseProgress): void {
    this.progressSource = source
  }
}

// Pipeline

interface Run {
  readonly problem: Problem
  readonly settings: Settings
  readonly options: SolveOptions
  readonly limits: Limits
  readonly np: NormalizedProblem
  readonly rules: PlanContext                // levelCap is levelCapOverride when given
  readonly host: TaskHost
  readonly stats: StatsRecorder
}

interface StatsRecorder {
  fastPath: FastPathStats | null
  exact: ExactStats | null
  diagnosticsMs: number | null
}

function* solvePipeline(problem: Problem, settings: Settings, options: SolveOptions, host: TaskHost): Steps<SolveResult> {
  const limits: Limits = { ...LIMITS, ...options.limits }
  const issues = validateProblem(problem, settings, limits)
  if (issues.length > 0) return { status: 'invalid', issues }

  const np = normalizeProblem(problem, settings)
  const levelCap = options.levelCapOverride !== undefined ? options.levelCapOverride : settings.levelCap
  const run: Run = {
    problem,
    settings,
    options,
    limits,
    np,
    rules: { edition: settings.edition, levelCap, rename: settings.rename },
    host,
    stats: { fastPath: null, exact: null, diagnosticsMs: null },
  }

  const reasons = staticReasons(np, run.rules)
  if (reasons.length > 0) {
    const diagnosis = options.skipDiagnostics === true ? null : yield* diagnose(run, (ctx) => diagnoseStaticFailure(ctx, reasons))
    // Diagnostics are skipped inside diagnostic re-solves, so no suggestion was checked
    const skipped: InfeasibleParts = { reasons, suggestions: [], suggestionsComplete: false, capExcluded: staticCapExcluded(reasons, levelCap), reference: null, warnings: [] }
    return infeasible(run, diagnosis ?? skipped, [])
  }
  if (isEmpty(np, settings)) return { status: 'empty' }

  // forceMethod (tests only) picks the method, so the trivial shortcut is skipped too
  if (options.forceMethod === undefined) {
    const base = trivialBase(np, run.rules, settings.objective)
    if (base !== null) {
      const tree: PlanNode = { t: 'leaf', input: base, preRename: settings.rename }
      return yield* finishOk(run, 'trivial', buildPlan(tree, np, run.rules), [])
    }
  }
  return yield* solveBySearch(run)
}

function isEmpty(np: NormalizedProblem, settings: Settings): boolean {
  return np.targetIndex === null ? np.inputs.length === 0 : np.inputs.length === 1 && !settings.rename
}

/**
 * The base input of a problem that needs no combine step: one input meets a goal with useOnlyNeeded on its own, or it
 * is the only input and rename is on. With rename, its rename-only step must be accepted (Bedrock refuses it above the
 * cap).
 *
 * The shortcut is taken only when it is the plan the exact search would find. On an item, every combine step costs at
 * least the target's prior work penalty + 1 and adds an anvil use, so no step (or just a rename-only step) is best for
 * every objective. In book-only mode a plan on another base can be better: if the book that meets the goal has prior
 * work, renaming during a merge of fresh books (+1) is cheaper, and for objective 'finalPwp' a merged book can end
 * lower. So in book-only mode the shortcut is taken only without rename and with an objective other than 'finalPwp' (no
 * step means a total of 0), or when the chosen book has no prior work (1 level for the rename, PWP 0).
 */
function trivialBase(np: NormalizedProblem, rules: PlanContext, objective: Settings['objective']): number | null {
  const renameAccepted = (index: number): boolean => !rules.rename || renameOnly(anvilObjectOf(np.inputs[index]), rules).ok
  const goal = np.goal
  const meetsGoalAlone = (index: number): boolean => goal !== null && np.useOnlyNeeded && meetsLevels(np.inputs[index].enchantments, goal)
  const onlyInput = np.inputs.length === 1 && rules.rename

  if (np.targetIndex !== null) {
    const target = np.targetIndex
    return (meetsGoalAlone(target) || onlyInput) && renameAccepted(target) ? target : null
  }
  if (onlyInput) return renameAccepted(0) ? 0 : null
  // Book-only: among the books that meet the goal alone, the one with the fewest anvil uses (then the lowest number) is best
  let best: number | null = null
  for (let index = 0; index < np.inputs.length; index++) {
    if (!meetsGoalAlone(index) || !renameAccepted(index)) continue
    if (best === null || np.inputs[index].anvilUses < np.inputs[best].anvilUses) best = index
  }
  if (best === null) return null
  const provablyOptimal = np.inputs[best].anvilUses === 0 || (!rules.rename && objective !== 'finalPwp')
  return provablyOptimal ? best : null
}

function* solveBySearch(run: Run): Steps<SolveResult> {
  const { np, settings, options, limits } = run
  const estimate = estimateNormalizedComplexity(np, capKindOf(settings, run.rules.levelCap), limits)
  const distinct = enchantmentUniverse(np).length
  // The exact search may run when C_eff is within the hard limit and the distinct enchantments fit the packed states
  const exactAllowed = estimate.effectiveComplexity <= estimate.hardLimit
    && distinct <= Math.min(limits.exactMaxDistinctEnchantments, PACKED_SLOT_CAPACITY)

  if (options.forceMethod === 'exact') return yield* exactOrTooComplex(run, estimate, exactAllowed, null)

  run.host.setProgress(() => ({ phase: 'fast', done: 0, total: 1 }))
  const additive = checkAdditive(np, settings, limits)
  if (!additive.eligible) {
    if (options.forceMethod === 'tree-table') {
      throw new Error(`forceMethod 'tree-table' needs an additive problem, but this one is not: ${additive.because}`)
    }
    run.stats.fastPath = ineligibleFastPathStats(additive.because)
    return yield* exactOrTooComplex(run, estimate, exactAllowed, null)
  }

  const fast = solveTreeTable(np, settings, { levelCap: run.rules.levelCap, limits, check: additive })
  run.stats.fastPath = fast.stats
  if (fast.status === 'solved') return yield* finishTreeTable(run, fast.plan, [])
  // Over the cap or a partial tie-break: run the exact search if allowed, never under forceMethod 'tree-table'
  return yield* exactOrTooComplex(run, estimate, exactAllowed && options.forceMethod !== 'tree-table', fast)
}

/**
 * C_eff only depends on whether there is a cap, so a cap override (40 and above in the diagnostics' binary search) maps
 * to the 39 that Settings allows.
 */
function capKindOf(settings: Settings, levelCap: number | null): Settings {
  return { ...settings, levelCap: levelCap === null ? null : SURVIVAL_LEVEL_CAP }
}

type TreeTableFallback = Extract<ReturnType<typeof solveTreeTable>, { status: 'fallback' }>

function* exactOrTooComplex(run: Run, estimate: ComplexityEstimate, exactAllowed: boolean, fast: TreeTableFallback | null): Steps<SolveResult> {
  if (!exactAllowed) return yield* withoutExact(run, estimate, 'complexity-limit', fast, [])

  const seeds: ExactSeed[] = []
  const baselineSeed = allInputsBaselineSeed(run.np, run.rules)
  if (baselineSeed !== null) {
    seeds.push({ totalLevels: baselineSeed.totalLevels, xpPoints: baselineSeed.xpPoints, finalAnvilUses: baselineSeed.finalAnvilUses })
  }
  if (fast !== null && fast.bestWithinCap !== null) seeds.push(fast.bestWithinCap.tree)
  const outcome = yield* runExact(run, seeds)
  run.stats.exact = outcome.stats
  const slow: Warning[] = estimate.effectiveComplexity > run.limits.exactComplexitySoft
    ? [{ code: 'slow-search', complexity: estimate.effectiveComplexity }]
    : []

  switch (outcome.status) {
    case 'ok':
      return yield* finishExact(run, outcome, slow)
    case 'no-plan': {
      const search = { unusableInputs: outcome.partial?.unusedInputs ?? null, noEffectRefusals: outcome.noEffectRefusals }
      const diagnosis = run.options.skipDiagnostics === true ? null : yield* diagnose(run, (ctx) => diagnoseFailure(ctx, search))
      return infeasible(run, diagnosis ?? searchOnlyDiagnosis(search.unusableInputs, run.rules.levelCap), slow)
    }
    case 'aborted':
      return yield* withoutExact(run, estimate, outcome.cause, fast, slow)
  }
}

function* withoutExact(
  run: Run,
  estimate: ComplexityEstimate,
  cause: SolveTooComplex['cause'],
  fast: TreeTableFallback | null,
  warnings: readonly Warning[],
): Steps<SolveResult> {
  if (fast !== null && fast.bestWithinCap !== null) {
    // The total is optimal; the max step, XP and final prior work penalty may not be
    return yield* finishTreeTable(run, fast.bestWithinCap, [...warnings, { code: 'tie-break-partial' }])
  }
  const reference = fast === null ? null : treeTableReference(run, fast.best)
  const result: SolveTooComplex = {
    status: 'too-complex',
    complexity: estimate,
    cause,
    reference,
    ...resultBase(run, warnings),
  }
  return result
}

function* runExact(run: Run, seeds: readonly ExactSeed[]): Steps<ExactOutcome> {
  const search = new ExactSearch(run.np, run.settings, { levelCap: run.rules.levelCap, limits: run.limits, seeds })
  run.host.setProgress(() => {
    const { done, total } = search.progress
    return { phase: 'exact', done, total }
  })
  // The tree-table method can use up the slice (building tables takes tens of milliseconds), so yield before searching
  if (run.host.remaining() <= 0) yield
  while (!search.run(Math.max(0, run.host.remaining()))) yield
  return search.result()
}

// Plans and results

function* finishTreeTable(run: Run, tablePlan: TreeTablePlan, warnings: readonly Warning[]): Steps<SolveOk> {
  const plan = buildPlan(tablePlan.tree, run.np, run.rules, treeTableExpectation(tablePlan))
  return yield* finishOk(run, 'tree-table', plan, warnings)
}

function* finishExact(run: Run, outcome: ExactOk, warnings: readonly Warning[]): Steps<SolveOk> {
  const found = outcome.plan
  const plan = buildPlan(found.tree, run.np, run.rules, {
    totalLevels: found.keys.totalLevels,
    maxStepLevels: found.keys.maxStepLevels,
    xpPoints: found.keys.xpPoints,
    finalAnvilUses: found.final.anvilUses,
  })
  const expectedFinal = objectState(found.final)
  if (JSON.stringify(plan.final) !== JSON.stringify(expectedFinal)) {
    throw new PlanBuildError(`the exact search and the anvil rules disagree on the final object: ${JSON.stringify(expectedFinal)} vs ${JSON.stringify(plan.final)}`)
  }
  const others = outcome.otherMaximal.slice(0, MAX_OTHER_MAXIMAL_RESULTS).map(maximalAlternative)
  const extra: Warning[] = others.length > 0 ? [{ code: 'other-maximal-results', results: others }, ...warnings] : [...warnings]
  return yield* finishOk(run, 'exact', plan, extra)
}

const MAX_OTHER_MAXIMAL_RESULTS = 3

function maximalAlternative(plan: ExactPlan): MaximalAlternative {
  return { enchantments: canonicalLevels(plan.final.enchantments), totalLevels: plan.keys.totalLevels, maxStepLevels: plan.keys.maxStepLevels }
}

function treeTableExpectation(tablePlan: TreeTablePlan): ExpectedPlanValues {
  return {
    stepCosts: tablePlan.stepCosts,
    totalLevels: tablePlan.keys.totalLevels,
    maxStepLevels: tablePlan.keys.maxStepLevels,
    xpPoints: tablePlan.keys.xpPoints,
    finalAnvilUses: tablePlan.finalAnvilUses,
  }
}

function treeTableReference(run: Run, tablePlan: TreeTablePlan): ReferencePlan {
  const plan = buildPlan(tablePlan.tree, run.np, { ...run.rules, levelCap: null }, treeTableExpectation(tablePlan))
  return { plan, summary: summarize(plan, run.np, run.rules), overCap: true }
}

function* finishOk(run: Run, method: SolveMethod, plan: Plan, extraWarnings: readonly Warning[]): Steps<SolveOk> {
  const { np, rules, options } = run
  const summary = summarize(plan, np, rules)
  const discarded = discardedEnchantments(plan, np, rules)
  // keep needs a goal; without one keepAlternative returns null without re-solving
  const keep = discarded.length > 0 && np.goal !== null && options.skipDiagnostics !== true
    ? yield* diagnose(run, (ctx) => keepAlternative(ctx, discarded))
    : null
  const warnings = [...planWarnings(plan, summary, np, rules, keep), ...extraWarnings]
  return {
    status: 'ok',
    method,
    plan,
    summary,
    baseline: options.skipBaseline === true ? null : computeBaseline(np, rules, plan.usedInputs, summary),
    ...resultBase(run, warnings),
  }
}

type InfeasibleParts = Pick<Diagnosis, 'reasons' | 'suggestions' | 'suggestionsComplete' | 'capExcluded' | 'reference' | 'warnings'>

function infeasible(run: Run, diagnosis: InfeasibleParts, warnings: readonly Warning[]): SolveInfeasible {
  return {
    status: 'infeasible',
    reasons: diagnosis.reasons,
    suggestions: diagnosis.suggestions,
    suggestionsComplete: diagnosis.suggestionsComplete,
    capExcluded: diagnosis.capExcluded,
    reference: diagnosis.reference,
    ...resultBase(run, [...diagnosis.warnings, ...warnings]),
  }
}

/**
 * Used inside diagnostic re-solves, which skip diagnostics: only what the search tables show. Without an uncapped
 * re-solve there is no 'too-expensive', but re-solves only look at the status anyway.
 */
function searchOnlyDiagnosis(unusableInputs: readonly number[] | null, levelCap: number | null): InfeasibleParts {
  const reasons: FailureReason[] = unusableInputs !== null && unusableInputs.length > 0
    ? [{ code: 'cannot-use-all-inputs', unusable: unusableInputs }]
    : [{ code: 'no-plan' }]
  return { reasons, suggestions: [], suggestionsComplete: false, capExcluded: levelCap === null, reference: null, warnings: [] }
}

function resultBase(run: Run, warnings: readonly Warning[]): Pick<SolveOk, 'assumptions' | 'warnings' | 'stats'> {
  const all: Warning[] = run.settings.edition === 'bedrock' ? [{ code: 'bedrock-rules-from-wiki' }, ...warnings] : [...warnings]
  const stats: SolveStats = {
    elapsedMs: run.host.elapsed(),
    fastPath: run.stats.fastPath,
    exact: run.stats.exact,
    diagnosticsMs: run.stats.diagnosticsMs,
  }
  return { assumptions: assumptionsFor(run.settings), warnings: sortWarnings(all), stats }
}

/** The UI also needs it for a too-complex estimate that is never solved. */
export function assumptionsFor(settings: Settings): Assumptions {
  return {
    edition: settings.edition,
    levelCap: settings.levelCap,
    objective: settings.objective,
    rulesBasis: settings.edition === 'java' ? 'java-26.3-code' : 'bedrock-26.5x-wiki',
    dataVersion: GAME_DATA.version,
    fullDurability: true,
    xpAssumption: 'exact-levels-per-step',
  }
}

/** The UI places each warning by code, so this order is only for readability and determinism. */
const WARNING_ORDER: Readonly<Record<WarningCode, number>> = {
  'bedrock-rules-from-wiki': 0,
  'bedrock-unverified-value': 1,
  'steps-over-survival-limit': 2,
  'creative-inapplicable-ignored': 3,
  'result-has-extra-enchantments': 4,
  'enchantments-discarded': 5,
  'below-reachable-level': 6,
  'other-maximal-results': 7,
  'final-book-too-expensive-to-apply': 8,
  'inputs-unused': 9,
  'tie-break-partial': 10,
  'slow-search': 11,
}

function sortWarnings(warnings: readonly Warning[]): Warning[] {
  // sort is stable, so warnings with the same code keep their order
  return [...warnings].sort((a, b) => WARNING_ORDER[a.code] - WARNING_ORDER[b.code])
}

// Diagnostics with sliced re-solves

/** Room for 12 suggestions, the binary search, the uncapped re-solve and keep; more is an engine bug. */
const MAX_DIAGNOSTIC_RESOLVES = 64

/** Stops the diagnosis when it asks for a re-solve that is not memoized yet. */
class PendingResolve extends Error {
  override name = 'PendingResolve'
  readonly key: string
  readonly problem: Problem
  readonly settings: Settings
  readonly options: SolveOptions

  constructor(key: string, problem: Problem, settings: Settings, options: SolveOptions) {
    super('a diagnostics re-solve is pending')
    this.key = key
    this.problem = problem
    this.settings = settings
    this.options = options
  }
}

/**
 * body must behave the same for the same re-solve results, which holds for the deterministic functions of
 * diagnostics.ts.
 */
function* diagnose<T>(run: Run, body: (ctx: DiagnosticsContext) => T): Steps<T> {
  const startedAt = run.host.elapsed()
  const budget = run.limits.diagnosticsBudgetMs
  const done = new Map<string, { readonly result: SolveResult; readonly ms: number }>()
  let spentMs = 0
  try {
    for (;;) {
      // A clock that only advances by memoized re-solve times, so every replay sees the same times and decides the same
      let clock = 0
      const resolve: Resolver = (problem, settings, options) => {
        const key = JSON.stringify([problem, settings, options])
        const known = done.get(key)
        if (known === undefined) throw new PendingResolve(key, problem, settings, options)
        clock += known.ms
        return known.result
      }
      run.host.setProgress(() => ({ phase: 'diagnostics', done: Math.min(spentMs, budget), total: budget }))
      let pending: PendingResolve
      try {
        return body({ problem: run.problem, np: run.np, settings: run.settings, options: run.options, resolve, now: () => clock })
      } catch (error) {
        if (!(error instanceof PendingResolve)) throw error
        pending = error
      }
      if (done.size >= MAX_DIAGNOSTIC_RESOLVES) throw new Error(`diagnostics asked for more than ${MAX_DIAGNOSTIC_RESOLVES} re-solves`)
      const task = createSolveTask(pending.problem, pending.settings, pending.options)
      run.host.setProgress(() => ({ phase: 'diagnostics', done: Math.min(spentMs + task.progress.elapsedMs, budget), total: budget }))
      while (!task.run(Math.max(0, run.host.remaining()))) yield
      const ms = task.progress.elapsedMs
      done.set(pending.key, { result: task.result(), ms })
      spentMs += ms
      // Even after a run of short re-solves, yield once the slice is used up
      if (run.host.remaining() <= 0) yield
    }
  } finally {
    run.stats.diagnosticsMs = (run.stats.diagnosticsMs ?? 0) + (run.host.elapsed() - startedAt)
  }
}
