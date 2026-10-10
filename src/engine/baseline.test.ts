import { allInputsBaselineSeed, computeBaseline, inputWeight, oneAtATime, type BaselineComparison } from './baseline.ts'
import { normalizeProblem } from './normalize.ts'
import { pwp } from './rules.ts'
import type { AdvancedProblem, EnchantLevels, Settings, SimpleProblem } from './types.ts'
import { xpAtLevel } from './xp.ts'

const java: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
const bedrock: Settings = { ...java, edition: 'bedrock' }

const advanced = (overrides: Partial<AdvancedProblem>): AdvancedProblem =>
  ({ mode: 'advanced', target: null, extraItems: [], books: [], goal: null, useOnlyNeeded: true, ...overrides })
const plan = (totalLevels: number, xpPoints: number, finalEnchantments: EnchantLevels = {}): BaselineComparison => ({ totalLevels, xpPoints, finalEnchantments })
const xpOf = (costs: readonly number[]): number => costs.reduce((sum, cost) => sum + xpAtLevel(cost), 0)

/** Inputs: 0 boots, 1 Protection IV ... 7 Mending. The optimal plan is [66, 16, 1246, 15]. */
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
const ALL_BOOTS_INPUTS = [0, 1, 2, 3, 4, 5, 6, 7]
const BOOTS_PLAN = plan(66, 1246)

const SHARPNESS_SWORD_SMITE_LOOTING = advanced({
  target: { itemType: 'sword', enchantments: { sharpness: 5 }, anvilUses: 0 },
  books: [{ enchantments: { smite: 5 }, anvilUses: 0 }, { enchantments: { looting: 3 }, anvilUses: 0 }],
  goal: null,
  useOnlyNeeded: false,
})

describe('inputWeight', () => {
  it('uses the book multiplier for books and the item multiplier for items', () => {
    const np = normalizeProblem(advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
      extraItems: [{ enchantments: { sharpness: 5, looting: 3 }, anvilUses: 0 }],
      books: [{ enchantments: { sharpness: 5, looting: 3 }, anvilUses: 0 }],
    }), java)
    expect(inputWeight(np.inputs[1], 'java')).toBe(1 * 5 + 4 * 3)
    expect(inputWeight(np.inputs[2], 'java')).toBe(1 * 5 + 2 * 3)
    expect(inputWeight(np.inputs[0], 'java')).toBe(0)
  })
})

