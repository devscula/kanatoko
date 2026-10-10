// Only the keys of the plans are compared, not the plans: on equal keys the search order decides which plan comes back,
// and the engine and the oracle search in different orders.

import { solveExactSync, planKeyVector } from '../../engine/exactSearch.ts'
import { normalizeProblem } from '../../engine/normalize.ts'
import { levelEntries } from '../../engine/rules.ts'
import { solveSync } from '../../engine/solve.ts'
import type {
  AdvancedProblem,
  EnchantLevels,
  FailureReason,
  NormalizedProblem,
  Objective,
  Problem,
  Settings,
  SolveInfeasible,
  SolveOk,
  Suggestion,
} from '../../engine/types.ts'
import { bruteForceSolve, compareKeys, OBJECTIVES, ORACLE_MAX_INPUTS, type OracleMaximal, type OracleResult } from '../oracle/bruteForce.ts'
import { countInputs, type OracleCase } from '../oracle/generators.ts'
import { expectOk, expectPlanProperties, keyVectorOf, warningOf } from './planChecks.ts'

/** Lets tests confirm that the generators produce the intended cases. */
export interface CrossCheckTally {
  cases: number
  solves: number
  ok: number
  infeasible: number
  methods: Record<'tree-table' | 'exact' | 'trivial', number>
  otherMaximal: number
  discarded: number
  keep: number
  tooExpensive: number
  suggestions: number
}

export function createTally(): CrossCheckTally {
  return { cases: 0, solves: 0, ok: 0, infeasible: 0, methods: { 'tree-table': 0, exact: 0, trivial: 0 }, otherMaximal: 0, discarded: 0, keep: 0, tooExpensive: 0, suggestions: 0 }
}

