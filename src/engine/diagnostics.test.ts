// The diagnostics take the re-solve function as an argument, so these tests pass exhaustiveSolve, which tries every tree, to
// check the suggested numbers independently of the engine's search.
import type { EnchantmentId } from '../data/types.ts'
import { GAME_DATA } from '../data/gameData.generated.ts'
import {
  diagnoseFailure,
  diagnoseStaticFailure,
  keepAlternative,
  MAX_SUGGESTION_RESOLVES,
  staticReasons,
  type DiagnosticsContext,
  type Resolver,
} from './diagnostics.ts'
import { LIMITS } from './limits.ts'
import { normalizeProblem } from './normalize.ts'
import { buildPlan, summarize } from './planBuilder.ts'
import { anvilObjectOf, combine, levelEntries, renameOnly, type AnvilObject } from './rules.ts'
import {
  OBJECTIVE_KEYS,
  type AdvancedProblem,
  type DiscardedEnchantment,
  type FailureReason,
  type NormalizedProblem,
  type PlanKeys,
  type PlanNode,
  type Problem,
  type Settings,
  type SimpleProblem,
  type SolveOptions,
  type SolveResult,
} from './types.ts'
import { validateProblem } from './validate.ts'
import { xpAtLevel } from './xp.ts'

const java: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
const bedrock: Settings = { ...java, edition: 'bedrock' }

const advanced = (overrides: Partial<AdvancedProblem>): AdvancedProblem =>
  ({ mode: 'advanced', target: null, extraItems: [], books: [], goal: null, useOnlyNeeded: true, ...overrides })
const leaf = (input: number, preRename = false): PlanNode => ({ t: 'leaf', input, preRename })
const node = (left: PlanNode, right: PlanNode, rename = false): PlanNode => ({ t: 'combine', left, right, rename })

const RESULT_BASE = {
  assumptions: {
    edition: 'java', levelCap: 39, objective: 'levels', rulesBasis: 'java-26.3-code', dataVersion: GAME_DATA.version,
    fullDurability: true, xpAssumption: 'exact-levels-per-step',
  },
  warnings: [],
  stats: { elapsedMs: 0, fastPath: null, exact: null, diagnosticsMs: null },
} as const

function* permutations(items: readonly number[]): Generator<number[]> {
  if (items.length <= 1) {
    yield [...items]
    return
  }
  for (let i = 0; i < items.length; i++) {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest]
  }
}

function* shapes(leaves: readonly number[]): Generator<PlanNode> {
  if (leaves.length === 1) {
    yield leaf(leaves[0])
    return
  }
  for (let k = 1; k < leaves.length; k++) {
    for (const left of shapes(leaves.slice(0, k))) for (const right of shapes(leaves.slice(k))) yield node(left, right)
  }
}

/** Every place for the rename: a rename-only step on the base leaf, or +1 on exactly one step of the target lineage. */
function renameVariants(tree: PlanNode): PlanNode[] {
  const pre = (n: PlanNode): PlanNode => (n.t === 'leaf' ? leaf(n.input, true) : node(pre(n.left), n.right))
  const variants = [pre(tree)]
  let spine = 0
  for (let n = tree; n.t === 'combine'; n = n.left) spine++
  for (let k = 0; k < spine; k++) {
    const mark = (n: PlanNode, depth: number): PlanNode => (n.t === 'leaf' ? n : node(mark(n.left, depth + 1), n.right, depth === k))
    variants.push(mark(tree, 0))
  }
  return variants
}

function evaluate(tree: PlanNode, np: NormalizedProblem, edition: Settings['edition'], levelCap: number | null): { obj: AnvilObject; costs: number[] } | null {
  if (tree.t === 'leaf') {
    const obj = anvilObjectOf(np.inputs[tree.input])
    if (!tree.preRename) return { obj, costs: [] }
    const outcome = renameOnly(obj, { edition, levelCap })
    return outcome.ok ? { obj: outcome.result, costs: [outcome.cost] } : null
  }
  const left = evaluate(tree.left, np, edition, levelCap)
  const right = left && evaluate(tree.right, np, edition, levelCap)
  if (left === null || right === null) return null
  const outcome = combine(left.obj, right.obj, { edition, levelCap, rename: tree.rename })
  return outcome.ok ? { obj: outcome.result, costs: [...left.costs, ...right.costs, outcome.cost] } : null
}

/**
 * Tries every allowed subset, leaf order, tree shape and rename position. Without a goal, only the maximal results
 * compete.
 */
