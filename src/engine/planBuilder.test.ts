// The plan trees are written by hand: the boots tree is the one in src/ui/dev/fixtures.ts, the others are optimal trees
// confirmed by brute force.
import fc from 'fast-check'
import { getItem, isApplicable, itemsInEdition } from '../data/gameData.ts'
import type { EnchantmentId } from '../data/types.ts'
import { getFixtures } from '../ui/dev/fixtures.ts'
import { computeBaseline } from './baseline.ts'
import { normalizeProblem } from './normalize.ts'
import {
  buildPlan,
  discardedEnchantments,
  levelsOf,
  objectState,
  PlanBuildError,
  planWarnings,
  summarize,
  type PlanContext,
} from './planBuilder.ts'
import { anvilObjectOf, combine, JAVA_RENAME_ONLY_MAX_COST, pwp, renameOnly } from './rules.ts'
import type { AdvancedProblem, NormalizedProblem, Plan, PlanNode, PlanSummary, Problem, Settings, SimpleProblem } from './types.ts'
import { xpAtLevel } from './xp.ts'

const leaf = (input: number, preRename = false): PlanNode => ({ t: 'leaf', input, preRename })
const node = (left: PlanNode, right: PlanNode, rename = false): PlanNode => ({ t: 'combine', left, right, rename })

const java: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
const bedrock: Settings = { ...java, edition: 'bedrock' }
const uncapped = (settings: Settings): Settings => ({ ...settings, levelCap: null })

const advanced = (overrides: Partial<AdvancedProblem>): AdvancedProblem =>
  ({ mode: 'advanced', target: null, extraItems: [], books: [], goal: null, useOnlyNeeded: true, ...overrides })

const keys = (summary: PlanSummary): number[] => [summary.totalLevels, summary.maxStepLevels, summary.xpPoints, summary.finalPriorWorkPenalty]

function build(problem: Problem, settings: PlanContext, tree: PlanNode): { np: NormalizedProblem; plan: Plan; summary: PlanSummary } {
  const np = normalizeProblem(problem, settings)
  const plan = buildPlan(tree, np, settings)
  return { np, plan, summary: summarize(plan, np, settings) }
}

function expectConsistent(plan: Plan, np: NormalizedProblem, ctx: PlanContext): void {
  const products = new Map<number, ReturnType<typeof anvilObjectOf>>()
  const objectOf = (ref: NonNullable<Plan['steps'][number]['right']>) => {
    if (ref.kind === 'input') return anvilObjectOf(np.inputs[ref.input])
    const product = products.get(ref.step)
    if (product === undefined) throw new Error(`step ${ref.step} is used before it is made`)
    return product
  }
  const uses = new Map<number, number>()
  let cumulative = 0
  plan.steps.forEach((step, i) => {
    expect(step.index).toBe(i + 1)
    const left = objectOf(step.left)
    const outcome = step.right === null ? renameOnly(left, ctx) : combine(left, objectOf(step.right), { ...ctx, rename: step.cost.rename === 1 })
    if (!outcome.ok) throw new Error(`step ${step.index} is refused on replay`)
    expect(step.cost).toEqual(outcome.breakdown)
    expect(step.before.left).toEqual(objectState(left))
    expect(step.after).toEqual(objectState(outcome.result))
    products.set(step.index, outcome.result)
    for (const ref of [step.left, step.right]) if (ref?.kind === 'step') uses.set(ref.step, step.index)
    const { cost } = step
    const parts = cost.leftPenalty + cost.rightPenalty + cost.enchantments.reduce((sum, line) => sum + line.cost, 0) + cost.conflictPenalty + cost.rename
    if (cost.clampedFrom === null) expect(cost.total).toBe(parts)
    else expect([cost.total, cost.clampedFrom]).toEqual([JAVA_RENAME_ONLY_MAX_COST, parts])
    cumulative += cost.total
    expect(step.cumulativeLevels).toBe(cumulative)
    expect(step.xpPoints).toBe(xpAtLevel(cost.total))
    expect(step.tooExpensive).toBe(cost.total >= 40)
  })
  for (const step of plan.steps) expect(step.consumedBy).toBe(uses.get(step.index) ?? null)
  if (plan.steps.length > 0) {
    expect(plan.finalRef).toEqual({ kind: 'step', step: plan.steps.length })
    expect(plan.steps.at(-1)?.resultLabel).toEqual({ t: 'final' })
    expect(plan.final).toEqual(plan.steps.at(-1)?.after)
  }
  expect([...plan.usedInputs, ...plan.unusedInputs].sort((a, b) => a - b)).toEqual(np.inputs.map((_, i) => i))
}

/**
 * Inputs: 0 boots, 1 Protection IV, 2 Feather Falling IV, 3 Soul Speed III, 4 Depth Strider III, 5 Thorns III,
 * 6 Unbreaking III, 7 Mending (the order of src/ui/dev/fixtures.ts).
 */