describe('computeBaseline', () => {
  it('charges 163 for boots + 7 books one at a time, with step 7 too expensive', () => {
    const np = normalizeProblem(BOOTS, java)
    expect(computeBaseline(np, java, ALL_BOOTS_INPUTS, BOOTS_PLAN)).toEqual({
      stepCosts: [12, 13, 9, 11, 19, 34, 65],
      totalLevels: 163,
      maxStepLevels: 65,
      xpPoints: xpOf([12, 13, 9, 11, 19, 34, 65]),
      firstTooExpensiveStep: 7,
      skippedInputs: [],
      achievesGoal: true,
      comparable: false,
      savedLevels: null,
      savedXpPoints: null,
    })
    // Heaviest first; Soul Speed and Thorns both weigh 12, and equal weights keep input order.
    expect(oneAtATime(np, java, ALL_BOOTS_INPUTS).order).toEqual([3, 5, 4, 1, 2, 6, 7])
  })

  it('is comparable without a cap, saving 97 levels', () => {
    const np = normalizeProblem(BOOTS, java)
    const baseline = computeBaseline(np, { ...java, levelCap: null }, ALL_BOOTS_INPUTS, BOOTS_PLAN)
    expect(baseline).toMatchObject({ totalLevels: 163, firstTooExpensiveStep: null, comparable: true, savedLevels: 97 })
    expect(baseline.savedXpPoints).toBe(baseline.xpPoints - 1246)
  })

  it('matches the additive closed form sum of pwp(u + k) + sum of w (boots with 2 anvil uses)', () => {
    const problem = advanced({
      target: { itemType: 'boots', enchantments: {}, anvilUses: 2 },
      books: BOOTS.enchantments.map((e) => ({ enchantments: { [e.id]: e.level }, anvilUses: 0 })),
      goal: {},
    })
    const np = normalizeProblem(problem, java)
    const weights = np.inputs.slice(1).reduce((sum, input) => sum + inputWeight(input, 'java'), 0)
    const closedForm = [0, 1, 2, 3, 4, 5, 6].reduce((sum, k) => sum + pwp(2 + k), 0) + weights
    expect(computeBaseline(np, { ...java, levelCap: null }, ALL_BOOTS_INPUTS, plan(83, 0)).totalLevels).toBe(closedForm)
    expect(closedForm).toBe(544)
  })

  it('skips the Smite book that cannot go on sword{Sharpness V}, so the chain is not comparable (not −7 levels)', () => {
    const np = normalizeProblem(SHARPNESS_SWORD_SMITE_LOOTING, java)
    expect(computeBaseline(np, java, [0, 1, 2], plan(13, xpOf([6, 7]), { sharpness: 5, looting: 3 }))).toEqual({
      stepCosts: [6],
      totalLevels: 6,
      maxStepLevels: 6,
      xpPoints: xpAtLevel(6),
      firstTooExpensiveStep: null,
      skippedInputs: [1],
      achievesGoal: true,
      comparable: false,
      savedLevels: null,
      savedXpPoints: null,
    })
  })

  it('makes the same chain comparable with the goal Looting III, saving nothing', () => {
    const np = normalizeProblem({ ...SHARPNESS_SWORD_SMITE_LOOTING, goal: { looting: 3 }, useOnlyNeeded: true }, java)
    expect(computeBaseline(np, java, [0, 2], plan(6, xpAtLevel(6)))).toMatchObject({ stepCosts: [6], comparable: true, savedLevels: 0, savedXpPoints: 0 })
  })

  it('charges 38 one at a time against 26 for the advancedUnused fixture', () => {
    const problem = advanced({
      target: { itemType: 'pickaxe', enchantments: { efficiency: 4, unbreaking: 3 }, anvilUses: 2 },
      books: [
        { enchantments: { efficiency: 4 }, anvilUses: 0 },
        { enchantments: { mending: 1 }, anvilUses: 0 },
        { enchantments: { fortune: 3 }, anvilUses: 0 },
        { enchantments: { silk_touch: 1 }, anvilUses: 0 },
        { enchantments: { unbreaking: 2 }, anvilUses: 0 },
      ],
      goal: { efficiency: 5, fortune: 3, unbreaking: 3, mending: 1 },
    })
    const np = normalizeProblem(problem, java)
    const baseline = computeBaseline(np, java, [0, 1, 2, 3], plan(26, 448))
    expect(baseline).toMatchObject({ stepCosts: [9, 12, 17], totalLevels: 38, comparable: true, savedLevels: 12, savedXpPoints: xpOf([9, 12, 17]) - 448 })
  })

  it('book-only: the heaviest used book is the base (ties by input index)', () => {
    const np = normalizeProblem({ ...BOOTS, item: 'enchanted_book' }, java)
    const inputs = [0, 1, 2, 3, 4, 5, 6]
    const chain = oneAtATime(np, java, inputs)
    // Soul Speed (2) and Thorns (4) both weigh 12, so Soul Speed, the lower index, is the base.
    expect(chain.base).toBe(2)
    expect(chain.order).toEqual([4, 3, 0, 1, 5, 6])
    expect(chain.final.kind).toBe('book')
    const baseline = computeBaseline(np, java, inputs, plan(49, 793))
    expect(baseline).toMatchObject({ stepCosts: [12, 7, 7, 11, 18, 33], totalLevels: 88, comparable: true, savedLevels: 39 })
  })

  it('renames on the first accepted step (fixture bootsRename: 164, still not comparable)', () => {
    const np = normalizeProblem(BOOTS, java)
    const renamed: Settings = { ...java, rename: true }
    expect(computeBaseline(np, renamed, ALL_BOOTS_INPUTS, plan(67, 1253))).toMatchObject({
      stepCosts: [13, 13, 9, 11, 19, 34, 65],
      totalLevels: 164,
      comparable: false,
    })
    const chain = oneAtATime(np, renamed, ALL_BOOTS_INPUTS)
    expect(chain.final.named).toBe(true)
  })

  it('moves the rename to the next step when the first input is skipped', () => {
    const np = normalizeProblem(advanced({
      target: { itemType: 'sword', enchantments: { sharpness: 5 }, anvilUses: 0 },
      books: [{ enchantments: { smite: 5 }, anvilUses: 0 }, { enchantments: { looting: 1 }, anvilUses: 0 }],
      goal: null,
      useOnlyNeeded: false,
    }), java)
    const chain = oneAtATime(np, { ...java, rename: true }, [0, 1, 2])
    expect(chain).toMatchObject({ order: [1, 2], stepCosts: [3], skippedInputs: [1] })
    expect(chain.final.named).toBe(true)
  })

  it('renames with a rename-only step when nothing is combined (Java boots with 6 anvil uses: clamped to 39)', () => {
    const np = normalizeProblem(advanced({ target: { itemType: 'boots', enchantments: { unbreaking: 3 }, anvilUses: 6 }, goal: { unbreaking: 3 } }), java)
    const renamed: Settings = { ...java, rename: true }
    expect(computeBaseline(np, renamed, [0], plan(39, xpAtLevel(39)))).toMatchObject({ stepCosts: [39], comparable: true, savedLevels: 0 })
    expect(computeBaseline(np, java, [0], plan(0, 0))).toMatchObject({ stepCosts: [], totalLevels: 0, maxStepLevels: 0, comparable: true, savedLevels: 0 })
  })

  it('skips a Bedrock step that changes no enchantment level, so the chain misses the goal', () => {
    const problem = advanced({ target: { itemType: 'boots', enchantments: {}, anvilUses: 0 }, books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }], goal: { unbreaking: 3 } })
    const np = normalizeProblem(problem, bedrock)
    expect(computeBaseline(np, bedrock, [0, 1, 2, 3, 4], plan(9, 85))).toMatchObject({
      stepCosts: [1, 2],
      totalLevels: 3,
      skippedInputs: [3, 4],
      achievesGoal: false,
      comparable: false,
      savedLevels: null,
    })
    // Java accepts the same steps and charges for them although the level does not change.
    expect(computeBaseline(np, java, [0, 1, 2, 3, 4], plan(13, 141))).toMatchObject({ stepCosts: [1, 3, 5, 9], skippedInputs: [], achievesGoal: false })
  })

  it('compares the chain result with the plan result when there is no goal', () => {
    const problem = advanced({ target: { itemType: 'boots', enchantments: {}, anvilUses: 0 }, books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }], goal: null, useOnlyNeeded: false })
    const np = normalizeProblem(problem, java)
    expect(computeBaseline(np, java, [0, 1, 2, 3, 4], plan(13, 141, { unbreaking: 3 }))).toMatchObject({ achievesGoal: false, comparable: false })
    expect(computeBaseline(np, java, [0, 1, 2, 3, 4], plan(12, 0, { unbreaking: 2 }))).toMatchObject({ achievesGoal: true, comparable: true, savedLevels: 18 - 12 })
  })

  it('rejects a chain without the target', () => {
    const np = normalizeProblem(SHARPNESS_SWORD_SMITE_LOOTING, java)
    expect(() => oneAtATime(np, java, [1, 2])).toThrow(/must use the target/)
    expect(() => oneAtATime(np, java, [])).toThrow(/at least one input/)
  })
})