const exhaustiveSolve: Resolver = (problem: Problem, settings: Settings, options: SolveOptions): SolveResult => {
  const issues = validateProblem(problem, settings)
  if (issues.length > 0) return { status: 'invalid', issues }
  const np = normalizeProblem(problem, settings)
  const levelCap = options.levelCapOverride !== undefined ? options.levelCapOverride : settings.levelCap
  const others = np.inputs.map((_, i) => i).filter((i) => i !== np.targetIndex)
  if (others.length === 0 && (np.targetIndex === null || !settings.rename)) return { status: 'empty' }

  const subsets: number[][] = []
  if (np.useOnlyNeeded) {
    for (let mask = 1; mask < 1 << np.inputs.length; mask++) {
      const subset = np.inputs.map((_, i) => i).filter((i) => (mask & (1 << i)) !== 0)
      if (np.targetIndex === null || subset.includes(np.targetIndex)) subsets.push(subset)
    }
  } else {
    subsets.push(np.inputs.map((_, i) => i))
  }

  const found: { tree: PlanNode; keys: PlanKeys; final: AnvilObject['enchantments'] }[] = []
  for (const subset of subsets) {
    const orders = np.targetIndex === null
      ? [...permutations(subset)]
      : [...permutations(subset.filter((i) => i !== np.targetIndex))].map((rest) => [np.targetIndex as number, ...rest])
    for (const order of orders) {
      for (const shape of shapes(order)) {
        for (const tree of settings.rename ? renameVariants(shape) : [shape]) {
          const result = evaluate(tree, np, settings.edition, levelCap)
          if (result === null || result.obj.named !== settings.rename) continue
          if (np.goal !== null && !levelEntries(np.goal).every(([id, level]) => (result.obj.enchantments[id] ?? 0) >= level)) continue
          found.push({
            tree,
            final: result.obj.enchantments,
            keys: {
              totalLevels: result.costs.reduce((a, b) => a + b, 0),
              maxStepLevels: Math.max(0, ...result.costs),
              xpPoints: result.costs.reduce((sum, cost) => sum + xpAtLevel(cost), 0),
              finalPriorWorkPenalty: 2 ** result.obj.anvilUses - 1,
              inputsUsed: subset.length,
            },
          })
        }
      }
    }
  }
  const beats = (a: typeof found[number]['final'], b: typeof found[number]['final']): boolean => {
    const ids = new Set([...Object.keys(a), ...Object.keys(b)] as EnchantmentId[])
    let greater = false
    for (const id of ids) {
      if ((a[id] ?? 0) < (b[id] ?? 0)) return false
      if ((a[id] ?? 0) > (b[id] ?? 0)) greater = true
    }
    return greater
  }
  const qualifying = np.goal !== null ? found : found.filter((plan) => !found.some((other) => beats(other.final, plan.final)))
  const order = OBJECTIVE_KEYS[settings.objective]
  const best = qualifying.reduce<typeof found[number] | null>((incumbent, plan) => {
    if (incumbent === null) return plan
    for (const key of order) if (plan.keys[key] !== incumbent.keys[key]) return plan.keys[key] < incumbent.keys[key] ? plan : incumbent
    return incumbent
  }, null)
  if (best === null) return { ...RESULT_BASE, status: 'infeasible', reasons: [{ code: 'no-plan' }], suggestions: [], suggestionsComplete: false, capExcluded: false, reference: null }
  const plan = buildPlan(best.tree, np, { edition: settings.edition, levelCap, rename: settings.rename })
  return { ...RESULT_BASE, status: 'ok', method: 'exact', plan, summary: summarize(plan, np, { edition: settings.edition, levelCap }), baseline: null }
}

/** Records every re-solve call, so that tests can check the cap override and the options. */
function recording(resolve: Resolver = exhaustiveSolve): { resolve: Resolver; calls: { problem: Problem; settings: Settings; options: SolveOptions }[] } {
  const calls: { problem: Problem; settings: Settings; options: SolveOptions }[] = []
  return {
    calls,
    resolve: (problem, settings, options) => {
      calls.push({ problem, settings, options })
      return resolve(problem, settings, options)
    },
  }
}

function context(problem: Problem, settings: Settings, overrides: Partial<DiagnosticsContext> = {}): DiagnosticsContext {
  return { problem, np: normalizeProblem(problem, settings), settings, resolve: exhaustiveSolve, ...overrides }
}

/**
 * The 'infeasible' UI fixture: pickaxe{Unbreaking III} with 5 anvil uses + books {Efficiency V}, {Fortune III}, {Mending},
 * goal all of them. Without a cap: total 55, max step 47; without Fortune: total 41, max step 39.
 */