const BOOTS: SimpleProblem = {
  mode: 'simple',
  item: 'boots',
  enchantments: [
    { id: 'protection', level: 4 },
    { id: 'feather_falling', level: 4 },
    { id: 'soul_speed', level: 3 },
    { id: 'depth_strider', level: 3 },
    { id: 'thorns', level: 3 },
    { id: 'unbreaking', level: 3 },
    { id: 'mending', level: 1 },
  ],
}
/** (((boots + Thorns) + (Soul Speed + Mending)) + (Depth Strider + Protection)) + (Feather Falling + Unbreaking): of the 72 plans that total 66, one with the smallest max step (16). */
const BOOTS_TREE = node(node(node(node(leaf(0), leaf(5)), node(leaf(3), leaf(7))), node(leaf(4), leaf(1))), node(leaf(2), leaf(6)))
/** Inputs: 0 Protection ... 6 Mending. */
const BOOK_ONLY: SimpleProblem = { ...BOOTS, item: 'enchanted_book' }
const BOOK_ONLY_TREE = node(node(node(node(leaf(4), leaf(2)), node(leaf(3), leaf(6))), node(leaf(1), leaf(5))), leaf(0))

/** The cheapest plan lets the Smite book block Sharpness. */
const SMITE_BLOCKS_SHARPNESS = advanced({
  target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
  books: [{ enchantments: { smite: 1 }, anvilUses: 0 }, { enchantments: { sharpness: 5, looting: 3 }, anvilUses: 0 }],
  goal: { looting: 3 },
})
const SMITE_BLOCKS_SHARPNESS_TREE = node(node(leaf(0), leaf(1)), leaf(2))

describe('buildPlan: boots + 7 max-level books', () => {
  const { np, plan, summary } = build(BOOTS, java, BOOTS_TREE)

  it('lists the steps in post-order, left subtree first', () => {
    expect(plan.steps.map((s) => s.cost.total)).toEqual([12, 2, 16, 4, 14, 3, 15])
    expect(plan.steps.map((s) => [s.left, s.right])).toEqual([
      [{ kind: 'input', input: 0 }, { kind: 'input', input: 5 }],
      [{ kind: 'input', input: 3 }, { kind: 'input', input: 7 }],
      [{ kind: 'step', step: 1 }, { kind: 'step', step: 2 }],
      [{ kind: 'input', input: 4 }, { kind: 'input', input: 1 }],
      [{ kind: 'step', step: 3 }, { kind: 'step', step: 4 }],
      [{ kind: 'input', input: 2 }, { kind: 'input', input: 6 }],
      [{ kind: 'step', step: 5 }, { kind: 'step', step: 6 }],
    ])
    expect(plan.steps.map((s) => s.consumedBy)).toEqual([3, 3, 5, 5, 7, 7, null])
    expect(plan.steps.map((s) => s.cumulativeLevels)).toEqual([12, 14, 30, 34, 48, 51, 66])
    expect(plan.steps.every((s) => s.kind === 'combine' && !s.tooExpensive)).toBe(true)
    expectConsistent(plan, np, java)
  })

  it('breaks every step down per enchantment', () => {
    expect(plan.steps[2].cost).toEqual({
      leftPenalty: 1,
      rightPenalty: 1,
      enchantments: [
        { id: 'mending', leftLevel: 0, rightLevel: 1, resultLevel: 1, multiplier: 2, multiplierKind: 'book', cost: 2, outcome: 'added', conflictsWith: [] },
        { id: 'soul_speed', leftLevel: 0, rightLevel: 3, resultLevel: 3, multiplier: 4, multiplierKind: 'book', cost: 12, outcome: 'added', conflictsWith: [] },
      ],
      conflictPenalty: 0,
      rename: 0,
      clampedFrom: null,
      total: 16,
    })
    expect(plan.steps[2].before.left).toEqual({
      kind: 'item', itemType: 'boots', enchantments: [{ id: 'thorns', level: 3 }], anvilUses: 1, priorWorkPenalty: 1, named: false,
    })
    expect(plan.steps[2].before.right?.enchantments).toEqual([{ id: 'mending', level: 1 }, { id: 'soul_speed', level: 3 }])
  })

  it('labels inputs, intermediate products and the result', () => {
    expect(plan.steps[0].leftLabel).toEqual({ t: 'input', input: 0, origin: { source: 'simple-item', itemType: 'boots' } })
    expect(plan.steps[0].rightLabel).toEqual({ t: 'input', input: 5, origin: { source: 'simple-book', enchantment: 'thorns', level: 3, copy: 0 } })
    expect(plan.steps.map((s) => s.resultLabel)).toEqual([
      { t: 'product', step: 1, kind: 'item', itemType: 'boots', targetLineage: true },
      { t: 'product', step: 2, kind: 'book', itemType: null, targetLineage: false },
      { t: 'product', step: 3, kind: 'item', itemType: 'boots', targetLineage: true },
      { t: 'product', step: 4, kind: 'book', itemType: null, targetLineage: false },
      { t: 'product', step: 5, kind: 'item', itemType: 'boots', targetLineage: true },
      { t: 'product', step: 6, kind: 'book', itemType: null, targetLineage: false },
      { t: 'final' },
    ])
    // a step that uses a product gives it the label of the step that made it
    expect(plan.steps[2].leftLabel).toEqual(plan.steps[0].resultLabel)
    expect(plan.steps[2].rightLabel).toEqual(plan.steps[1].resultLabel)
  })

  it('reports the final object and the summary [66, 16, 1246, 15]', () => {
    expect(plan.final).toEqual({
      kind: 'item',
      itemType: 'boots',
      enchantments: [
        { id: 'depth_strider', level: 3 }, { id: 'feather_falling', level: 4 }, { id: 'mending', level: 1 }, { id: 'protection', level: 4 },
        { id: 'soul_speed', level: 3 }, { id: 'thorns', level: 3 }, { id: 'unbreaking', level: 3 },
      ],
      anvilUses: 4,
      priorWorkPenalty: 15,
      named: false,
    })
    expect(plan.finalRef).toEqual({ kind: 'step', step: 7 })
    expect(plan.usedInputs).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(plan.unusedInputs).toEqual([])
    expect(plan.tree).toBe(BOOTS_TREE)
    expect(keys(summary)).toEqual([66, 16, 1246, 15])
    expect(summary).toMatchObject({ finalAnvilUses: 4, anvilOperations: 7, extraItemsUsed: [], applyToFreshItem: null })
    expect(summary.finalEnchantments).toEqual(levelsOf(plan.final))
    expect(summary.booksRequired).toEqual([1, 2, 3, 4, 5, 6, 7].map((i) => ({ enchantments: np.inputs[i].enchantments, anvilUses: 0, count: 1, inputs: [i] })))
  })

  it('gives the same numbers in Bedrock and without a cap', () => {
    expect(keys(build(BOOTS, bedrock, BOOTS_TREE).summary)).toEqual([66, 16, 1246, 15])
    expect(keys(build(BOOTS, uncapped(java), BOOTS_TREE).summary)).toEqual([66, 16, 1246, 15])
  })

  it('accepts matching search values and throws on a mismatch', () => {
    expect(() => buildPlan(BOOTS_TREE, np, java, { stepCosts: [12, 2, 16, 4, 14, 3, 15], totalLevels: 66, maxStepLevels: 16, xpPoints: 1246, finalAnvilUses: 4 })).not.toThrow()
    expect(() => buildPlan(BOOTS_TREE, np, java, { stepCosts: [12, 2, 16, 4, 14, 3, 14] })).toThrow(PlanBuildError)
    expect(() => buildPlan(BOOTS_TREE, np, java, { totalLevels: 65 })).toThrow(/totalLevels 65 vs rules 66/)
    expect(() => buildPlan(BOOTS_TREE, np, java, { maxStepLevels: 15 })).toThrow(PlanBuildError)
    expect(() => buildPlan(BOOTS_TREE, np, java, { xpPoints: 1 })).toThrow(PlanBuildError)
    expect(() => buildPlan(BOOTS_TREE, np, java, { finalAnvilUses: 3 })).toThrow(PlanBuildError)
  })
})

