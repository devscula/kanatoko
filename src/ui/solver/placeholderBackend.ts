// Returns fixtures from src/ui/dev/fixtures.ts when the input matches one, and otherwise a plausible but not
// necessarily optimal plan built with the same simplified rules.

import { LIMITS } from '../../engine/index.ts'
import type {
  ClientResult,
  ComplexityEstimate,
  EnchantLevels,
  EngineInput,
  PlanNode,
  Problem,
  Settings,
  SolveProgress,
  SolverClient,
  SolveResult,
} from '../../engine/index.ts'
import {
  buildFixturePlan,
  findFixture,
  fixtureAssumptions,
  fixtureOk,
  fixtureReference,
  getFixture,
  isFixtureName,
  leaf,
  node,
  simCombine,
  type FixtureName,
  type SimObject,
} from '../dev/fixtures.ts'
import { goalOf } from '../plan/displayPlan.ts'
import { listProblemInputs } from '../plan/inputs.ts'
import { multiplier } from '../../data/gameData.ts'
import type { SolverBackend } from './types.ts'

export interface PlaceholderOptions {
  readonly delayMs?: number
  /** Always returns this fixture */
  readonly fixture?: FixtureName | null
}

/** Reads ?fixture=<name> and ?delay=<ms>. Null when neither is present, so the real solver is used. */
export function placeholderOptionsFromSearch(search: string): PlaceholderOptions | null {
  const params = new URLSearchParams(search)
  if (!params.has('fixture') && !params.has('delay')) return null
  const fixture = params.get('fixture')
  const delay = Number(params.get('delay'))
  return {
    fixture: fixture !== null && isFixtureName(fixture) ? fixture : null,
    delayMs: Number.isFinite(delay) && delay > 0 ? delay : undefined,
  }
}

const toSim = (input: EngineInput): SimObject => ({
  kind: input.kind,
  itemType: input.itemType,
  enchantments: input.enchantments,
  anvilUses: input.anvilUses,
  named: false,
})

function weight(settings: Settings, input: EngineInput): number {
  return Object.entries(input.enchantments).reduce(
    (sum, [id, level]) => sum + multiplier(settings.edition, id as never, input.kind) * (level ?? 0),
    0,
  )
}

/** A rough copy of the engine's estimate, as the fixtures use it */
export function placeholderEstimate(problem: Problem, settings: Settings): ComplexityEstimate {
  const inputs = listProblemInputs(problem)
  const hasTarget = problem.mode === 'simple' ? problem.item !== 'enchanted_book' : problem.target !== null
  const groups = new Map<string, number>()
  inputs.slice(hasTarget ? 1 : 0).forEach((input) => {
    const key = JSON.stringify([input.kind, input.enchantments, input.anvilUses])
    groups.set(key, (groups.get(key) ?? 0) + 1)
  })
  let complexity = hasTarget ? 2 : 1
  for (const count of groups.values()) complexity *= ((count + 1) * (count + 2)) / 2
  const effective = complexity * (settings.rename ? 2 : 1) * (settings.levelCap === null ? 2 : 1)
  const goal = goalOf(problem)
  const useOnlyNeeded = problem.mode === 'simple' || (goal !== null && problem.useOnlyNeeded)
  const hardLimit = useOnlyNeeded ? LIMITS.exactComplexityHard : LIMITS.exactComplexityHardUseAll
  const fastPathEligible =
    settings.objective === 'levels' &&
    inputs.every((i) => i.kind === 'book' || i === inputs[0]) &&
    inputs.filter((i) => i.kind === 'book').every((i) => i.anvilUses === 0) &&
    inputs.filter((i) => i.kind === 'book').length <= LIMITS.fastPathMaxBooks
  const level: ComplexityEstimate['level'] =
    effective <= 40_000 || (fastPathEligible && inputs.length <= 11)
      ? 'instant'
      : effective <= LIMITS.exactComplexitySoft
        ? 'ok'
        : effective <= hardLimit || fastPathEligible
          ? 'slow'
          : 'too-complex'
  return { complexity, effectiveComplexity: effective, fastPathEligible, level, hardLimit }
}

/**
 * The heaviest book goes on first; the rest are paired heavy with light into combined books that are applied
 * afterward. With a goal and useOnlyNeeded, only inputs carrying a goal enchantment are used.
 */