const PICKAXE = advanced({
  target: { itemType: 'pickaxe', enchantments: { unbreaking: 3 }, anvilUses: 5 },
  books: [{ enchantments: { efficiency: 5 }, anvilUses: 0 }, { enchantments: { fortune: 3 }, anvilUses: 0 }, { enchantments: { mending: 1 }, anvilUses: 0 }],
  goal: { efficiency: 5, fortune: 3, unbreaking: 3, mending: 1 },
})

/** The optimum is 9 and discards Sharpness. */
const SMITE_BLOCKS_SHARPNESS = advanced({
  target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
  books: [{ enchantments: { smite: 1 }, anvilUses: 0 }, { enchantments: { sharpness: 5, looting: 3 }, anvilUses: 0 }],
  goal: { looting: 3 },
})

describe('staticReasons', () => {
  const reasons = (problem: Problem, settings: Settings = java): FailureReason[] => staticReasons(normalizeProblem(problem, settings), settings)
  const simple = (item: SimpleProblem['item'], enchantments: SimpleProblem['enchantments']): SimpleProblem => ({ mode: 'simple', item, enchantments })

  it('finds nothing for a solvable problem', () => {
    expect(reasons(PICKAXE)).toEqual([])
    expect(reasons(SMITE_BLOCKS_SHARPNESS)).toEqual([])
    expect(reasons(simple('boots', [{ id: 'protection', level: 4 }, { id: 'mending', level: 1 }]))).toEqual([])
  })

  it('goal-not-in-edition: Sweeping Edge in Bedrock (validation normally stops this first)', () => {
    const problem = simple('sword', [{ id: 'sweeping_edge', level: 3 }, { id: 'sharpness', level: 5 }])
    expect(reasons(problem, bedrock)).toEqual([{ code: 'goal-not-in-edition', enchantment: 'sweeping_edge' }])
  })

  it('goal-not-applicable, without also calling it missing', () => {
    expect(reasons(simple('boots', [{ id: 'sharpness', level: 5 }]))).toEqual([{ code: 'goal-not-applicable', enchantment: 'sharpness' }])
    const noBook = advanced({ target: { itemType: 'boots', enchantments: {}, anvilUses: 0 }, goal: { sharpness: 5, mending: 1 } })
    expect(reasons(noBook)).toEqual([
      { code: 'goal-not-applicable', enchantment: 'sharpness' },
      { code: 'goal-enchantment-missing', enchantment: 'mending' },
    ])
    // Bedrock shears accept Silk Touch
    expect(reasons(simple('shears', [{ id: 'silk_touch', level: 1 }]))).toEqual([{ code: 'goal-not-applicable', enchantment: 'silk_touch' }])
    expect(reasons(simple('shears', [{ id: 'silk_touch', level: 1 }]), bedrock)).toEqual([])
  })

  it('goal-conflict: two goal enchantments exclude each other (also in book-only mode)', () => {
    const conflict = [{ id: 'sharpness', level: 5 }, { id: 'smite', level: 5 }, { id: 'looting', level: 3 }] as const
    expect(reasons(simple('sword', [...conflict]))).toEqual([{ code: 'goal-conflict', a: 'sharpness', b: 'smite' }])
    expect(reasons(simple('enchanted_book', [...conflict]))).toEqual([{ code: 'goal-conflict', a: 'sharpness', b: 'smite' }])
    // Impaling excludes Sharpness in Java but not in Bedrock
    const impaling = simple('enchanted_book', [{ id: 'sharpness', level: 5 }, { id: 'impaling', level: 5 }])
    expect(reasons(impaling)).toEqual([{ code: 'goal-conflict', a: 'impaling', b: 'sharpness' }])
    expect(reasons(impaling, bedrock)).toEqual([])
  })

  it('goal-conflicts-with-target: anvils never remove the existing enchantment', () => {
    const problem = advanced({
      target: { itemType: 'sword', enchantments: { sharpness: 5 }, anvilUses: 0 },
      books: [{ enchantments: { smite: 5 }, anvilUses: 0 }],
      goal: { smite: 5 },
    })
    expect(reasons(problem)).toEqual([{ code: 'goal-conflicts-with-target', enchantment: 'smite', existing: 'sharpness' }])
  })

  it('goal-enchantment-missing and goal-level-unreachable follow the reachable level (pairs of equal levels carry upward)', () => {
    const boots = (levels: number[], goal: number) => advanced({
      target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
      books: levels.map((level) => ({ enchantments: { unbreaking: level }, anvilUses: 0 })),
      goal: { unbreaking: goal, mending: 1 },
    })
    expect(reasons(boots([1, 1, 1], 3))).toEqual([
      { code: 'goal-enchantment-missing', enchantment: 'mending' },
      { code: 'goal-level-unreachable', enchantment: 'unbreaking', required: 3, reachable: 2 },
    ])
    expect(reasons(boots([1, 1, 1, 1], 3)).map((r) => r.code)).toEqual(['goal-enchantment-missing'])
    expect(reasons(boots([1, 2, 2], 3)).map((r) => r.code)).toEqual(['goal-enchantment-missing'])
    expect(reasons(boots([1, 1, 1, 2], 3)).map((r) => r.code)).toEqual(['goal-enchantment-missing'])
    // the target's own level counts too
    const onTarget = advanced({ target: { itemType: 'boots', enchantments: { unbreaking: 2 }, anvilUses: 0 }, books: [{ enchantments: { unbreaking: 2 }, anvilUses: 0 }], goal: { unbreaking: 3 } })
    expect(reasons(onTarget)).toEqual([])
  })

  describe('target-penalty-too-high', () => {
    const target = (anvilUses: number, extra: Partial<AdvancedProblem> = {}) =>
      advanced({ target: { itemType: 'boots', enchantments: { unbreaking: 3 }, anvilUses }, goal: { unbreaking: 3 }, ...extra })

    it('Bedrock refuses the rename of a target with PWP 63; Java clamps it', () => {
      expect(reasons(target(6), { ...bedrock, rename: true })).toEqual([{ code: 'target-penalty-too-high', priorWorkPenalty: 63 }])
      expect(reasons(target(6), { ...java, rename: true })).toEqual([])
      expect(reasons(target(6), { ...bedrock, rename: true, levelCap: null })).toEqual([])
    })

    it('when the goal is not met by the target alone', () => {
      const withBook = target(6, { books: [{ enchantments: { thorns: 3 }, anvilUses: 0 }], goal: { unbreaking: 3, thorns: 3 } })
      expect(reasons(withBook)).toEqual([{ code: 'target-penalty-too-high', priorWorkPenalty: 63 }])
      // PWP 31 + 1 = 32 fits the cap; only the search finds that adding Thorns III costs 43
      expect(reasons(target(5, { books: [{ enchantments: { thorns: 3 }, anvilUses: 0 }], goal: { unbreaking: 3, thorns: 3 } }))).toEqual([])
    })

    it('when every input must be used and there is another input, but not when the target alone finishes', () => {
      const book = { books: [{ enchantments: { thorns: 3 }, anvilUses: 0 }] }
      expect(reasons(target(6, { ...book, goal: null, useOnlyNeeded: false }))).toEqual([{ code: 'target-penalty-too-high', priorWorkPenalty: 63 }])
      expect(reasons(target(6, { ...book, useOnlyNeeded: false }))).toEqual([{ code: 'target-penalty-too-high', priorWorkPenalty: 63 }])
      expect(reasons(target(6, book))).toEqual([])
    })
  })
})