describe('buildPlan: rename', () => {
  it('puts the rename-only step of the base leaf first (fixture bootsRename: 67 in 8 steps)', () => {
    const settings: Settings = { ...java, rename: true }
    const tree = node(node(node(node(leaf(0, true), leaf(5)), node(leaf(3), leaf(7))), node(leaf(4), leaf(1))), node(leaf(2), leaf(6)))
    const { np, plan, summary } = build(BOOTS, settings, tree)
    const [first, second] = plan.steps
    expect(first).toMatchObject({
      index: 1,
      kind: 'rename',
      left: { kind: 'input', input: 0 },
      right: null,
      rightLabel: null,
      before: { right: null },
      resultLabel: { t: 'product', step: 1, kind: 'item', itemType: 'boots', targetLineage: true },
      consumedBy: 2,
    })
    expect(first.cost).toEqual({ leftPenalty: 0, rightPenalty: 0, enchantments: [], conflictPenalty: 0, rename: 1, clampedFrom: null, total: 1 })
    expect(first.after).toMatchObject({ anvilUses: 0, named: true })
    expect(second.left).toEqual({ kind: 'step', step: 1 })
    expect(plan.steps.map((s) => s.cost.total)).toEqual([1, 12, 2, 16, 4, 14, 3, 15])
    expect(keys(summary)).toEqual([67, 16, 1253, 15])
    expect(summary.anvilOperations).toBe(8)
    expect(plan.final.named).toBe(true)
    expectConsistent(plan, np, settings)
  })

  it('adds +1 on a combine step of the target lineage (fixture advancedRename: 27)', () => {
    const settings: Settings = { ...java, rename: true }
    const problem = advanced({
      target: { itemType: 'pickaxe', enchantments: { efficiency: 4, unbreaking: 3 }, anvilUses: 2 },
      books: [
        { enchantments: { efficiency: 4 }, anvilUses: 0 },
        { enchantments: { mending: 1 }, anvilUses: 0 },
        { enchantments: { fortune: 3 }, anvilUses: 0 },
      ],
      goal: { efficiency: 5, fortune: 3, unbreaking: 3, mending: 1 },
    })
    const { np, plan, summary } = build(problem, settings, node(node(leaf(0), node(leaf(3), leaf(2))), leaf(1), true))
    expect(plan.steps.map((s) => [s.cost.total, s.cost.rename])).toEqual([[2, 0], [12, 0], [13, 1]])
    expect(summary.totalLevels).toBe(27)
    expect(plan.final.named).toBe(true)
    expectConsistent(plan, np, settings)
  })

  const renameOnlyBoots = advanced({ target: { itemType: 'boots', enchantments: { unbreaking: 3 }, anvilUses: 6 }, goal: { unbreaking: 3 } })

  it('clamps a Java rename-only step at 39 (boots with 6 anvil uses: [39, 39, 2727, 63], clampedFrom 64)', () => {
    const settings: Settings = { ...java, rename: true }
    const { np, plan, summary } = build(renameOnlyBoots, settings, leaf(0, true))
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0].cost).toMatchObject({ leftPenalty: 63, total: 39, clampedFrom: 64, rename: 1 })
    expect(plan.finalRef).toEqual({ kind: 'step', step: 1 })
    expect(plan.steps[0].resultLabel).toEqual({ t: 'final' })
    expect(keys(summary)).toEqual([39, 39, 2727, 63])
    expectConsistent(plan, np, settings)
  })

  it('throws when a Bedrock rename-only step is over the cap', () => {
    const np = normalizeProblem(renameOnlyBoots, bedrock)
    expect(() => buildPlan(leaf(0, true), np, { ...bedrock, rename: true })).toThrow(/refused.*too-expensive \(cost 64\)/)
  })

  it('rejects renames the optimizer never generates', () => {
    const np = normalizeProblem(SMITE_BLOCKS_SHARPNESS, java)
    const renamed: Settings = { ...java, rename: true }
    expect(() => buildPlan(SMITE_BLOCKS_SHARPNESS_TREE, np, renamed)).toThrow(/not named/)
    expect(() => buildPlan(node(node(leaf(0, true), leaf(1)), leaf(2)), np, java)).toThrow(/is named/)
    expect(() => buildPlan(node(leaf(0), node(leaf(1), leaf(2), true)), np, renamed)).toThrow(/outside the target lineage/)
    expect(() => buildPlan(node(node(leaf(0), leaf(1, true)), leaf(2)), np, renamed)).toThrow(/not the base leaf/)
    expect(() => buildPlan(node(node(leaf(0, true), leaf(1)), leaf(2), true), np, renamed)).toThrow(/renames 2 times/)
  })
})