export function synthesizeResult(problem: Problem, settings: Settings): SolveResult {
  const inputs = listProblemInputs(problem)
  const hasTarget = problem.mode === 'simple' ? problem.item !== 'enchanted_book' : problem.target !== null
  const goal = goalOf(problem)
  const useOnlyNeeded = problem.mode === 'simple' || (goal !== null && problem.useOnlyNeeded)
  const targetLevels: EnchantLevels = hasTarget ? inputs[0].enchantments : {}

  const candidates = inputs
    .map((_, i) => i)
    .filter((i) => !(hasTarget && i === 0))
    .filter((i) => {
      if (!useOnlyNeeded || goal === null) return true
      return Object.entries(inputs[i].enchantments).some(([id, level]) => {
        const wanted = goal[id as keyof EnchantLevels]
        return wanted !== undefined && (targetLevels[id as keyof EnchantLevels] ?? 0) < wanted && (level ?? 0) > 0
      })
    })
    .sort((a, b) => weight(settings, inputs[b]) - weight(settings, inputs[a]) || a - b)
  if (candidates.length === 0 && (!settings.rename || !hasTarget)) return { status: 'empty' }

  const base = hasTarget ? 0 : candidates.shift()!
  const uncapped: Settings = { ...settings, levelCap: null }

  // Skip inputs the anvil would refuse, such as a book with only incompatible enchantments
  let current = toSim(inputs[base])
  const usable: number[] = []
  for (const i of candidates) {
    const out = simCombine(uncapped, current, toSim(inputs[i]), false)
    if (out.ok) {
      usable.push(i)
      current = out.result
    }
  }

  let tree: PlanNode = leaf(base, settings.rename && inputs[base].anvilUses === 0)
  const [first, ...rest] = usable
  if (first !== undefined) tree = node(tree, leaf(first))
  while (rest.length > 1) {
    const heavy = rest.shift()!
    const light = rest.pop()!
    tree = node(tree, node(leaf(heavy), leaf(light)))
  }
  if (rest.length === 1) tree = node(tree, leaf(rest[0]))
  if (settings.rename && inputs[base].anvilUses > 0 && tree.t === 'combine') tree = { ...tree, rename: true }

  let plan: ReturnType<typeof buildFixturePlan>
  try {
    plan = buildFixturePlan(problem, uncapped, tree)
  } catch {
    return { status: 'infeasible', reasons: [{ code: 'no-plan' }], suggestions: [], suggestionsComplete: true, capExcluded: settings.levelCap === null, reference: null, assumptions: fixtureAssumptions(settings), warnings: [], stats: { elapsedMs: 1, fastPath: null, exact: null, diagnosticsMs: null } }
  }

  if (goal !== null) {
    const final = plan.summary.finalEnchantments
    for (const [id, level] of Object.entries(goal) as [keyof EnchantLevels, number][]) {
      if ((final[id] ?? 0) >= level) continue
      const carriers = inputs.some((input) => (input.enchantments[id] ?? 0) > 0)
      return {
        status: 'infeasible',
        reasons: [
          carriers
            ? { code: 'goal-level-unreachable', enchantment: id, required: level, reachable: final[id] ?? 0 }
            : { code: 'goal-enchantment-missing', enchantment: id },
        ],
        suggestions: [],
        suggestionsComplete: true,
        capExcluded: true,
        reference: null,
        assumptions: fixtureAssumptions(settings),
        warnings: [],
        stats: { elapsedMs: 1, fastPath: null, exact: null, diagnosticsMs: 1 },
      }
    }
  }

  const overCap = plan.plan.steps.filter((s) => s.cost.total >= 40)
  if (settings.levelCap !== null && overCap.length > 0) {
    return {
      status: 'infeasible',
      reasons: [
        {
          code: 'too-expensive',
          uncappedTotal: plan.summary.totalLevels,
          uncappedMaxStep: plan.summary.maxStepLevels,
          stepsOverCap: overCap.map((s) => s.index),
          minAchievableMaxStep: null,
        },
      ],
      suggestions: [],
      suggestionsComplete: true,
      capExcluded: false,
      reference: fixtureReference(problem, settings, tree),
      assumptions: fixtureAssumptions(settings),
      warnings: [],
      stats: { elapsedMs: 1, fastPath: null, exact: null, diagnosticsMs: 1 },
    }
  }
  return fixtureOk(problem, settings, tree, { method: 'exact' })
}

export function placeholderSolve(problem: Problem, settings: Settings, forced: FixtureName | null): SolveResult {
  if (forced !== null) return getFixture(forced).result
  return findFixture(problem, settings)?.result ?? synthesizeResult(problem, settings)
}

/** Keeps the SolverClient contract: every request except the latest resolves as cancelled, and each Promise resolves once. */
export function createPlaceholderClient(options: PlaceholderOptions = {}): SolverClient {
  const delayMs = options.delayMs ?? 120
  const forced = options.fixture ?? null
  let nextId = 1
  let latest: { id: number; resolve: (r: ClientResult) => void; timers: ReturnType<typeof setTimeout>[] } | null = null

  const settle = (result: ClientResult) => {
    if (latest === null) return
    const { resolve, timers } = latest
    for (const timer of timers) clearTimeout(timer)
    latest = null
    resolve(result)
  }

  return {
    solve(problem, settings, onProgress) {
      settle({ status: 'cancelled' })
      return new Promise<ClientResult>((resolve) => {
        const id = nextId++
        const timers: ReturnType<typeof setTimeout>[] = []
        latest = { id, resolve, timers }
        const ticks = Math.floor(delayMs / LIMITS.progressIntervalMs)
        for (let i = 1; i <= ticks; i++) {
          timers.push(
            setTimeout(() => {
              const progress: SolveProgress = { type: 'progress', id, phase: 'exact', done: i, total: ticks + 1, elapsedMs: i * LIMITS.progressIntervalMs }
              onProgress?.(progress)
            }, i * LIMITS.progressIntervalMs),
          )
        }
        timers.push(
          setTimeout(() => {
            let result: ClientResult
            try {
              result = placeholderSolve(problem, settings, forced)
            } catch (error) {
              result = { status: 'error', cause: 'engine-exception', message: String(error), retryable: true }
            }
            settle(result)
          }, delayMs),
        )
      })
    },
    cancel() {
      settle({ status: 'cancelled' })
    },
    dispose() {
      settle({ status: 'cancelled' })
    },
  }
}

export function createPlaceholderBackend(options: PlaceholderOptions = {}): SolverBackend {
  const forced = options.fixture ?? null
  return {
    client: createPlaceholderClient(options),
    estimateComplexity(problem, settings) {
      if (forced !== null) return getFixture(forced).estimate
      return findFixture(problem, settings)?.estimate ?? placeholderEstimate(problem, settings)
    },
  }
}