describe('diagnoseFailure with verified suggestions', () => {
  it('fixture infeasible: too expensive (55 / 47), a reference plan, and dropping Fortune (41 / 39)', () => {
    const diagnosis = diagnoseFailure(context(PICKAXE, java), { unusableInputs: null })
    const reference = diagnosis.reference
    if (reference === null) throw new Error('expected a reference plan')
    expect(reference.overCap).toBe(true)
    expect([reference.summary.totalLevels, reference.summary.maxStepLevels]).toEqual([55, 47])
    const overCap = reference.plan.steps.filter((s) => s.tooExpensive).map((s) => s.index)
    expect(overCap).toHaveLength(1)
    expect(diagnosis.reasons).toEqual([{ code: 'too-expensive', uncappedTotal: 55, uncappedMaxStep: 47, stepsOverCap: overCap, minAchievableMaxStep: 47 }])
    expect(diagnosis.suggestions).toEqual([{ code: 'drop-goal-enchantment', enchantment: 'fortune', totalLevels: 41, maxStepLevels: 39 }])
  })

  it('boots (uses 5) + Thorns III is too expensive at 43; removing the book leaves nothing to do', () => {
    const problem = advanced({
      target: { itemType: 'boots', enchantments: {}, anvilUses: 5 },
      books: [{ enchantments: { thorns: 3 }, anvilUses: 0 }],
      goal: null,
      useOnlyNeeded: false,
    })
    const { resolve, calls } = recording()
    const diagnosis = diagnoseFailure(context(problem, java, { resolve }), { unusableInputs: [1] })
    expect(diagnosis.reasons).toEqual([
      { code: 'too-expensive', uncappedTotal: 43, uncappedMaxStep: 43, stepsOverCap: [1], minAchievableMaxStep: 43 },
      { code: 'cannot-use-all-inputs', unusable: [1] },
    ])
    expect(diagnosis.suggestions).toEqual([])
    // one uncapped re-solve, one suggestion (removing the book leaves nothing), and a binary search over 40-43 (41 and 42 fail)
    expect(calls.map((c) => c.options.levelCapOverride)).toEqual([null, 39, 41, 42])
    expect(calls[0].settings.levelCap).toBeNull()
    expect(calls.every((c) => c.options.skipDiagnostics === true && c.options.skipBaseline === true)).toBe(true)
    expect(calls.every((c) => (c.options.limits?.exactTimeBudgetMs ?? Infinity) <= LIMITS.diagnosticsBudgetMs)).toBe(true)
  })

  it('cannot-use-all-inputs: remove the unusable book, or allow unused inputs', () => {
    const problem = advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }, { enchantments: { smite: 5 }, anvilUses: 0 }],
      goal: { sharpness: 5 },
      useOnlyNeeded: false,
    })
    const diagnosis = diagnoseFailure(context(problem, java), { unusableInputs: [2] })
    expect(diagnosis.reasons).toEqual([{ code: 'cannot-use-all-inputs', unusable: [2] }])
    expect(diagnosis.reference).toBeNull()
    expect(diagnosis.suggestions).toEqual([
      { code: 'remove-input', input: 2, totalLevels: 5, maxStepLevels: 5 },
      { code: 'enable-use-only-needed', totalLevels: 5, maxStepLevels: 5 },
    ])
  })

  it('removes one copy of a stacked book (count − 1) and tries each group once', () => {
    const problem = advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }, { enchantments: { smite: 5 }, anvilUses: 0, count: 2 }],
      goal: { sharpness: 5 },
      useOnlyNeeded: false,
    })
    // no cap, so no uncapped re-solve; the only suggestions are removing one Smite copy and turning on useOnlyNeeded
    const { resolve, calls } = recording(() => ({ status: 'empty' }))
    diagnoseFailure(context(problem, { ...java, levelCap: null }, { resolve }), { unusableInputs: [2, 3] })
    expect(calls.map((c) => c.problem)).toEqual([
      { ...problem, books: [problem.books[0], { ...problem.books[1], count: 1 }] },
      { ...problem, useOnlyNeeded: true },
    ])
  })

  it('no-plan when nothing else explains it (Bedrock: a book that changes no level)', () => {
    const problem = advanced({
      target: { itemType: 'boots', enchantments: { unbreaking: 3 }, anvilUses: 0 },
      books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0 }],
      goal: null,
      useOnlyNeeded: false,
    })
    const diagnosis = diagnoseFailure(context(problem, bedrock), { unusableInputs: null })
    expect(diagnosis).toMatchObject({ reasons: [{ code: 'no-plan' }], suggestions: [], reference: null, warnings: [] })
  })

  it('warns that the Bedrock no-change refusal is unverified when the search hit it with every input forced', () => {
    const problem = advanced({
      target: { itemType: 'boots', enchantments: { unbreaking: 3 }, anvilUses: 0 },
      books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0 }, { enchantments: { mending: 1 }, anvilUses: 0 }],
      goal: { mending: 1 },
      useOnlyNeeded: false,
    })
    const warning = { code: 'bedrock-unverified-value', detail: 'no-effect-refused' }
    expect(diagnoseFailure(context(problem, bedrock), { unusableInputs: [1], noEffectRefusals: true }).warnings).toEqual([warning])
    expect(diagnoseFailure(context(problem, bedrock), { unusableInputs: [1] }).warnings).toEqual([])
    expect(diagnoseFailure(context(problem, java), { unusableInputs: [1], noEffectRefusals: true }).warnings).toEqual([])
    const allowUnused = { ...problem, useOnlyNeeded: true }
    expect(diagnoseFailure(context(allowUnused, bedrock), { unusableInputs: null, noEffectRefusals: true }).warnings).toEqual([])
  })

  it('stops re-solving when the time budget is spent', () => {
    let clock = 0
    const { resolve, calls } = recording((problem, settings, options) => {
      clock += 600
      return exhaustiveSolve(problem, settings, options)
    })
    const diagnosis = diagnoseFailure(context(PICKAXE, java, { resolve, now: () => clock }), { unusableInputs: null })
    // the 1500 ms budget is spent by the uncapped re-solve (0 -> 600) and two suggestions (-> 1200, -> 1800): no binary search
    expect(calls).toHaveLength(3)
    expect(calls[1].options.limits?.exactTimeBudgetMs).toBe(900)
    expect(diagnosis.reasons).toMatchObject([{ code: 'too-expensive', uncappedTotal: 55, minAchievableMaxStep: null }])
    expect(diagnosis.elapsedMs).toBe(1800)
  })

  it(`makes at most ${MAX_SUGGESTION_RESOLVES} suggestion re-solves`, () => {
    // target + 9 different books, 4 goal enchantments, every input used: 4 dropped goals + useOnlyNeeded + 9 removed books = 14 candidates
    const books = ['sharpness', 'looting', 'unbreaking', 'mending', 'fire_aspect', 'knockback', 'sweeping_edge'].map((id) => ({ enchantments: { [id]: 1 }, anvilUses: 0 }))
    const problem = advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 3 },
      books: [...books, { enchantments: { sharpness: 2 }, anvilUses: 0 }, { enchantments: { looting: 2 }, anvilUses: 0 }],
      goal: { sharpness: 2, looting: 2, unbreaking: 1, mending: 1 },
      useOnlyNeeded: false,
    })
    const np = normalizeProblem(problem, java)
    const chain = node(node(node(node(node(node(node(node(node(leaf(0), leaf(1)), leaf(2)), leaf(3)), leaf(4)), leaf(5)), leaf(6)), leaf(7)), leaf(8)), leaf(9))
    const uncappedPlan = buildPlan(chain, np, { ...java, levelCap: null })
    const { resolve, calls } = recording((_problem, _settings, options) => {
      if (options.levelCapOverride === null) {
        return { ...RESULT_BASE, status: 'ok', method: 'exact', plan: uncappedPlan, summary: summarize(uncappedPlan, np, { edition: 'java', levelCap: null }), baseline: null }
      }
      return { ...RESULT_BASE, status: 'infeasible', reasons: [{ code: 'no-plan' }], suggestions: [], suggestionsComplete: false, capExcluded: false, reference: null }
    })
    const diagnosis = diagnoseFailure(context(problem, java, { resolve }), { unusableInputs: null })
    expect(calls.filter((c) => c.options.levelCapOverride === 39)).toHaveLength(MAX_SUGGESTION_RESOLVES)
    expect(diagnosis.suggestions).toEqual([])
    expect(diagnosis.reasons[0]).toMatchObject({ code: 'too-expensive', minAchievableMaxStep: uncappedPlan.steps.at(-1)?.cost.total })
  })

  it('skips re-solves that are not cheap', () => {
    const problem = advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }, { enchantments: { smite: 5 }, anvilUses: 0 }],
      goal: { sharpness: 5 },
      useOnlyNeeded: false,
    })
    // Without the Smite book the tree-table method applies, so that re-solve is cheap. With useOnlyNeeded the conflict rules out
    // the tree-table method and C_eff > 0. Goal + useOnlyNeeded re-solves are checked up to exactComplexityHard, so it is 0 too.
    const options: SolveOptions = { limits: { suggestionMaxComplexity: 0, exactComplexityHard: 0 } }
    const diagnosis = diagnoseFailure(context(problem, java, { options }), { unusableInputs: [2] })
    expect(diagnosis.suggestions.map((s) => s.code)).toEqual(['remove-input'])
    // a candidate was skipped unchecked, so the list is incomplete and the UI must not claim that removing one input cannot help
    expect(diagnosis.suggestionsComplete).toBe(false)
  })

  it('checks goal + useOnlyNeeded re-solves up to exactComplexityHard even when they are not cheap', () => {
    const problem = advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }, { enchantments: { smite: 5 }, anvilUses: 0 }],
      goal: { sharpness: 5 },
      useOnlyNeeded: false,
    })
    const options: SolveOptions = { limits: { suggestionMaxComplexity: 0 } }
    const diagnosis = diagnoseFailure(context(problem, java, { options }), { unusableInputs: [2] })
    expect(diagnosis.suggestions.map((s) => s.code).sort()).toEqual(['enable-use-only-needed', 'remove-input'])
    expect(diagnosis.suggestionsComplete).toBe(true)
  })

  it('suggestionsComplete is false when the re-solve limit leaves candidates unchecked', () => {
    const problem = advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }, { enchantments: { smite: 5 }, anvilUses: 0 }],
      goal: { sharpness: 5 },
      useOnlyNeeded: false,
    })
    // no time budget for re-solves, so no candidate can be checked
    const diagnosis = diagnoseFailure(context(problem, java, { options: { limits: { diagnosticsBudgetMs: 0 } } }), { unusableInputs: [2] })
    expect(diagnosis.suggestions).toEqual([])
    expect(diagnosis.suggestionsComplete).toBe(false)
  })
})