describe('buildPlan: tree checks and edge cases', () => {
  const np = normalizeProblem(SMITE_BLOCKS_SHARPNESS, java)

  it('rejects trees that do not keep the target as the base or reuse inputs', () => {
    expect(() => buildPlan(node(leaf(1), leaf(0)), np, java)).toThrow(/target \(input 0\) must be the base/)
    expect(() => buildPlan(node(leaf(1), leaf(2)), np, java)).toThrow(/must be the base/)
    expect(() => buildPlan(node(leaf(0), leaf(0)), np, java)).toThrow(/used twice/)
    expect(() => buildPlan(node(leaf(0), leaf(3)), np, java)).toThrow(/has 3 inputs/)
  })

  it('throws when the rules refuse a step', () => {
    const sharpnessSwordWithSmite = advanced({
      target: { itemType: 'sword', enchantments: { sharpness: 5 }, anvilUses: 0 },
      books: [{ enchantments: { smite: 5 }, anvilUses: 0 }],
    })
    expect(() => buildPlan(node(leaf(0), leaf(1)), normalizeProblem(sharpnessSwordWithSmite, java), java)).toThrow(/nothing-transfers/)
  })

  it('builds a plan without steps from a single leaf', () => {
    const problem = advanced({ target: { itemType: 'boots', enchantments: { unbreaking: 3 }, anvilUses: 2 }, books: [{ enchantments: { mending: 1 }, anvilUses: 0 }], goal: { unbreaking: 3 } })
    const { plan, summary } = build(problem, java, leaf(0))
    expect(plan).toMatchObject({ steps: [], finalRef: { kind: 'input', input: 0 }, usedInputs: [0], unusedInputs: [1] })
    expect(plan.final).toEqual({ kind: 'item', itemType: 'boots', enchantments: [{ id: 'unbreaking', level: 3 }], anvilUses: 2, priorWorkPenalty: 3, named: false })
    expect(keys(summary)).toEqual([0, 0, 0, 3])
    expect(summary).toMatchObject({ anvilOperations: 0, booksRequired: [], finalEnchantments: { unbreaking: 3 } })
  })

  it('accepts over-cap steps only without a cap and flags them (fixture creative40: 55 / 47)', () => {
    const problem = advanced({
      target: { itemType: 'pickaxe', enchantments: { unbreaking: 3 }, anvilUses: 5 },
      books: [{ enchantments: { efficiency: 5 }, anvilUses: 0 }, { enchantments: { fortune: 3 }, anvilUses: 0 }, { enchantments: { mending: 1 }, anvilUses: 0 }],
      goal: { efficiency: 5, fortune: 3, unbreaking: 3, mending: 1 },
    })
    const tree = node(leaf(0), node(node(leaf(2), leaf(1)), leaf(3)))
    const { np, plan, summary } = build(problem, uncapped(java), tree)
    expect(plan.steps.map((s) => [s.cost.total, s.tooExpensive])).toEqual([[5, false], [3, false], [47, true]])
    expect(keys(summary).slice(0, 2)).toEqual([55, 47])
    expect(() => buildPlan(tree, np, java)).toThrow(/step 3 .*too-expensive \(cost 47\)/)
  })

  it('names products of a spare item outside the target lineage', () => {
    const problem = advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
      extraItems: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }],
      books: [{ enchantments: { looting: 3 }, anvilUses: 0 }],
    })
    const { np, plan, summary } = build(problem, java, node(leaf(0), node(leaf(1), leaf(2))))
    expect(plan.steps[0].resultLabel).toEqual({ t: 'product', step: 1, kind: 'item', itemType: 'sword', targetLineage: false })
    expect(plan.steps[0].leftLabel).toEqual({ t: 'input', input: 1, origin: { source: 'extra-item', index: 0 } })
    // the right input is an item, so item multipliers apply: Sharpness 1 * 5 + Looting 4 * 3, plus prior work penalties 0 + 1
    expect(plan.steps.map((s) => s.cost.total)).toEqual([6, 18])
    expect(plan.steps[1].cost.enchantments.map((l) => l.multiplierKind)).toEqual(['item', 'item'])
    expect(summary.extraItemsUsed).toEqual([1])
    expect(summary.booksRequired).toEqual([{ enchantments: { looting: 3 }, anvilUses: 0, count: 1, inputs: [2] }])
    expectConsistent(plan, np, java)
  })

  it('treats the base book as the lineage in book-only mode', () => {
    const { plan } = build(BOOK_ONLY, java, BOOK_ONLY_TREE)
    expect(plan.steps.map((s) => (s.resultLabel.t === 'product' ? s.resultLabel.targetLineage : 'final'))).toEqual([true, false, true, false, true, 'final'])
  })
})