describe('allInputsBaselineSeed', () => {
  it('is null when a step is over the cap, and the chain values without a cap', () => {
    const np = normalizeProblem(BOOTS, java)
    expect(allInputsBaselineSeed(np, java)).toBeNull()
    expect(allInputsBaselineSeed(np, { ...java, levelCap: null })).toEqual({ totalLevels: 163, maxStepLevels: 65, xpPoints: xpOf([12, 13, 9, 11, 19, 34, 65]), finalAnvilUses: 7 })
  })

  it('is null when the chain skips an input or misses the goal (Bedrock boots + Unbreaking I x4)', () => {
    const problem = advanced({ target: { itemType: 'boots', enchantments: {}, anvilUses: 0 }, books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }], goal: { unbreaking: 3 } })
    expect(allInputsBaselineSeed(normalizeProblem(problem, bedrock), bedrock)).toBeNull()
    expect(allInputsBaselineSeed(normalizeProblem(SHARPNESS_SWORD_SMITE_LOOTING, java), java)).toBeNull()
  })

  it('without a goal, needs every reachable level and no conflicting eligible enchantments', () => {
    // Unbreaking I x4 one at a time ends at II, although III is reachable.
    const stacked = advanced({ target: { itemType: 'boots', enchantments: {}, anvilUses: 0 }, books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }], goal: null, useOnlyNeeded: false })
    expect(allInputsBaselineSeed(normalizeProblem(stacked, java), java)).toBeNull()
    // Sharpness V and Smite V conflict, so there is no single maximal result.
    const conflicting = advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }, { enchantments: { smite: 5 }, anvilUses: 0 }],
      goal: null,
      useOnlyNeeded: false,
    })
    expect(allInputsBaselineSeed(normalizeProblem(conflicting, java), java)).toBeNull()
    const plain = advanced({
      target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { protection: 4 }, anvilUses: 0 }, { enchantments: { feather_falling: 4 }, anvilUses: 0 }],
      goal: null,
      useOnlyNeeded: false,
    })
    expect(allInputsBaselineSeed(normalizeProblem(plain, java), java)).toEqual({ totalLevels: 9, maxStepLevels: 5, xpPoints: xpOf([4, 5]), finalAnvilUses: 2 })
  })

  it('with a goal and rename, uses the renamed chain', () => {
    const problem = { ...SHARPNESS_SWORD_SMITE_LOOTING, books: [SHARPNESS_SWORD_SMITE_LOOTING.books[1]], goal: { looting: 3 }, useOnlyNeeded: true }
    const np = normalizeProblem(problem, java)
    expect(allInputsBaselineSeed(np, java)).toEqual({ totalLevels: 6, maxStepLevels: 6, xpPoints: xpAtLevel(6), finalAnvilUses: 1 })
    expect(allInputsBaselineSeed(np, { ...java, rename: true })).toEqual({ totalLevels: 7, maxStepLevels: 7, xpPoints: xpAtLevel(7), finalAnvilUses: 1 })
  })

  it('leaves out the inputs left out of the search with a goal and useOnlyNeeded', () => {
    // sword{Sharpness V} + Looting III + Aqua Affinity: the Aqua Affinity book is left out, so the chain uses only the Looting book.
    const problem = { ...SHARPNESS_SWORD_SMITE_LOOTING, books: [SHARPNESS_SWORD_SMITE_LOOTING.books[1], { enchantments: { aqua_affinity: 1 }, anvilUses: 0 }], goal: { looting: 3 }, useOnlyNeeded: true }
    const np = normalizeProblem(problem, java)
    expect(np.excludedInputs).toEqual([2])
    expect(allInputsBaselineSeed(np, java)).toEqual({ totalLevels: 6, maxStepLevels: 6, xpPoints: xpAtLevel(6), finalAnvilUses: 1 })
    // When every input is used, nothing is left out; Aqua Affinity cannot go on a sword, so the chain skips that book and is no seed.
    expect(allInputsBaselineSeed(normalizeProblem({ ...problem, useOnlyNeeded: false }, java), java)).toBeNull()
  })
})