describe('diagnoseStaticFailure (suggestions for static reasons)', () => {
  const diagnose = (problem: Problem, settings: Settings = java) => {
    const ctx = context(problem, settings)
    const reasons = staticReasons(ctx.np, settings)
    return diagnoseStaticFailure(ctx, reasons)
  }

  it('goal-conflict: drop either enchantment, cheapest result first', () => {
    const problem: SimpleProblem = { mode: 'simple', item: 'sword', enchantments: [{ id: 'sharpness', level: 1 }, { id: 'smite', level: 5 }, { id: 'looting', level: 3 }] }
    expect(diagnose(problem)).toMatchObject({
      reasons: [{ code: 'goal-conflict', a: 'sharpness', b: 'smite' }],
      suggestions: [
        // (sword + Looting III) + Sharpness I = 6 + 2; with Smite V instead, 6 + 6
        { code: 'drop-goal-enchantment', enchantment: 'smite', totalLevels: 8, maxStepLevels: 6 },
        { code: 'drop-goal-enchantment', enchantment: 'sharpness', totalLevels: 12, maxStepLevels: 6 },
      ],
      reference: null,
    })
  })

  it('goal-conflicts-with-target and goal-not-applicable: drop the enchantment', () => {
    const withTarget = advanced({
      target: { itemType: 'sword', enchantments: { sharpness: 5 }, anvilUses: 0 },
      books: [{ enchantments: { smite: 5 }, anvilUses: 0 }, { enchantments: { looting: 3 }, anvilUses: 0 }],
      goal: { smite: 5, looting: 3 },
    })
    expect(diagnose(withTarget).suggestions).toEqual([{ code: 'drop-goal-enchantment', enchantment: 'smite', totalLevels: 6, maxStepLevels: 6 }])
    const inapplicable = advanced({
      target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }, { enchantments: { protection: 4 }, anvilUses: 0 }],
      goal: { sharpness: 5, protection: 4 },
    })
    expect(diagnose(inapplicable).suggestions).toEqual([{ code: 'drop-goal-enchantment', enchantment: 'sharpness', totalLevels: 4, maxStepLevels: 4 }])
  })

  it('does not offer to drop the only goal enchantment (nothing would be left to make)', () => {
    const problem = advanced({ target: { itemType: 'boots', enchantments: {}, anvilUses: 0 }, books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }], goal: { sharpness: 5 } })
    expect(diagnose(problem)).toMatchObject({ reasons: [{ code: 'goal-not-applicable' }], suggestions: [] })
  })

  it('goal-enchantment-missing: add one book at the goal level', () => {
    const problem = advanced({ target: { itemType: 'boots', enchantments: {}, anvilUses: 0 }, books: [{ enchantments: { protection: 4 }, anvilUses: 0 }], goal: { protection: 4, mending: 1 } })
    expect(diagnose(problem).suggestions).toEqual([{ code: 'add-book', enchantment: 'mending', level: 1, totalLevels: 7, maxStepLevels: 4 }])
  })

  it('goal-level-unreachable in simple mode (Unbreaking I x3): add a III book (3) or lower the goal to II (4)', () => {
    const problem: SimpleProblem = { mode: 'simple', item: 'boots', enchantments: [{ id: 'unbreaking', level: 3, sources: [{ level: 1, count: 3 }] }] }
    const diagnosis = diagnose(problem)
    expect(diagnosis.reasons).toEqual([{ code: 'goal-level-unreachable', enchantment: 'unbreaking', required: 3, reachable: 2 }])
    expect(diagnosis.suggestions).toEqual([
      { code: 'add-book', enchantment: 'unbreaking', level: 3, totalLevels: 3, maxStepLevels: 3 },
      { code: 'lower-goal-level', enchantment: 'unbreaking', level: 2, totalLevels: 4, maxStepLevels: 3 },
    ])
  })

  it('Bedrock target-penalty-too-high (boots with 6 anvil uses, rename) has no suggestion', () => {
    const problem = advanced({ target: { itemType: 'boots', enchantments: { unbreaking: 3 }, anvilUses: 6 }, goal: { unbreaking: 3 } })
    expect(diagnose(problem, { ...bedrock, rename: true })).toMatchObject({ reasons: [{ code: 'target-penalty-too-high', priorWorkPenalty: 63 }], suggestions: [] })
  })

  it('lower-goal-level also lowers the books above the new level (too-expensive in simple mode)', () => {
    const problem: SimpleProblem = { mode: 'simple', item: 'boots', enchantments: [{ id: 'thorns', level: 3 }, { id: 'unbreaking', level: 3, sources: [{ level: 3, count: 1 }, { level: 1, count: 2 }] }] }
    const { resolve, calls } = recording(() => ({ status: 'empty' }))
    diagnoseStaticFailure(context(problem, java, { resolve }), [{ code: 'too-expensive', uncappedTotal: 0, uncappedMaxStep: 0, stepsOverCap: [], minAchievableMaxStep: null }])
    const lowered = calls.map((c) => c.problem as SimpleProblem).find((p) => p.enchantments.some((e) => e.id === 'unbreaking' && e.level === 2))
    expect(lowered?.enchantments.find((e) => e.id === 'unbreaking')).toEqual({ id: 'unbreaking', level: 2, sources: [{ level: 1, count: 2 }, { level: 2, count: 1 }] })
    // heaviest first, Thorns (4 * 3) then Unbreaking (1 * 3); each is first dropped, then lowered
    expect(calls.map((c) => (c.problem as SimpleProblem).enchantments.map((e) => `${e.id}${e.level}`).join('+'))).toEqual([
      'unbreaking3', 'thorns2+unbreaking3', 'thorns3', 'thorns3+unbreaking2',
    ])
  })
})