describe('summarize', () => {
  it('groups identical books (boots + Unbreaking I x4, Java [13, 7, 141, 7] / Bedrock [9, 5, 85, 7])', () => {
    const problem = advanced({ target: { itemType: 'boots', enchantments: {}, anvilUses: 0 }, books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }] })
    const tree = node(node(node(leaf(0), leaf(1)), leaf(2)), node(leaf(3), leaf(4)))
    const javaPlan = build(problem, java, tree)
    expect(keys(javaPlan.summary)).toEqual([13, 7, 141, 7])
    expect(javaPlan.summary.finalEnchantments).toEqual({ unbreaking: 3 })
    expect(javaPlan.summary.booksRequired).toEqual([{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4, inputs: [1, 2, 3, 4] }])
    expect(keys(build(problem, bedrock, tree).summary)).toEqual([9, 5, 85, 7])
  })

  it('reports the cost of applying a combined book ([49, 12, 793, 15], apply 58)', () => {
    for (const settings of [java, bedrock]) {
      const { np, plan, summary } = build(BOOK_ONLY, settings, BOOK_ONLY_TREE)
      expect(keys(summary)).toEqual([49, 12, 793, 15])
      expect(summary.applyToFreshItem).toEqual({ cost: 58, tooExpensive: true })
      expect(plan.final.kind).toBe('book')
      expectConsistent(plan, np, settings)
    }
    expect(build(BOOK_ONLY, uncapped(java), BOOK_ONLY_TREE).summary.applyToFreshItem).toEqual({ cost: 58, tooExpensive: false })
  })

  it('reports a book that fits the cap (sword books: [31, 10, 435, 7], apply 33)', () => {
    const problem: SimpleProblem = {
      mode: 'simple',
      item: 'enchanted_book',
      enchantments: [
        { id: 'sharpness', level: 5 }, { id: 'looting', level: 3 }, { id: 'unbreaking', level: 3 },
        { id: 'mending', level: 1 }, { id: 'fire_aspect', level: 2 }, { id: 'sweeping_edge', level: 3 },
      ],
    }
    // optimal tree confirmed by brute force: ((Looting + Sweeping Edge) + (Sharpness + Unbreaking)) + (Fire Aspect + Mending)
    const { summary } = build(problem, java, node(node(node(leaf(1), leaf(5)), node(leaf(0), leaf(2))), node(leaf(4), leaf(3))))
    expect(keys(summary)).toEqual([31, 10, 435, 7])
    expect(summary.applyToFreshItem).toEqual({ cost: 33, tooExpensive: false })
  })

  it('matches the cost of really applying the final book to a fresh item', () => {
    for (const settings of [java, bedrock]) {
      const { plan, summary } = build(BOOK_ONLY, settings, BOOK_ONLY_TREE)
      const book = { kind: 'book' as const, itemType: null, enchantments: levelsOf(plan.final), anvilUses: plan.final.anvilUses, named: false }
      const accepting = itemsInEdition(settings.edition).filter((item) => !getItem(item.id).isBook && plan.final.enchantments.every((e) => isApplicable(settings.edition, item.id, e.id)))
      expect(accepting.map((item) => item.id)).toContain('boots')
      for (const item of accepting) {
        const outcome = combine({ kind: 'item', itemType: item.id, enchantments: {}, anvilUses: 0, named: false }, book, { edition: settings.edition, levelCap: null, rename: false })
        expect(outcome.ok && outcome.cost).toBe(summary.applyToFreshItem?.cost)
      }
    }
  })
})