export function crossCheckAll(cases: readonly OracleCase[], tally: CrossCheckTally): void {
  cases.forEach((testCase, index) => {
    try {
      crossCheckWithOracle(testCase, tally)
    } catch (error) {
      throw new Error(`case ${index}: ${JSON.stringify(testCase)}\n${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  })
}

export function crossCheckWithOracle({ problem, settings }: OracleCase, tally: CrossCheckTally): void {
  const oracle = bruteForceSolve(problem, settings)
  const np = normalizeProblem(problem, settings)
  // Everything below relies on the two normalizations agreeing
  expect(np.inputs.map(({ kind, itemType, enchantments, anvilUses }) => ({ kind, itemType, enchantments, anvilUses }))).toEqual(oracle.problem.inputs)
  expect(np.targetIndex).toBe(oracle.problem.targetIndex)
  expect(np.reachable).toEqual(oracle.reachable)
  expect(np.eligible).toEqual(oracle.eligible)
  tally.cases++

  for (const objective of OBJECTIVES) {
    const objectiveSettings: Settings = { ...settings, objective }
    const result = solveSync(problem, objectiveSettings)
    tally.solves++
    if (oracle.best === null) {
      if (result.status !== 'infeasible') throw new Error(`the oracle finds no plan, but solveSync returns ${result.status}`)
      tally.infeasible++
      expectDiagnosis(result, problem, objectiveSettings, np, oracle, tally)
      continue
    }
    const ok = expectOk(result)
    tally.ok++
    tally.methods[ok.method]++
    expect(keyVectorOf(ok, objective)).toEqual(oracle.best[objective].keys)
    expectPlanProperties(ok, { problem, settings: objectiveSettings })
    if (np.goal === null) expectMaximalResults(ok, oracle, objective, tally)
    expectKeep(ok, problem, objectiveSettings, tally)
  }
  if (np.goal === null && oracle.maximal !== null) expectExactMaximalSet(np, settings, oracle.maximal)
}

export function vectorKey(levels: EnchantLevels): string {
  return levelEntries(levels).map(([id, level]) => `${id}=${level}`).join(',')
}

/** The chosen result and up to three other-maximal-results are the oracle's maximal results with the smallest keys. */
function expectMaximalResults(ok: SolveOk, oracle: OracleResult, objective: Objective, tally: CrossCheckTally): void {
  const maximal = oracle.maximal ?? []
  const byVector = new Map(maximal.map((m) => [vectorKey(m.enchantments), m]))
  const others = warningOf(ok, 'other-maximal-results')?.results ?? []
  if (others.length > 0) tally.otherMaximal++
  const listed = [ok.summary.finalEnchantments, ...others.map((alt) => alt.enchantments)]
  expect(listed).toHaveLength(Math.min(maximal.length, 4))
  expect(new Set(listed.map(vectorKey)).size).toBe(listed.length)

  const listedMaximal = listed.map((levels): OracleMaximal => {
    const found = byVector.get(vectorKey(levels))
    if (found === undefined) throw new Error(`${vectorKey(levels)} is not a maximal result of the oracle: ${[...byVector.keys()].join(' | ')}`)
    return found
  })
  others.forEach((alt, i) => {
    const best = listedMaximal[i + 1].best[objective].planKeys
    expect([alt.totalLevels, alt.maxStepLevels]).toEqual([best.totalLevels, best.maxStepLevels])
  })
  // Listed in key order, and none has a larger key than any unlisted result
  const keys = listedMaximal.map((m) => m.best[objective].keys)
  for (let i = 1; i < keys.length; i++) expect(compareKeys(keys[i - 1], keys[i])).toBeLessThanOrEqual(0)
  const listedKeys = new Set(listed.map(vectorKey))
  for (const m of maximal) {
    if (!listedKeys.has(vectorKey(m.enchantments))) expect(compareKeys(keys[keys.length - 1], m.best[objective].keys)).toBeLessThanOrEqual(0)
  }
  // If some plan reaches U(E) on every eligible enchantment, the chosen final object does too
  if (oracle.reachesAllReachable === true) {
    for (const id of oracle.eligible) expect(ok.summary.finalEnchantments[id] ?? 0).toBeGreaterThanOrEqual(oracle.reachable[id] ?? 0)
  }
  // below-reachable-level lists the eligible enchantments below U(E), except those discarded
  const discarded = new Set(warningOf(ok, 'enchantments-discarded')?.items.map((item) => item.id) ?? [])
  const below = oracle.eligible
    .filter((id) => (ok.summary.finalEnchantments[id] ?? 0) < (oracle.reachable[id] ?? 0) && !discarded.has(id))
  expect(warningOf(ok, 'below-reachable-level')?.items.map((item) => item.id) ?? []).toEqual(below)
}

function expectExactMaximalSet(np: NormalizedProblem, settings: Settings, maximal: readonly OracleMaximal[]): void {
  const outcome = solveExactSync(np, settings)
  if (outcome.status !== 'ok') {
    expect(maximal).toEqual([])
    return
  }
  const engine = [outcome.plan, ...outcome.otherMaximal].map((plan) => [vectorKey(plan.final.enchantments), planKeyVector(plan.keys, settings.objective)] as const)
  const oracle = maximal.map((m) => [vectorKey(m.enchantments), m.best[settings.objective].keys] as const)
  const sortByVector = <T extends readonly [string, unknown]>(list: readonly T[]): T[] => [...list].sort((a, b) => a[0].localeCompare(b[0]))
  expect(sortByVector(engine)).toEqual(sortByVector(oracle))
}

/** The keep alternative costs the same as the oracle's solution with the goal raised to keep those enchantments. */
function expectKeep(ok: SolveOk, problem: Problem, settings: Settings, tally: CrossCheckTally): void {
  const discarded = warningOf(ok, 'enchantments-discarded')
  if (discarded === undefined) return
  tally.discarded++
  const keep = discarded.keep
  if (keep === null || problem.mode !== 'advanced' || problem.goal === null) return
  tally.keep++
  const goal: EnchantLevels = { ...problem.goal }
  for (const [id, level] of levelEntries(keep.enchantments)) goal[id] = Math.max(goal[id] ?? 0, level)
  const raised = bruteForceSolve({ ...problem, goal }, settings)
  if (raised.best === null) throw new Error('keep is set, but the oracle cannot keep those enchantments')
  const best = raised.best[settings.objective].planKeys
  expect([keep.totalLevels, keep.maxStepLevels]).toEqual([best.totalLevels, best.maxStepLevels])
}

function expectDiagnosis(result: SolveInfeasible, problem: Problem, settings: Settings, np: NormalizedProblem, oracle: OracleResult, tally: CrossCheckTally): void {
  expect(result.reasons.length).toBeGreaterThan(0)
  for (const reason of result.reasons) expectReasonConsistent(reason, np, oracle)

  const tooExpensive = result.reasons.find((reason): reason is Extract<FailureReason, { code: 'too-expensive' }> => reason.code === 'too-expensive')
  if (settings.levelCap !== null) {
    const uncapped = bruteForceSolve(problem, settings, { levelCapOverride: null })
    // too-expensive is reported exactly when the problem becomes feasible without the cap
    expect(tooExpensive !== undefined).toBe(uncapped.best !== null)
    if (tooExpensive !== undefined && uncapped.best !== null) {
      tally.tooExpensive++
      const best = uncapped.best[settings.objective].planKeys
      expect([tooExpensive.uncappedTotal, tooExpensive.uncappedMaxStep]).toEqual([best.totalLevels, best.maxStepLevels])
      const reference = result.reference
      if (reference === null) throw new Error('too-expensive needs the uncapped plan as reference')
      expect(reference.summary.totalLevels).toBe(tooExpensive.uncappedTotal)
      expect(tooExpensive.stepsOverCap.length).toBeGreaterThan(0)
      for (const step of tooExpensive.stepsOverCap) expect(reference.plan.steps[step - 1].cost.total).toBeGreaterThan(settings.levelCap)
      // A small problem always gets the smallest workable cap: feasible at that cap, infeasible one below
      const min = tooExpensive.minAchievableMaxStep
      if (min === null) throw new Error('minAchievableMaxStep must be found for a small problem')
      expect(bruteForceSolve(problem, settings, { levelCapOverride: min }).best).not.toBeNull()
      if (min - 1 > settings.levelCap) expect(bruteForceSolve(problem, settings, { levelCapOverride: min - 1 }).best).toBeNull()
    }
  } else {
    expect(tooExpensive).toBeUndefined()
  }

  // Applying a suggestion makes the problem feasible at the total and max it states
  for (const suggestion of result.suggestions) {
    const variant = applySuggestion(problem, np, suggestion)
    // An added book can take the problem past what the oracle can enumerate
    if (countInputs(variant) > ORACLE_MAX_INPUTS) continue
    tally.suggestions++
    const solved = bruteForceSolve(variant, settings)
    if (solved.best === null) throw new Error(`suggestion ${JSON.stringify(suggestion)} does not make the problem solvable`)
    const best = solved.best[settings.objective].planKeys
    expect([suggestion.totalLevels, suggestion.maxStepLevels]).toEqual([best.totalLevels, best.maxStepLevels])
  }
  for (let i = 1; i < result.suggestions.length; i++) {
    const [a, b] = [result.suggestions[i - 1], result.suggestions[i]]
    expect(a.totalLevels < b.totalLevels || (a.totalLevels === b.totalLevels && a.maxStepLevels <= b.maxStepLevels)).toBe(true)
  }
}

/** Reasons found before searching agree with the oracle's reachable levels. */
function expectReasonConsistent(reason: FailureReason, np: NormalizedProblem, oracle: OracleResult): void {
  const goal = np.goal ?? {}
  switch (reason.code) {
    case 'goal-enchantment-missing':
      expect(oracle.reachable[reason.enchantment] ?? 0).toBe(0)
      break
    case 'goal-level-unreachable':
      expect(reason.reachable).toBe(oracle.reachable[reason.enchantment])
      expect(reason.required).toBe(goal[reason.enchantment])
      expect(reason.reachable).toBeLessThan(reason.required)
      break
    case 'target-penalty-too-high':
      expect(np.targetIndex).not.toBeNull()
      expect(reason.priorWorkPenalty).toBe(2 ** np.inputs[0].anvilUses - 1)
      break
    case 'cannot-use-all-inputs':
      expect(np.useOnlyNeeded).toBe(false)
      expect(reason.unusable.length).toBeGreaterThan(0)
      for (const input of reason.unusable) expect(input).not.toBe(np.targetIndex)
      break
    default:
      break
  }
}

/** Written independently of diagnostics.ts. */
export function applySuggestion(problem: Problem, np: NormalizedProblem, suggestion: Suggestion): Problem {
  switch (suggestion.code) {
    case 'drop-goal-enchantment':
      if (problem.mode === 'simple') return { ...problem, enchantments: problem.enchantments.filter((r) => r.id !== suggestion.enchantment) }
      return { ...problem, goal: Object.fromEntries(levelEntries(problem.goal ?? {}).filter(([id]) => id !== suggestion.enchantment)) }
    case 'lower-goal-level': {
      if (problem.mode !== 'simple') throw new Error('lower-goal-level is offered only in simple mode')
      const { enchantment, level } = suggestion
      return {
        ...problem,
        enchantments: problem.enchantments.map((r) => r.id !== enchantment ? r : {
          id: r.id,
          level,
          ...(r.sources === undefined ? {} : { sources: r.sources.map((s) => ({ ...s, level: Math.min(s.level, level) })) }),
        }),
      }
    }
    case 'add-book': {
      const { enchantment, level } = suggestion
      if (problem.mode === 'advanced') return { ...problem, books: [...problem.books, { enchantments: { [enchantment]: level }, anvilUses: 0 }] }
      return {
        ...problem,
        enchantments: problem.enchantments.map((r) => r.id !== enchantment ? r : { ...r, sources: [...(r.sources ?? [{ level: r.level, count: 1 }]), { level, count: 1 }] }),
      }
    }
    case 'remove-input':
      return withoutInput(problem, np, suggestion.input)
    case 'enable-use-only-needed':
      if (problem.mode !== 'advanced') throw new Error('enable-use-only-needed is offered only in advanced mode')
      return { ...problem, useOnlyNeeded: true }
  }
}

function withoutInput(problem: Problem, np: NormalizedProblem, input: number): AdvancedProblem {
  if (problem.mode !== 'advanced') throw new Error('remove-input is offered only in advanced mode')
  const origin = np.inputs[input].origin
  if (origin.source === 'extra-item') return { ...problem, extraItems: problem.extraItems.filter((_, i) => i !== origin.index) }
  if (origin.source !== 'book') throw new Error(`remove-input names input ${input}, which is not a book or a spare item`)
  const books = problem.books.flatMap((book, i) => {
    if (i !== origin.index) return [book]
    const count = (book.count ?? 1) - 1
    return count === 0 ? [] : [{ ...book, count }]
  })
  return { ...problem, books }
}