describe('keepAlternative', () => {
  /** What the optimal plan for SMITE_BLOCKS_SHARPNESS discards, as planBuilder.discardedEnchantments reports it. */
  const SMITE_BLOCKS_SHARPNESS_DISCARDED: DiscardedEnchantment[] = [{ id: 'sharpness', inputLevel: 5, finalLevel: 0, inputs: [2], reason: 'conflict' }]

  it.each([['java', java], ['bedrock', bedrock]] as const)('%s: keeping the blocked Sharpness V costs 11 (max 11) instead of 9', (_name, settings) => {
    const { resolve, calls } = recording()
    const keep = keepAlternative(context(SMITE_BLOCKS_SHARPNESS, settings, { resolve }), SMITE_BLOCKS_SHARPNESS_DISCARDED)
    expect(keep).toEqual({ enchantments: { sharpness: 5 }, totalLevels: 11, maxStepLevels: 11 })
    expect(calls).toHaveLength(1)
    expect(calls[0].problem).toEqual({ ...SMITE_BLOCKS_SHARPNESS, goal: { looting: 3, sharpness: 5 } })
  })

  it('adds the heavier of two conflicting enchantments only, and nothing that cannot stay on the target', () => {
    const problem = advanced({ target: { itemType: 'sword', enchantments: {}, anvilUses: 0 }, goal: { looting: 3 } })
    const { resolve, calls } = recording(() => ({ status: 'empty' }))
    const discarded: DiscardedEnchantment[] = [
      { id: 'sharpness', inputLevel: 4, finalLevel: 0, inputs: [1], reason: 'conflict' },
      { id: 'smite', inputLevel: 5, finalLevel: 0, inputs: [2], reason: 'conflict' },
      { id: 'efficiency', inputLevel: 5, finalLevel: 0, inputs: [3], reason: 'inapplicable' },
    ]
    expect(keepAlternative(context(problem, java, { resolve }), discarded)).toBeNull()
    expect((calls[0].problem as AdvancedProblem).goal).toEqual({ looting: 3, smite: 5 })
  })

  it('is null without a goal, when nothing can be kept, or when the re-solve is not cheap', () => {
    const noGoal = advanced({ target: { itemType: 'sword', enchantments: {}, anvilUses: 0 }, books: SMITE_BLOCKS_SHARPNESS.books, goal: null, useOnlyNeeded: false })
    const { resolve, calls } = recording()
    expect(keepAlternative(context(noGoal, java, { resolve }), SMITE_BLOCKS_SHARPNESS_DISCARDED)).toBeNull()
    const inapplicable: DiscardedEnchantment[] = [{ id: 'efficiency', inputLevel: 5, finalLevel: 0, inputs: [1], reason: 'inapplicable' }]
    expect(keepAlternative(context(SMITE_BLOCKS_SHARPNESS, java, { resolve }), inapplicable)).toBeNull()
    expect(keepAlternative(context(SMITE_BLOCKS_SHARPNESS, java, { resolve, options: { limits: { suggestionMaxComplexity: 0 } } }), SMITE_BLOCKS_SHARPNESS_DISCARDED)).toBeNull()
    expect(calls).toHaveLength(0)
  })
})