describe('discardedEnchantments', () => {
  it('reports the Sharpness V that the cheapest plan blocks with the Smite book (Java [9, 8, 119, 3] / Bedrock [8, 7, 98, 3])', () => {
    for (const [settings, expected] of [[java, [9, 8, 119, 3]], [bedrock, [8, 7, 98, 3]]] as const) {
      const { np, plan, summary } = build(SMITE_BLOCKS_SHARPNESS, settings, SMITE_BLOCKS_SHARPNESS_TREE)
      expect(keys(summary)).toEqual(expected)
      expect(discardedEnchantments(plan, np, settings)).toEqual([{ id: 'sharpness', inputLevel: 5, finalLevel: 0, inputs: [2], reason: 'conflict' }])
      const line = plan.steps[1].cost.enchantments.find((l) => l.id === 'sharpness')
      expect(line).toMatchObject({ outcome: 'conflict', conflictsWith: ['smite'], cost: 0, resultLevel: 0 })
      expect(plan.steps[1].cost.conflictPenalty).toBe(settings.edition === 'java' ? 1 : 0)
    }
  })

  it('uses reason inapplicable for an enchantment the target cannot take (Sharpness on a pickaxe)', () => {
    const problem = advanced({ target: { itemType: 'pickaxe', enchantments: {}, anvilUses: 0 }, books: [{ enchantments: { sharpness: 5, efficiency: 1 }, anvilUses: 0 }] })
    const { np, plan } = build(problem, java, node(leaf(0), leaf(1)))
    expect(discardedEnchantments(plan, np, java)).toEqual([{ id: 'sharpness', inputLevel: 5, finalLevel: 0, inputs: [1], reason: 'inapplicable' }])
  })

  it('uses reason inapplicable even when the blocked line is a conflict (Density onto a Sharpness sword)', () => {
    const problem = advanced({ target: { itemType: 'sword', enchantments: { sharpness: 5 }, anvilUses: 0 }, books: [{ enchantments: { density: 5, unbreaking: 3 }, anvilUses: 0 }] })
    const { np, plan } = build(problem, java, node(leaf(0), leaf(1)))
    expect(plan.steps[0].cost.enchantments.find((l) => l.id === 'density')?.outcome).toBe('conflict')
    expect(discardedEnchantments(plan, np, java)).toEqual([{ id: 'density', inputLevel: 5, finalLevel: 0, inputs: [1], reason: 'inapplicable' }])
  })

  it('reports a level that ends lower than on an input', () => {
    // book{Smite I} blocks Sharpness V and is then blocked by the target's Sharpness III, so the result keeps Sharpness III
    const problem = advanced({
      target: { itemType: 'sword', enchantments: { sharpness: 3 }, anvilUses: 0 },
      books: [{ enchantments: { smite: 1 }, anvilUses: 0 }, { enchantments: { sharpness: 5, looting: 3 }, anvilUses: 0 }],
      goal: { looting: 3 },
    })
    const { np, plan } = build(problem, java, node(leaf(0), node(leaf(1), leaf(2))))
    expect(plan.steps.map((s) => s.cost.total)).toEqual([7, 8])
    expect(discardedEnchantments(plan, np, java)).toEqual([
      { id: 'sharpness', inputLevel: 5, finalLevel: 3, inputs: [2], reason: 'conflict' },
      { id: 'smite', inputLevel: 1, finalLevel: 0, inputs: [1], reason: 'conflict' },
    ])
  })

  it('lists every used input that carries a discarded enchantment (book-only: all reasons are conflict)', () => {
    const problem = advanced({
      books: [
        { enchantments: { smite: 1 }, anvilUses: 0 },
        { enchantments: { sharpness: 5, looting: 3 }, anvilUses: 0 },
        { enchantments: { sharpness: 3, unbreaking: 1 }, anvilUses: 0 },
      ],
    })
    const { np, plan } = build(problem, java, node(node(leaf(0), leaf(1)), leaf(2)))
    expect(discardedEnchantments(plan, np, java)).toEqual([{ id: 'sharpness', inputLevel: 5, finalLevel: 0, inputs: [1, 2], reason: 'conflict' }])
  })

  it('reports nothing when every enchantment reaches the result', () => {
    const { np, plan } = build(BOOTS, java, BOOTS_TREE)
    expect(discardedEnchantments(plan, np, java)).toEqual([])
  })
})

describe('planWarnings', () => {
  it('reports the Sharpness blocked by the Smite book, the extra Smite, and the keep value passed in', () => {
    const { np, plan, summary } = build(SMITE_BLOCKS_SHARPNESS, java, SMITE_BLOCKS_SHARPNESS_TREE)
    const keep = { enchantments: { sharpness: 5 }, totalLevels: 11, maxStepLevels: 11 }
    expect(planWarnings(plan, summary, np, java, keep)).toEqual([
      { code: 'result-has-extra-enchantments', enchantments: ['smite'] },
      { code: 'enchantments-discarded', items: [{ id: 'sharpness', inputLevel: 5, finalLevel: 0, inputs: [2], reason: 'conflict' }], keep },
    ])
    expect(planWarnings(plan, summary, np, java).find((w) => w.code === 'enchantments-discarded')).toMatchObject({ keep: null })
  })

  it('no goal: lists the discarded one of Sharpness V and Smite V, but not again as below its reachable level', () => {
    const problem = advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }, { enchantments: { smite: 5 }, anvilUses: 0 }, { enchantments: { looting: 3 }, anvilUses: 0 }],
      goal: null,
      useOnlyNeeded: false,
    })
    const tree = node(node(leaf(0), leaf(1)), node(leaf(3), leaf(2)))
    const { np, plan, summary } = build(problem, java, tree)
    expect(keys(summary)).toEqual([19, 9, 245, 3])
    expect(keys(build(problem, bedrock, tree).summary)).toEqual([18, 8, 222, 3])
    expect(planWarnings(plan, summary, np, java)).toEqual([
      { code: 'enchantments-discarded', items: [{ id: 'smite', inputLevel: 5, finalLevel: 0, inputs: [2], reason: 'conflict' }], keep: null },
    ])
  })

  it('no goal: reports an enchantment below its reachable level when the maxima cannot all be reached (Java [14, 7, 158, 3] / Bedrock [8, 4, 74, 3])', () => {
    const problem = advanced({
      target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
      books: [
        { enchantments: { unbreaking: 1, feather_falling: 1 }, anvilUses: 0 },
        { enchantments: { unbreaking: 1, feather_falling: 2 }, anvilUses: 0 },
        { enchantments: { unbreaking: 2, feather_falling: 1 }, anvilUses: 0 },
      ],
      goal: null,
      useOnlyNeeded: false,
    })
    // one of the optimal trees confirmed by brute force (result {Feather Falling III, Unbreaking II})
    const { np, plan, summary } = build(problem, java, node(node(leaf(0), leaf(2)), node(leaf(1), leaf(3))))
    expect(keys(summary)).toEqual([14, 7, 158, 3])
    expect(summary.finalEnchantments).toEqual({ feather_falling: 3, unbreaking: 2 })
    expect(planWarnings(plan, summary, np, java)).toEqual([{ code: 'below-reachable-level', items: [{ id: 'unbreaking', level: 2, reachable: 3 }] }])
    expect(keys(build(problem, bedrock, node(node(leaf(0), leaf(2)), node(leaf(3), leaf(1)))).summary)).toEqual([8, 4, 74, 3])
  })

  it('does not call enchantments the target already had extra', () => {
    const problem = advanced({
      target: { itemType: 'pickaxe', enchantments: { silk_touch: 1, unbreaking: 1 }, anvilUses: 0 },
      books: [{ enchantments: { efficiency: 5, unbreaking: 3 }, anvilUses: 0 }],
      goal: { efficiency: 5 },
    })
    const { np, plan, summary } = build(problem, java, node(leaf(0), leaf(1)))
    // Unbreaking went up from I to III, so it counts; Silk Touch is unchanged
    expect(planWarnings(plan, summary, np, java)).toEqual([{ code: 'result-has-extra-enchantments', enchantments: ['unbreaking'] }])
  })

  it('warns that the combined boots book is too expensive to apply', () => {
    const { np, plan, summary } = build(BOOK_ONLY, java, BOOK_ONLY_TREE)
    expect(planWarnings(plan, summary, np, java)).toEqual([{ code: 'final-book-too-expensive-to-apply', cost: 58 }])
  })

  it('without a cap: steps over the survival limit and inapplicable enchantments real Creative would add', () => {
    const problem = advanced({
      target: { itemType: 'pickaxe', enchantments: {}, anvilUses: 5 },
      books: [{ enchantments: { sharpness: 5, efficiency: 5 }, anvilUses: 0 }, { enchantments: { fortune: 3 }, anvilUses: 0 }],
      goal: { efficiency: 5 },
      useOnlyNeeded: false,
    })
    const settings = uncapped(java)
    const { np, plan, summary } = build(problem, settings, node(leaf(0), node(leaf(1), leaf(2))))
    expect(plan.steps.map((s) => s.cost.total)).toEqual([6, 31 + 1 + 5 + 6])
    expect(planWarnings(plan, summary, np, settings)).toEqual([
      { code: 'steps-over-survival-limit', steps: [2] },
      { code: 'creative-inapplicable-ignored', enchantments: ['sharpness'] },
      { code: 'result-has-extra-enchantments', enchantments: ['fortune'] },
      { code: 'enchantments-discarded', items: [{ id: 'sharpness', inputLevel: 5, finalLevel: 0, inputs: [1], reason: 'inapplicable' }], keep: null },
    ])
  })

  it('Bedrock: a trident with Loyalty as the sacrifice uses the assumed multiplier', () => {
    const problem = advanced({
      target: { itemType: 'trident', enchantments: {}, anvilUses: 0 },
      extraItems: [{ enchantments: { loyalty: 3 }, anvilUses: 0 }],
      goal: { loyalty: 3 },
    })
    for (const [settings, warned] of [[bedrock, true], [java, false]] as const) {
      const { np, plan, summary } = build(problem, settings, node(leaf(0), leaf(1)))
      expect(plan.steps[0].cost.total).toBe(6)
      expect(planWarnings(plan, summary, np, settings).some((w) => w.code === 'bedrock-unverified-value' && w.detail === 'loyalty-item-multiplier')).toBe(warned)
    }
  })

  it('lists unused inputs', () => {
    const { np, plan, summary } = build(SMITE_BLOCKS_SHARPNESS, java, node(leaf(0), leaf(2)))
    expect(planWarnings(plan, summary, np, java).at(-1)).toEqual({ code: 'inputs-unused', inputs: [1] })
  })
})

describe('agrees with the UI fixtures (src/ui/dev/fixtures.ts)', () => {
  // The fixtures are built with their own copy of the anvil rules; the engine must give the same plan, summary, baseline and warnings.
  const okFixtures = Object.values(getFixtures()).filter((f) => f.result.status === 'ok')

  it('covers the ok fixtures', () => {
    expect(okFixtures.map((f) => f.name)).toEqual(['bootsSevenBooks', 'bootsRename', 'bootsBedrock', 'bookOnly', 'advancedUnused', 'advancedRename', 'creative40'])
  })

  it.each(okFixtures.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    if (fixture.result.status !== 'ok') throw new Error('not ok')
    const expected = fixture.result
    const np = normalizeProblem(fixture.problem, fixture.settings)
    const plan = buildPlan(expected.plan.tree, np, fixture.settings)
    const summary = summarize(plan, np, fixture.settings)
    expect(plan).toEqual(expected.plan)
    expect(summary).toEqual(expected.summary)
    expect(computeBaseline(np, fixture.settings, plan.usedInputs, summary)).toEqual(expected.baseline)
    expect(planWarnings(plan, summary, np, fixture.settings)).toEqual(expected.warnings.filter((w) => w.code !== 'bedrock-rules-from-wiki'))
  })
})

describe('random trees replay with the rules', () => {
  // Random input orders and tree shapes, no cap, target as the leftmost leaf. Every book carries a different enchantment and
  // nothing conflicts, so every step is accepted; Bedrock never refuses a step that changes nothing either, because only
  // Unbreaking overlaps with the target and the book's Unbreaking III raises the target's I.
  const ids: EnchantmentId[] = ['protection', 'feather_falling', 'unbreaking', 'mending', 'thorns', 'depth_strider', 'soul_speed']
  const problem = advanced({
    target: { itemType: 'boots', enchantments: { unbreaking: 1 }, anvilUses: 1 },
    books: ids.map((id, i) => ({ enchantments: { [id]: id === 'mending' ? 1 : 1 + (i % 3) }, anvilUses: i % 2 })),
    goal: null,
    useOnlyNeeded: false,
  })
  const treeOver = (order: readonly number[], splits: readonly number[]): PlanNode => {
    let k = 0
    const make = (xs: readonly number[]): PlanNode => {
      if (xs.length === 1) return leaf(xs[0])
      const cut = 1 + (splits[k++ % splits.length] % (xs.length - 1))
      return node(make(xs.slice(0, cut)), make(xs.slice(cut)))
    }
    return make(order)
  }

  it.each(['java', 'bedrock'] as const)('%s', (edition) => {
    const settings: Settings = { ...java, edition, levelCap: null }
    const np = normalizeProblem(problem, settings)
    const books = ids.map((_, i) => i + 1)
    fc.assert(
      fc.property(
        fc.shuffledSubarray(books, { minLength: books.length, maxLength: books.length }),
        fc.array(fc.nat(100), { minLength: 1, maxLength: 10 }),
        (order, splits) => {
          const plan = buildPlan(treeOver([0, ...order], splits), np, settings)
          expect(plan.usedInputs).toEqual([0, ...books])
          expectConsistent(plan, np, settings)
          const summary = summarize(plan, np, settings)
          expect(summary.totalLevels).toBe(plan.steps.reduce((sum, s) => sum + s.cost.total, 0))
          expect(summary.finalPriorWorkPenalty).toBe(pwp(plan.final.anvilUses))
        },
      ),
      { seed: 20260927, numRuns: 300 },
    )
  })
})
