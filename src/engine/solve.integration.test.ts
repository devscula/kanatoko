// Values not written out here, such as suggestion totals, are checked against the brute-force oracle in src/test/oracle.

import { bruteForceSolve } from '../test/oracle/bruteForce.ts'
import { applySuggestion } from '../test/crossCheck/oracleCrossCheck.ts'
import { expectOk, expectPlanProperties, keyVectorOf, scenarioValues, warningOf } from '../test/crossCheck/planChecks.ts'
import { estimateComplexity } from './complexity.ts'
import { enchantmentUniverse } from './compile.ts'
import { checkAdditive } from './fastPath.ts'
import { normalizeProblem } from './normalize.ts'
import { createSolveTask, solveSync, type SolveTaskProgress } from './solve.ts'
import type {
  AdvancedProblem,
  BookInput,
  EnchantLevels,
  Problem,
  Settings,
  SimpleProblem,
  SolveInfeasible,
  SolveOk,
  SolveOptions,
  SolveResult,
  TargetInput,
} from './types.ts'
import type { ItemTypeId } from '../data/types.ts'

const JAVA: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
const BEDROCK: Settings = { ...JAVA, edition: 'bedrock' }

const advanced = (overrides: Partial<AdvancedProblem>): AdvancedProblem =>
  ({ mode: 'advanced', target: null, extraItems: [], books: [], goal: null, useOnlyNeeded: true, ...overrides })
const item = (itemType: ItemTypeId, anvilUses = 0, enchantments: EnchantLevels = {}): TargetInput => ({ itemType, enchantments, anvilUses })
const books = (...levels: EnchantLevels[]): BookInput[] => levels.map((enchantments) => ({ enchantments, anvilUses: 0 }))

function expectStatus<S extends SolveResult['status']>(result: SolveResult, status: S): Extract<SolveResult, { status: S }> {
  if (result.status !== status) throw new Error(`expected status '${status}', got ${JSON.stringify(result).slice(0, 1500)}`)
  return result as Extract<SolveResult, { status: S }>
}

/** Also checks the plan properties. */
function solveOk(problem: Problem, settings: Settings, options: SolveOptions = {}): SolveOk {
  const ok = expectOk(solveSync(problem, settings, options))
  expectPlanProperties(ok, { problem, settings, levelCap: options.levelCapOverride })
  return ok
}

function oracleKeys(problem: Problem, settings: Settings, levelCapOverride?: number | null) {
  const oracle = bruteForceSolve(problem, settings, levelCapOverride === undefined ? {} : { levelCapOverride })
  return oracle.best === null ? null : oracle.best[settings.objective].keys
}

const MAX_BOOTS_BOOKS = books({ soul_speed: 3 }, { thorns: 3 }, { feather_falling: 4 }, { depth_strider: 3 }, { protection: 4 }, { unbreaking: 3 }, { mending: 1 })
const BOOTS_WITH_MAX_BOOKS = advanced({ target: item('boots'), books: MAX_BOOTS_BOOKS })
const SHARPNESS_SWORD_SMITE_LOOTING = advanced({ target: item('sword', 0, { sharpness: 5 }), books: books({ smite: 5 }, { looting: 3 }) })
const MACE_SIMPLE_MODE: SimpleProblem = {
  mode: 'simple',
  item: 'mace',
  enchantments: [{ id: 'wind_burst', level: 3, sources: [{ level: 1, count: 4 }] }, { id: 'density', level: 5 }, { id: 'unbreaking', level: 3 }, { id: 'mending', level: 1 }],
}
const SMITE_BLOCKS_SHARPNESS = advanced({ target: item('sword'), books: books({ smite: 1 }, { sharpness: 5, looting: 3 }), goal: { looting: 3 } })
const BOOTS_MIXED_UNBREAKING_FEATHER_FALLING = advanced({ target: item('boots'), books: books({ unbreaking: 1, feather_falling: 1 }, { unbreaking: 1, feather_falling: 2 }, { unbreaking: 2, feather_falling: 1 }) })
const SWORD_SHARPNESS_OR_SMITE = advanced({ target: item('sword'), books: books({ sharpness: 5 }, { smite: 5 }, { looting: 3 }) })

describe('scenarios through solveSync (Java, cap 39, levels, every input used unless noted)', () => {
  it('boots + 7 max books -> [66, 16, 1246, 15] by the tree-table method, and the same by the exact search', () => {
    const table = solveOk(BOOTS_WITH_MAX_BOOKS, JAVA)
    expect(table.method).toBe('tree-table')
    expect(scenarioValues(table)).toEqual([66, 16, 1246, 15])
    const exact = solveOk(BOOTS_WITH_MAX_BOOKS, JAVA, { forceMethod: 'exact' })
    expect(exact.method).toBe('exact')
    expect(scenarioValues(exact)).toEqual([66, 16, 1246, 15])
    expect(scenarioValues(solveOk(BOOTS_WITH_MAX_BOOKS, BEDROCK))).toEqual([66, 16, 1246, 15])
    expect(scenarioValues(solveOk(BOOTS_WITH_MAX_BOOKS, { ...JAVA, levelCap: null }))).toEqual([66, 16, 1246, 15])
    const simple: SimpleProblem = {
      mode: 'simple',
      item: 'boots',
      enchantments: [
        { id: 'soul_speed', level: 3 }, { id: 'thorns', level: 3 }, { id: 'feather_falling', level: 4 }, { id: 'depth_strider', level: 3 },
        { id: 'protection', level: 4 }, { id: 'unbreaking', level: 3 }, { id: 'mending', level: 1 },
      ],
    }
    expect(solveOk(simple, JAVA)).toMatchObject({ method: 'tree-table', summary: { totalLevels: 66, maxStepLevels: 16, xpPoints: 1246 } })
  })

  it('boots + 7 max books with objective xp or finalPwp, and with rename', () => {
    const xp = solveOk(BOOTS_WITH_MAX_BOOKS, { ...JAVA, objective: 'xp' })
    expect(scenarioValues(xp).slice(0, 3)).toEqual([66, 16, 1246])
    expect(xp.method).toBe('exact')   // the tree-table method only handles objective levels
    expect(scenarioValues(solveOk(BOOTS_WITH_MAX_BOOKS, { ...JAVA, objective: 'finalPwp' }))).toEqual([68, 21, 1456, 7])
    const renamed = solveOk(BOOTS_WITH_MAX_BOOKS, { ...JAVA, rename: true })
    expect(renamed.method).toBe('tree-table')
    expect(scenarioValues(renamed)).toEqual([67, 16, 1253, 15])
    expect(renamed.plan.steps[0]).toMatchObject({ kind: 'rename', cost: { total: 1 } })
  })

  it.each([[0, 45], [1, 50], [2, 58]])('helmet with %i anvil uses + 6 books -> %i', (uses, total) => {
    const problem = advanced({
      target: item('helmet', uses),
      books: books({ protection: 4 }, { thorns: 3 }, { respiration: 3 }, { aqua_affinity: 1 }, { unbreaking: 3 }, { mending: 1 }),
    })
    expect(solveOk(problem, JAVA).summary.totalLevels).toBe(total)
  })

  it('boots with 2 anvil uses + the 7 max books -> 83', () => {
    expect(solveOk(advanced({ target: item('boots', 2), books: MAX_BOOTS_BOOKS }), JAVA).summary.totalLevels).toBe(83)
  })

  it('boots with 3 anvil uses + 5 books -> [79, 32, 3423, 31]', () => {
    const problem = advanced({ target: item('boots', 3), books: books({ soul_speed: 3 }, { thorns: 3 }, { feather_falling: 4 }, { depth_strider: 3 }, { protection: 4 }) })
    expect(scenarioValues(solveOk(problem, JAVA))).toEqual([79, 32, 3423, 31])
  })

  it('books only, Sharpness IV x2 + Unbreaking III -> [9, 5, 95, 3]', () => {
    const result = solveOk(advanced({ books: books({ sharpness: 4 }, { sharpness: 4 }, { unbreaking: 3 }) }), JAVA)
    expect(scenarioValues(result)).toEqual([9, 5, 95, 3])
    expect(result.summary.finalEnchantments).toEqual({ sharpness: 5, unbreaking: 3 })
  })

  it('sword + Sharpness IV x2, Looting III, Unbreaking III -> [24, 7, 290, 7]', () => {
    const problem = advanced({ target: item('sword'), books: books({ sharpness: 4 }, { sharpness: 4 }, { looting: 3 }, { unbreaking: 3 }) })
    expect(scenarioValues(solveOk(problem, JAVA))).toEqual([24, 7, 290, 7])
  })

  it('trident{Loyalty III, Channeling} + book{Riptide III, Unbreaking III} + book{Mending} -> 8', () => {
    const problem = advanced({ target: item('trident', 0, { loyalty: 3, channeling: 1 }), books: books({ riptide: 3, unbreaking: 3 }, { mending: 1 }) })
    const result = solveOk(problem, JAVA)
    expect(result.summary.totalLevels).toBe(8)
    expect(warningOf(result, 'enchantments-discarded')?.items.map((d) => [d.id, d.reason])).toEqual([['riptide', 'conflict']])
  })

  it('sword{Sharpness V} + book{Smite V} + book{Looting III} -> 13', () => {
    const result = solveOk(SHARPNESS_SWORD_SMITE_LOOTING, JAVA)
    expect(result.summary.totalLevels).toBe(13)
    expect(warningOf(result, 'enchantments-discarded')).toEqual({
      code: 'enchantments-discarded',
      items: [{ id: 'smite', inputLevel: 5, finalLevel: 0, inputs: [1], reason: 'conflict' }],
      keep: null,   // without a goal there is no keep alternative
    })
  })

  it('sword{Sharpness V} + Smite V + Looting III with goal {Looting III} and useOnlyNeeded -> 6, the Smite book unused', () => {
    const result = solveOk({ ...SHARPNESS_SWORD_SMITE_LOOTING, goal: { looting: 3 } }, JAVA)
    expect(result.summary.totalLevels).toBe(6)
    expect(result.plan.unusedInputs).toEqual([1])
    expect(warningOf(result, 'inputs-unused')).toEqual({ code: 'inputs-unused', inputs: [1] })
  })

  it('pickaxe + Efficiency III x2, IV, Unbreaking III, Mending -> Efficiency V (Java [26, 9, 322, 7], Bedrock [19, 7, 209, 7])', () => {
    const problem = advanced({ target: item('pickaxe'), books: books({ efficiency: 3 }, { efficiency: 3 }, { efficiency: 4 }, { unbreaking: 3 }, { mending: 1 }) })
    const java = solveOk(problem, JAVA)
    expect(scenarioValues(java)).toEqual([26, 9, 322, 7])
    expect(java.summary.finalEnchantments.efficiency).toBe(5)
    const bedrock = solveOk(problem, BEDROCK)
    expect(scenarioValues(bedrock)).toEqual([19, 7, 209, 7])
    expect(bedrock.summary.finalEnchantments.efficiency).toBe(5)
    expect(warningOf(java, 'below-reachable-level')).toBeUndefined()
  })

  it('mace + Wind Burst I x4, Density V, Unbreaking III, Mending with the goal at those levels -> [42, 12, 570, 7]', () => {
    const result = solveOk(MACE_SIMPLE_MODE, JAVA)
    expect(scenarioValues(result)).toEqual([42, 12, 570, 7])
    expect(result.summary.finalEnchantments.wind_burst).toBe(3)
  })

  describe('boots + Unbreaking I x3, goal Unbreaking III', () => {
    const problem = advanced({ target: item('boots'), books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 3 }], goal: { unbreaking: 3 } })
    const simple: SimpleProblem = { mode: 'simple', item: 'boots', enchantments: [{ id: 'unbreaking', level: 3, sources: [{ level: 1, count: 3 }] }] }

    it.each([JAVA, BEDROCK])('is infeasible with goal-level-unreachable (reachable 2) and a verified add-book suggestion (%o)', (settings) => {
      const result = expectStatus(solveSync(problem, settings), 'infeasible')
      expect(result.reasons).toEqual([{ code: 'goal-level-unreachable', enchantment: 'unbreaking', required: 3, reachable: 2 }])
      expect(result.suggestions).toEqual([{ code: 'add-book', enchantment: 'unbreaking', level: 3, totalLevels: 3, maxStepLevels: 3 }])
      expect(result.reference).toBeNull()
      expect(result.stats.exact).toBeNull()   // a static reason, so no search runs
      expectSuggestionsMatchOracle(problem, settings, result)
    })

    it('simple mode also offers lower-goal-level (Unbreaking II for 4 levels)', () => {
      const result = expectStatus(solveSync(simple, JAVA), 'infeasible')
      expect(result.reasons).toEqual([{ code: 'goal-level-unreachable', enchantment: 'unbreaking', required: 3, reachable: 2 }])
      expect(result.suggestions).toEqual([
        { code: 'add-book', enchantment: 'unbreaking', level: 3, totalLevels: 3, maxStepLevels: 3 },
        { code: 'lower-goal-level', enchantment: 'unbreaking', level: 2, totalLevels: 4, maxStepLevels: 3 },
      ])
      expectSuggestionsMatchOracle(simple, JAVA, result)
    })

    it('with x4 the goal is reached: Java 13 / Bedrock 9', () => {
      const four = { ...problem, books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }] }
      expect(solveOk(four, JAVA).summary.totalLevels).toBe(13)
      expect(solveOk(four, BEDROCK).summary.totalLevels).toBe(9)
    })
  })

  describe('sword + book{Smite I} + book{Sharpness V, Looting III}, goal {Looting III}, useOnlyNeeded', () => {
    it.each([[JAVA, [9, 8, 119, 3]], [BEDROCK, [8, 7, 98, 3]]] as const)('uses both books (%o -> %o), exact search, discards Sharpness V with keep 11', (settings, values) => {
      expect(checkAdditive(normalizeProblem(SMITE_BLOCKS_SHARPNESS, settings), settings)).toEqual({ eligible: false, because: 'conflict' })
      const result = solveOk(SMITE_BLOCKS_SHARPNESS, settings)
      expect(result.method).toBe('exact')
      expect(scenarioValues(result)).toEqual(values)
      expect(result.plan.usedInputs).toEqual([0, 1, 2])
      expect(warningOf(result, 'enchantments-discarded')).toEqual({
        code: 'enchantments-discarded',
        items: [{ id: 'sharpness', inputLevel: 5, finalLevel: 0, inputs: [2], reason: 'conflict' }],
        keep: { enchantments: { sharpness: 5 }, totalLevels: 11, maxStepLevels: 11 },
      })
      expect(warningOf(result, 'result-has-extra-enchantments')).toEqual({ code: 'result-has-extra-enchantments', enchantments: ['smite'] })
      expect(result.stats.diagnosticsMs).not.toBeNull()   // the keep re-solve
    })

    it('book-only variant: not tree-table eligible; the Sharpness/Looting book alone already meets the goal (trivial, 0 levels)', () => {
      const bookOnly = advanced({ books: books({ sharpness: 5, looting: 3 }, { smite: 1 }), goal: { looting: 3 } })
      expect(checkAdditive(normalizeProblem(bookOnly, JAVA), JAVA)).toEqual({ eligible: false, because: 'conflict' })
      const result = solveOk(bookOnly, JAVA)
      expect(result.method).toBe('trivial')
      expect(keyVectorOf(result, 'levels')).toEqual(oracleKeys(bookOnly, JAVA))
    })

    it('boots + book{Frost Walker I} + book{Depth Strider III, Feather Falling IV}, goal {Feather Falling IV} -> Java 8, not 10', () => {
      const boots = advanced({ target: item('boots'), books: books({ frost_walker: 1 }, { depth_strider: 3, feather_falling: 4 }), goal: { feather_falling: 4 } })
      expect(checkAdditive(normalizeProblem(boots, JAVA), JAVA)).toEqual({ eligible: false, because: 'conflict' })
      const result = solveOk(boots, JAVA)
      expect(result.summary.totalLevels).toBe(8)
      expect(warningOf(result, 'enchantments-discarded')?.keep).toEqual({ enchantments: { depth_strider: 3 }, totalLevels: 10, maxStepLevels: 10 })
    })
  })

  it('boots (uses 5) + Thorns III -> infeasible too-expensive (43) with the over-cap reference; + Mending instead -> 33', () => {
    const problem = advanced({ target: item('boots', 5), books: books({ thorns: 3 }) })
    const result = expectStatus(solveSync(problem, JAVA), 'infeasible')
    expect(result.reasons).toEqual([
      { code: 'too-expensive', uncappedTotal: 43, uncappedMaxStep: 43, stepsOverCap: [1], minAchievableMaxStep: 43 },
      // No goal and every input used: the target alone, without the Thorns book, would work.
      { code: 'cannot-use-all-inputs', unusable: [1] },
    ])
    // Removing the book leaves only the target (an empty problem), and without a goal there is no useOnlyNeeded to enable.
    expect(result.suggestions).toEqual([])
    expect(result.reference?.overCap).toBe(true)
    expect(result.reference?.plan.steps.map((step) => [step.cost.total, step.tooExpensive])).toEqual([[43, true]])
    expect(scenarioValues(solveOk(advanced({ target: item('boots', 5), books: books({ mending: 1 }) }), JAVA))).toEqual([33, 33, 1758, 63])
  })

  it('baseline of the 7 books is 163 (12, 13, 9, 11, 19, 34, 65), not comparable because step 7 costs 65', () => {
    const result = solveOk(BOOTS_WITH_MAX_BOOKS, JAVA)
    expect(result.baseline).toEqual({
      stepCosts: [12, 13, 9, 11, 19, 34, 65],
      totalLevels: 163,
      maxStepLevels: 65,
      xpPoints: 12 * 12 + 72 + 13 * 13 + 78 + 9 * 9 + 54 + 11 * 11 + 66 + (5 * 19 * 19 - 81 * 19) / 2 + 360 + (9 * 34 * 34 - 325 * 34) / 2 + 2220 + (9 * 65 * 65 - 325 * 65) / 2 + 2220,
      firstTooExpensiveStep: 7,
      skippedInputs: [],
      achievesGoal: true,
      comparable: false,
      savedLevels: null,
      savedXpPoints: null,
    })
    // Without a cap the chain is comparable: 163 - 66 = 97 levels saved.
    expect(solveOk(BOOTS_WITH_MAX_BOOKS, { ...JAVA, levelCap: null }).baseline).toMatchObject({ comparable: true, savedLevels: 97, firstTooExpensiveStep: null })
  })

  it('baseline of sword{Sharpness V} + Smite V + Looting III skips the Smite book, total 6, not comparable (not −7)', () => {
    expect(solveOk(SHARPNESS_SWORD_SMITE_LOOTING, JAVA).baseline).toMatchObject({ totalLevels: 6, skippedInputs: [1], comparable: false, savedLevels: null, savedXpPoints: null })
  })

  it.each([
    ['Unbreaking I, II, II', books({ unbreaking: 1 }, { unbreaking: 2 }, { unbreaking: 2 }), [6, 4, 56, 3], [4, 2, 32, 3]],
    ['Unbreaking I x3, II', books({ unbreaking: 1 }, { unbreaking: 1 }, { unbreaking: 1 }, { unbreaking: 2 }), [9, 5, 87, 3], [6, 3, 50, 3]],
  ] as const)('boots + %s, goal {Unbreaking III} -> Java %o / Bedrock %o', (_, bookList, java, bedrock) => {
    const problem = advanced({ target: item('boots'), books: [...bookList], goal: { unbreaking: 3 } })
    expect(scenarioValues(solveOk(problem, JAVA))).toEqual(java)
    expect(scenarioValues(solveOk(problem, BEDROCK))).toEqual(bedrock)
  })

  it('boots + Unbreaking I x4, no goal -> Unbreaking III (Java [13, 7, 141, 7] / Bedrock [9, 5, 85, 7])', () => {
    const problem = advanced({ target: item('boots'), books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }] })
    const java = solveOk(problem, JAVA)
    expect(scenarioValues(java)).toEqual([13, 7, 141, 7])
    expect(java.summary.finalEnchantments).toEqual({ unbreaking: 3 })
    expect(scenarioValues(solveOk(problem, BEDROCK))).toEqual([9, 5, 85, 7])
  })

  describe('boots + three books whose Unbreaking and Feather Falling cannot both reach III', () => {
    it.each([[JAVA, [14, 7, 158, 3]], [BEDROCK, [8, 4, 74, 3]]] as const)('%o -> %o with below-reachable-level and other-maximal-results', (settings, values) => {
      for (const levelCap of [39, null] as const) {
        const result = solveOk(BOOTS_MIXED_UNBREAKING_FEATHER_FALLING, { ...settings, levelCap })
        expect(scenarioValues(result)).toEqual(values)
        const final = result.summary.finalEnchantments
        expect([{ unbreaking: 3, feather_falling: 2 }, { unbreaking: 2, feather_falling: 3 }]).toContainEqual(final)
        const other = final.unbreaking === 3 ? { unbreaking: 2, feather_falling: 3 } : { unbreaking: 3, feather_falling: 2 }
        const below = final.unbreaking === 3 ? 'feather_falling' : 'unbreaking'
        expect(warningOf(result, 'below-reachable-level')).toEqual({ code: 'below-reachable-level', items: [{ id: below, level: 2, reachable: 3 }] })
        expect(warningOf(result, 'other-maximal-results')).toEqual({
          code: 'other-maximal-results',
          results: [{ enchantments: other, totalLevels: values[0], maxStepLevels: values[1] }],
        })
      }
    })

    it('goal {Unbreaking III, Feather Falling III} is infeasible even without a cap (capExcluded), and dropping either goal is suggested', () => {
      for (const levelCap of [39, null] as const) {
        const result = expectStatus(solveSync({ ...BOOTS_MIXED_UNBREAKING_FEATHER_FALLING, goal: { unbreaking: 3, feather_falling: 3 } }, { ...JAVA, levelCap }), 'infeasible')
        expect(result.reasons).toEqual([{ code: 'no-plan' }])
        // The uncapped re-solve finished without a plan, so the cap is known not to be the cause.
        expect(result.capExcluded).toBe(true)
        expect(result.suggestionsComplete).toBe(true)
        expect(result.suggestions.map((s) => s.code === 'drop-goal-enchantment' && s.enchantment).sort()).toEqual(['feather_falling', 'unbreaking'])
      }
    })
  })

  it('the 7 max boots books combined into one book -> [49, 12, 793, 15], applying it costs 58 (too expensive)', () => {
    for (const settings of [JAVA, BEDROCK]) {
      const result = solveOk(advanced({ books: MAX_BOOTS_BOOKS }), settings)
      expect(scenarioValues(result)).toEqual([49, 12, 793, 15])
      expect(result.summary.applyToFreshItem).toEqual({ cost: 58, tooExpensive: true })
      expect(warningOf(result, 'final-book-too-expensive-to-apply')).toEqual({ code: 'final-book-too-expensive-to-apply', cost: 58 })
    }
    const sword = solveOk(advanced({ books: books({ sharpness: 5 }, { looting: 3 }, { unbreaking: 3 }, { mending: 1 }, { fire_aspect: 2 }, { sweeping_edge: 3 }) }), JAVA)
    expect(scenarioValues(sword)).toEqual([31, 10, 435, 7])
    expect(sword.summary.applyToFreshItem).toEqual({ cost: 33, tooExpensive: false })
    expect(warningOf(sword, 'final-book-too-expensive-to-apply')).toBeUndefined()
  })

  describe('boots (uses 6){Unbreaking III}, goal {Unbreaking III}, useOnlyNeeded, rename', () => {
    const problem = advanced({ target: item('boots', 6, { unbreaking: 3 }), goal: { unbreaking: 3 } })

    it('Bedrock: infeasible target-penalty-too-high (63), no step', () => {
      const result = expectStatus(solveSync(problem, { ...BEDROCK, rename: true }), 'infeasible')
      expect(result.reasons).toEqual([{ code: 'target-penalty-too-high', priorWorkPenalty: 63 }])
      expect(result.suggestions).toEqual([])
      expect(result.reference).toBeNull()
    })

    it('Java: method trivial, one rename step [39, 39, 2727, 63] clamped from 64', () => {
      const result = solveOk(problem, { ...JAVA, rename: true })
      expect(result.method).toBe('trivial')
      expect(scenarioValues(result)).toEqual([39, 39, 2727, 63])
      expect(result.plan.steps).toHaveLength(1)
      expect(result.plan.steps[0]).toMatchObject({ kind: 'rename', cost: { total: 39, clampedFrom: 64 } })
    })
  })

  it('sword + Sharpness V + Smite V + Looting III, no goal -> Java [19, 9, 245, 3] / Bedrock [18, 8, 222, 3]', () => {
    for (const [settings, values] of [[JAVA, [19, 9, 245, 3]], [BEDROCK, [18, 8, 222, 3]]] as const) {
      const result = solveOk(SWORD_SHARPNESS_OR_SMITE, settings)
      expect(scenarioValues(result)).toEqual(values)
      const final = result.summary.finalEnchantments
      expect(final.looting).toBe(3)
      const kept = final.sharpness === 5 ? 'sharpness' : 'smite'
      const lost = kept === 'sharpness' ? 'smite' : 'sharpness'
      expect(final[kept]).toBe(5)
      expect(warningOf(result, 'enchantments-discarded')?.items).toEqual([{ id: lost, inputLevel: 5, finalLevel: 0, inputs: [lost === 'sharpness' ? 1 : 2], reason: 'conflict' }])
      expect(warningOf(result, 'other-maximal-results')?.results).toEqual([{ enchantments: { looting: 3, [lost]: 5 }, totalLevels: values[0], maxStepLevels: values[1] }])
    }
  })
})

function expectSuggestionsMatchOracle(problem: Problem, settings: Settings, result: SolveInfeasible): void {
  const np = normalizeProblem(problem, settings)
  for (const suggestion of result.suggestions) {
    const keys = bruteForceSolve(applySuggestion(problem, np, suggestion), settings).best?.[settings.objective].planKeys
    expect([suggestion.totalLevels, suggestion.maxStepLevels]).toEqual([keys?.totalLevels, keys?.maxStepLevels])
  }
}

describe('pipeline: validation, empty and trivial problems', () => {
  it('returns invalid with the validation issues, using SolveOptions.limits for the ranges', () => {
    const problem = advanced({ target: item('boots', 11), books: books({ mending: 1 }) })
    expect(solveSync(problem, JAVA)).toEqual({ status: 'invalid', issues: [{ code: 'anvil-uses-out-of-range', value: 11, where: { part: 'target' } }] })
    // Overriding the limit makes the problem valid.
    expect(solveSync(problem, JAVA, { limits: { maxAnvilUses: 11 } }).status).toBe('infeasible')
  })

  it('returns empty when there is nothing to combine', () => {
    expect(solveSync(advanced({ target: item('boots') }), JAVA)).toEqual({ status: 'empty' })
    expect(solveSync(advanced({ target: item('boots', 2, { mending: 1 }), goal: null }), JAVA)).toEqual({ status: 'empty' })
    expect(solveSync(advanced({}), { ...JAVA, rename: true })).toEqual({ status: 'empty' })
    expect(solveSync({ mode: 'simple', item: 'sword', enchantments: [] }, JAVA)).toEqual({ status: 'empty' })
  })

  it('goal already met by the target alone: trivial, no step, every book unused', () => {
    const problem = advanced({ target: item('pickaxe', 1, { efficiency: 5 }), books: books({ efficiency: 5 }, { unbreaking: 3 }), goal: { efficiency: 5 } })
    const result = solveOk(problem, JAVA)
    expect(result).toMatchObject({ method: 'trivial', plan: { steps: [], usedInputs: [0], unusedInputs: [1, 2] } })
    expect(result.stats).toMatchObject({ fastPath: null, exact: null })
    expect(keyVectorOf(result, 'levels')).toEqual(oracleKeys(problem, JAVA))
    // With rename, a single rename-only step (target PWP 1 + 1).
    const renamed = solveOk(problem, { ...JAVA, rename: true })
    expect(renamed.method).toBe('trivial')
    expect(renamed.plan.steps.map((step) => [step.kind, step.cost.total])).toEqual([['rename', 2]])
  })

  it('only the target and rename: a rename-only step', () => {
    const result = solveOk(advanced({ target: item('sword', 2, { sharpness: 5 }) }), { ...BEDROCK, rename: true })
    expect(result.method).toBe('trivial')
    expect(scenarioValues(result)).toEqual([4, 4, 40, 3])
  })

  it('book-only: a single book that meets the goal is trivial only when no other plan can beat it', () => {
    // With a book that has 0 anvil uses, no step at all (1 level with rename) is best.
    const fresh = advanced({ books: books({ sharpness: 5 }, { sharpness: 4 }, { sharpness: 4 }), goal: { sharpness: 5 } })
    for (const settings of [JAVA, { ...JAVA, rename: true }, { ...JAVA, objective: 'finalPwp' as const }]) {
      const result = solveOk(fresh, settings)
      expect(result.method).toBe('trivial')
      expect(keyVectorOf(result, settings.objective)).toEqual(oracleKeys(fresh, settings))
    }
    // When the book that meets the goal has prior work, merging fresh books can be better: with rename (a rename-only step
    // costs 16, a merge with +1 costs 6) and with objective finalPwp (15 vs 1).
    const worn = advanced({ books: [{ enchantments: { sharpness: 5 }, anvilUses: 4 }, ...books({ sharpness: 4 }, { sharpness: 4 })], goal: { sharpness: 5 } })
    for (const settings of [{ ...JAVA, rename: true }, { ...JAVA, objective: 'finalPwp' as const }]) {
      const result = solveOk(worn, settings)
      expect(result.method).toBe('exact')
      expect(result.plan.usedInputs).toEqual([1, 2])
      expect(keyVectorOf(result, settings.objective)).toEqual(oracleKeys(worn, settings))
    }
    // Without rename and with objective levels, no step (total 0) is cheapest.
    expect(solveOk(worn, JAVA)).toMatchObject({ method: 'trivial', plan: { usedInputs: [0] } })
  })

  it('book-only: a single worn book whose Bedrock rename is refused is not trivial (the search reports too-expensive)', () => {
    const problem = advanced({ books: [{ enchantments: { mending: 1 }, anvilUses: 6 }] })
    const result = expectStatus(solveSync(problem, { ...BEDROCK, rename: true }), 'infeasible')
    expect(result.reasons[0]).toMatchObject({ code: 'too-expensive', uncappedTotal: 64, stepsOverCap: [1] })
    expect(result.reference?.plan.steps.map((step) => [step.kind, step.cost.total])).toEqual([['rename', 64]])
  })
})

describe('pipeline: method choice and fallbacks', () => {
  const WORN_BOOTS_WITH_MAX_BOOKS = advanced({ target: item('boots', 2), books: MAX_BOOTS_BOOKS })

  it("forceMethod 'tree-table' needs an additive problem; forceMethod 'exact' skips the trivial shortcut", () => {
    expect(() => solveSync(SHARPNESS_SWORD_SMITE_LOOTING, JAVA, { forceMethod: 'tree-table' })).toThrow(/additive/)
    expect(solveOk(BOOTS_WITH_MAX_BOOKS, JAVA, { forceMethod: 'tree-table' }).method).toBe('tree-table')
    const trivialProblem = advanced({ target: item('pickaxe', 0, { efficiency: 5 }), books: books({ unbreaking: 3 }), goal: { efficiency: 5 } })
    const exact = solveOk(trivialProblem, JAVA, { forceMethod: 'exact' })
    expect(exact.method).toBe('exact')
    expect(keyVectorOf(exact, 'levels')).toEqual(keyVectorOf(solveOk(trivialProblem, JAVA), 'levels'))
  })

  it('complete tie-break, winner over the cap -> exact search (it finds the best plan within the cap)', () => {
    const result = solveOk(WORN_BOOTS_WITH_MAX_BOOKS, JAVA, { levelCapOverride: 29 })
    expect(result.method).toBe('exact')
    expect(result.stats.fastPath).toMatchObject({ eligible: true, tieBreakComplete: true })
    expect(keyVectorOf(result, 'levels')).toEqual(oracleKeys(WORN_BOOTS_WITH_MAX_BOOKS, JAVA, 29))
    expect(result.assumptions.levelCap).toBe(39)   // the override does not change the reported assumptions
  })

  it('winner over the cap and no exact search allowed -> too-complex with the tree-table plan as reference', () => {
    const result = expectStatus(solveSync(WORN_BOOTS_WITH_MAX_BOOKS, JAVA, { levelCapOverride: 29, limits: { exactComplexityHardUseAll: 1 } }), 'too-complex')
    expect(result.cause).toBe('complexity-limit')
    expect(result.complexity).toMatchObject({ fastPathEligible: true, hardLimit: 1 })
    expect(result.reference?.overCap).toBe(true)
    expect(result.reference?.summary).toMatchObject({ totalLevels: 83, maxStepLevels: 30 })
    expect(result.reference?.plan.steps.some((step) => step.cost.total > 29)).toBe(true)
    expect(result.stats.exact).toBeNull()
  })

  it('partial tie-break -> exact search; without it the within-cap plan is returned with tie-break-partial', () => {
    const exact = solveOk(BOOTS_WITH_MAX_BOOKS, JAVA, { limits: { tieBreakMaxEvaluations: 1 } })
    expect(exact.method).toBe('exact')
    expect(exact.stats.fastPath).toMatchObject({ tieBreakComplete: false, tieBreakEvaluations: 1 })
    expect(scenarioValues(exact)).toEqual([66, 16, 1246, 15])

    const partial = solveOk(BOOTS_WITH_MAX_BOOKS, JAVA, { limits: { tieBreakMaxEvaluations: 1, exactComplexityHardUseAll: 1 } })
    expect(partial.method).toBe('tree-table')
    expect(partial.summary.totalLevels).toBe(66)   // the total is optimal; the max step may not be
    expect(partial.summary.maxStepLevels).toBeGreaterThanOrEqual(16)
    expect(warningOf(partial, 'tie-break-partial')).toEqual({ code: 'tie-break-partial' })
    expect(partial.stats.exact).toBeNull()

    // The same holds when the exact search is aborted.
    const aborted = solveOk(BOOTS_WITH_MAX_BOOKS, JAVA, { limits: { tieBreakMaxEvaluations: 1, exactMaxStates: 10 } })
    expect(aborted.method).toBe('tree-table')
    expect(warningOf(aborted, 'tie-break-partial')).toBeDefined()
    expect(aborted.stats.exact).not.toBeNull()
  })

  it('partial tie-break with no plan within the cap and no exact search -> too-complex with reference', () => {
    const result = expectStatus(solveSync(BOOTS_WITH_MAX_BOOKS, JAVA, { levelCapOverride: 15, limits: { tieBreakMaxEvaluations: 1, exactComplexityHardUseAll: 1 } }), 'too-complex')
    expect(result.cause).toBe('complexity-limit')
    expect(result.reference?.summary.totalLevels).toBe(66)
  })

  it('state and time limits end the exact search as too-complex with the cause (no reference without a tree-table plan)', () => {
    const states = expectStatus(solveSync(MACE_SIMPLE_MODE, JAVA, { limits: { exactMaxStates: 10 } }), 'too-complex')
    expect(states).toMatchObject({ cause: 'state-limit', reference: null })
    expect(states.stats.exact).not.toBeNull()
    expect(expectStatus(solveSync(MACE_SIMPLE_MODE, JAVA, { limits: { exactTimeBudgetMs: 0 } }), 'too-complex').cause).toBe('time-limit')
  })

  it("prunes by anvil uses for objective 'finalPwp' with a goal and useOnlyNeeded, so 12 books solve within the default state limit", () => {
    // Without the anvil-uses bound, finalPwp hits the state limit of 150,000 here; levels and xp solve with about 84,000 states.
    const b = (enchantments: EnchantLevels, anvilUses = 0): BookInput => ({ enchantments, anvilUses })
    const problem = advanced({
      target: item('boots'),
      books: [
        b({ blast_protection: 1, feather_falling: 1, depth_strider: 1 }, 2), b({ blast_protection: 3, unbreaking: 1 }), b({ depth_strider: 3 }),
        b({ mending: 1, frost_walker: 2, unbreaking: 1 }), b({ depth_strider: 2, mending: 1 }), b({ thorns: 1, feather_falling: 3 }), b({ frost_walker: 1 }),
        b({ unbreaking: 3, depth_strider: 2 }, 1), b({ feather_falling: 2, blast_protection: 1 }), b({ protection: 4 }), b({ depth_strider: 2, protection: 4 }, 2),
        b({ unbreaking: 1, feather_falling: 2 }, 2),
      ],
      goal: { protection: 4, feather_falling: 4, depth_strider: 3, unbreaking: 3, mending: 1 },
    })
    const settings: Settings = { ...BEDROCK, objective: 'finalPwp' }
    expect(estimateComplexity(problem, settings)).toMatchObject({ level: 'slow', hardLimit: 1_200_000 })
    const result = solveOk(problem, settings)
    expect(result.method).toBe('exact')
    expect(result.summary).toMatchObject({ finalPriorWorkPenalty: 15, totalLevels: 50 })
    expect(result.stats.exact?.states).toBeLessThan(150_000)
    expect(result.stats.exact?.prunedByBound).toBeGreaterThan(0)
  })

  it('too-complex without searching when C_eff exceeds the hard limit', () => {
    const many = advanced({
      target: item('boots'),
      books: books({ protection: 1 }, { protection: 2 }, { protection: 3 }, { feather_falling: 1 }, { feather_falling: 2 }, { feather_falling: 3 },
        { unbreaking: 1 }, { unbreaking: 2 }, { depth_strider: 1 }, { depth_strider: 2 }, { thorns: 1 }, { thorns: 2 }),
    })
    const result = expectStatus(solveSync(many, { ...JAVA, levelCap: null }), 'too-complex')
    expect(result.cause).toBe('complexity-limit')
    expect(result.complexity).toEqual(estimateComplexity(many, { ...JAVA, levelCap: null }))
    expect(result.complexity.level).toBe('too-complex')
    expect(result.stats.exact).toBeNull()
  })

  it('more than 30 distinct enchantments: too-complex even when C is small, unless the tree-table method solves it', () => {
    // At most 30 enchantments are mutually compatible, so 31 or more always include a conflict and rule out the tree-table method.
    const set = ['aqua_affinity', 'bane_of_arthropods', 'binding_curse', 'blast_protection', 'channeling', 'depth_strider', 'efficiency', 'feather_falling',
      'fire_aspect', 'flame', 'fortune', 'infinity', 'knockback', 'looting', 'loyalty', 'luck_of_the_sea', 'lunge', 'lure', 'multishot', 'power',
      'punch', 'quick_charge', 'respiration', 'soul_speed', 'sweeping_edge', 'swift_sneak', 'thorns', 'unbreaking', 'vanishing_curse', 'wind_burst'] as const
    const bookList = [0, 8, 16, 24].map((start) => ({ enchantments: Object.fromEntries(set.slice(start, start + 8).map((id) => [id, 1])), anvilUses: 0 }))
    const problem = advanced({ books: [...bookList, { enchantments: { sharpness: 1 }, anvilUses: 0 }] })
    expect(enchantmentUniverse(normalizeProblem(problem, JAVA))).toHaveLength(31)
    const result = expectStatus(solveSync(problem, JAVA), 'too-complex')
    expect(result.cause).toBe('complexity-limit')
    expect(result.complexity).toMatchObject({ complexity: 243, level: 'too-complex', fastPathEligible: false })
    expect(result.stats.exact).toBeNull()
    // With 30 (no conflicts) the tree-table method solves it.
    expect(solveOk(advanced({ books: bookList }), { ...JAVA, levelCap: null }).method).toBe('tree-table')
  })

  it('the distinct-enchantment limit (limits.exactMaxDistinctEnchantments) keeps additive problems on the tree-table method', () => {
    expect(solveOk(BOOTS_WITH_MAX_BOOKS, JAVA, { limits: { exactMaxDistinctEnchantments: 5 } }).method).toBe('tree-table')
    const partial = solveOk(BOOTS_WITH_MAX_BOOKS, JAVA, { limits: { exactMaxDistinctEnchantments: 5, tieBreakMaxEvaluations: 1 } })
    expect(partial.method).toBe('tree-table')
    expect(warningOf(partial, 'tie-break-partial')).toBeDefined()
    expect(expectStatus(solveSync(MACE_SIMPLE_MODE, JAVA, { limits: { exactMaxDistinctEnchantments: 3 } }), 'too-complex').cause).toBe('complexity-limit')
  })

  it('stats: fast-path eligibility and the exact search work counters', () => {
    expect(solveOk(BOOTS_WITH_MAX_BOOKS, JAVA).stats).toMatchObject({ fastPath: { eligible: true, ineligibleBecause: null, classes: 5, tieBreakComplete: true }, exact: null, diagnosticsMs: null })
    const exact = solveOk(MACE_SIMPLE_MODE, JAVA).stats
    expect(exact.fastPath).toEqual({ eligible: false, ineligibleBecause: 'overlap', classes: 0, shapesAtOptimum: 0, tieBreakEvaluations: 0, tieBreakComplete: true })
    expect(exact.exact).toMatchObject({ complexity: 810 })
    expect(exact.elapsedMs).toBeGreaterThan(0)
  })
})

describe('pipeline: options and warnings added by the pipeline', () => {
  it('levelCapOverride changes the cap used by the search and the diagnosis', () => {
    const result = expectStatus(solveSync(BOOTS_WITH_MAX_BOOKS, JAVA, { levelCapOverride: 15 }), 'infeasible')
    expect(result.reasons[0]).toEqual({ code: 'too-expensive', uncappedTotal: 66, uncappedMaxStep: 16, stepsOverCap: [3], minAchievableMaxStep: 16 })
    expect(oracleKeys(BOOTS_WITH_MAX_BOOKS, JAVA, 15)).toBeNull()
    expectSuggestionsMatchOracle(BOOTS_WITH_MAX_BOOKS, JAVA, { ...result, suggestions: result.suggestions.slice(0, 2) })
  })

  it('skipDiagnostics and skipBaseline', () => {
    const noDiagnosis = expectStatus(solveSync(BOOTS_WITH_MAX_BOOKS, JAVA, { levelCapOverride: 15, skipDiagnostics: true }), 'infeasible')
    expect(noDiagnosis).toMatchObject({ suggestions: [], reference: null, stats: { diagnosticsMs: null } })
    expect(noDiagnosis.reasons.map((reason) => reason.code)).toEqual(['cannot-use-all-inputs'])
    expect(warningOf(solveOk(SMITE_BLOCKS_SHARPNESS, JAVA, { skipDiagnostics: true }), 'enchantments-discarded')?.keep).toBeNull()
    expect(solveOk(BOOTS_WITH_MAX_BOOKS, JAVA, { skipBaseline: true }).baseline).toBeNull()
  })

  it('Bedrock results carry bedrock-rules-from-wiki first', () => {
    const result = solveOk(SMITE_BLOCKS_SHARPNESS, BEDROCK)
    expect(result.warnings.map((warning) => warning.code)).toEqual(['bedrock-rules-from-wiki', 'result-has-extra-enchantments', 'enchantments-discarded'])
    expect(expectStatus(solveSync(advanced({ target: item('boots', 5), books: books({ thorns: 3 }) }), BEDROCK), 'infeasible').warnings[0]).toEqual({ code: 'bedrock-rules-from-wiki' })
    expect(solveOk(BOOTS_WITH_MAX_BOOKS, JAVA).warnings).toEqual([])
  })

  it('bedrock-unverified-value: a trident with Loyalty sacrificed as an item', () => {
    const problem = advanced({ target: item('trident'), extraItems: [{ enchantments: { loyalty: 3 }, anvilUses: 0 }] })
    expect(warningOf(solveOk(problem, BEDROCK), 'bedrock-unverified-value')).toEqual({ code: 'bedrock-unverified-value', detail: 'loyalty-item-multiplier' })
    expect(warningOf(solveOk(problem, JAVA), 'bedrock-unverified-value')).toBeUndefined()
  })

  it('bedrock-unverified-value no-effect-refused: every input forced and Bedrock refused a step that changes no enchantment level', () => {
    const problem = advanced({ target: item('pickaxe', 0, { efficiency: 5 }), books: books({ efficiency: 5 }), goal: { efficiency: 5 }, useOnlyNeeded: false })
    const bedrock = expectStatus(solveSync(problem, BEDROCK), 'infeasible')
    expect(warningOf(bedrock, 'bedrock-unverified-value')).toEqual({ code: 'bedrock-unverified-value', detail: 'no-effect-refused' })
    expect(solveOk(problem, JAVA).summary.totalLevels).toBe(5)   // Java accepts a step that changes no level
  })

  it('creative: steps-over-survival-limit and creative-inapplicable-ignored', () => {
    const over = solveOk(advanced({ target: item('boots', 5), books: books({ thorns: 3 }) }), { ...JAVA, levelCap: null })
    expect(warningOf(over, 'steps-over-survival-limit')).toEqual({ code: 'steps-over-survival-limit', steps: [1] })
    const inapplicable = solveOk(advanced({ target: item('sword'), books: books({ sharpness: 5, efficiency: 1 }) }), { ...JAVA, levelCap: null })
    expect(warningOf(inapplicable, 'creative-inapplicable-ignored')).toEqual({ code: 'creative-inapplicable-ignored', enchantments: ['efficiency'] })
    expect(warningOf(inapplicable, 'enchantments-discarded')?.items.map((d) => [d.id, d.reason])).toEqual([['efficiency', 'inapplicable']])
  })

  it('slow-search when the exact search ran with C_eff above the soft limit', () => {
    expect(warningOf(solveOk(MACE_SIMPLE_MODE, JAVA, { limits: { exactComplexitySoft: 100 } }), 'slow-search')).toEqual({ code: 'slow-search', complexity: 810 })
    expect(warningOf(solveOk(MACE_SIMPLE_MODE, JAVA), 'slow-search')).toBeUndefined()
    expect(warningOf(solveOk(BOOTS_WITH_MAX_BOOKS, JAVA, { limits: { exactComplexitySoft: 100 } }), 'slow-search')).toBeUndefined()   // tree-table method
  })

  it('solving the same problem twice gives the same result', () => {
    for (const [problem, settings] of [[BOOTS_WITH_MAX_BOOKS, JAVA], [SMITE_BLOCKS_SHARPNESS, BEDROCK], [BOOTS_MIXED_UNBREAKING_FEATHER_FALLING, JAVA], [SWORD_SHARPNESS_OR_SMITE, BEDROCK]] as const) {
      const strip = (result: SolveResult) => ({ ...result, stats: undefined })
      expect(strip(solveSync(problem, settings))).toEqual(strip(solveSync(problem, settings)))
    }
  })
})

describe('pipeline: inputs left out of the search', () => {
  /** Neither share nor conflict with any enchantment of the sword and boots problems. */
  const UNRELATED = books(
    { protection: 4 }, { feather_falling: 4 }, { efficiency: 5 }, { fortune: 3 }, { power: 5 }, { respiration: 3 }, { lure: 3 }, { quick_charge: 3 }, { aqua_affinity: 1 },
  )
  const b = (enchantments: EnchantLevels, anvilUses = 0): BookInput => ({ enchantments, anvilUses })

  it.each([
    ['levels', 1, 24],
    ['xp', 0, 23],
    ['finalPwp', 1, 24],
  ] as const)('a sword inventory with 9 unrelated books is solved like the 4 relevant ones (objective %s, Sharpness book with %i uses)', (objective, uses, total) => {
    // Counted in C, these books would make the 13-book problem too complex (complexity-limit).
    const relevant = [b({ sharpness: 5 }, uses), b({ looting: 3 }), b({ unbreaking: 3 }), b({ mending: 1 })]
    const goal = { sharpness: 5, looting: 3, unbreaking: 3, mending: 1 }
    const settings: Settings = { ...JAVA, objective }
    const inventory = advanced({ target: item('sword'), books: [...relevant, ...UNRELATED], goal })
    expect(normalizeProblem(inventory, settings).excludedInputs).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(estimateComplexity(inventory, settings)).toMatchObject({ complexity: 162, level: 'instant' })
    const result = solveOk(inventory, settings)
    expect(result.summary.totalLevels).toBe(total)
    expect(keyVectorOf(result, objective)).toEqual(keyVectorOf(solveOk(advanced({ target: item('sword'), books: relevant, goal }), settings), objective))
    expect(result.plan.unusedInputs).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(warningOf(result, 'inputs-unused')).toEqual({ code: 'inputs-unused', inputs: [5, 6, 7, 8, 9, 10, 11, 12, 13] })
  })

  it('keeps the Smite I book that blocks Sharpness V (9), and the keep alternative survives 8 unrelated books', () => {
    expect(normalizeProblem(SMITE_BLOCKS_SHARPNESS, JAVA).excludedInputs).toEqual([])
    const withUnrelated = advanced({ ...SMITE_BLOCKS_SHARPNESS, books: [...SMITE_BLOCKS_SHARPNESS.books, ...UNRELATED.slice(0, 8)] })
    expect(normalizeProblem(withUnrelated, JAVA).excludedInputs).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    const result = solveOk(withUnrelated, JAVA)
    expect(scenarioValues(result)).toEqual([9, 8, 119, 3])
    // Counted, the unrelated books would make the keep re-solve too expensive to run.
    expect(warningOf(result, 'enchantments-discarded')?.keep).toEqual({ enchantments: { sharpness: 5 }, totalLevels: 11, maxStepLevels: 11 })
  })

  it('Bedrock: a book that only shares an enchantment with a kept input is not left out, since it can lower the optimum', () => {
    // Books only, goal {Unbreaking III}: the {Soul Speed III} book becomes the base and absorbs the other Soul Speed I for free (6 -> 5).
    const shared = advanced({ books: [b({ unbreaking: 2, soul_speed: 1 }, 1), b({ unbreaking: 2, soul_speed: 1 })], goal: { unbreaking: 3 } })
    const withShared = { ...shared, books: [...shared.books, b({ soul_speed: 3 })] }
    expect(normalizeProblem(withShared, BEDROCK).excludedInputs).toEqual([])
    expect(solveOk(shared, BEDROCK).summary.totalLevels).toBe(6)
    const lowered = solveOk(withShared, BEDROCK)
    expect(lowered.summary.totalLevels).toBe(5)
    expect(keyVectorOf(lowered, 'levels')).toEqual(oracleKeys(withShared, BEDROCK))
    // Boots, objective xp, rename, goal {Thorns I}: two {Curse of Binding I} books lower XP from 119 to 102.
    const xpSettings: Settings = { ...BEDROCK, objective: 'xp', rename: true }
    const thorns = advanced({ target: item('boots'), books: [b({ thorns: 1, binding_curse: 1 }), b({ thorns: 1, binding_curse: 1 }, 1)], goal: { thorns: 1 } })
    const withCurses = { ...thorns, books: [...thorns.books, b({ binding_curse: 1 }), b({ binding_curse: 1 })] }
    expect(normalizeProblem(withCurses, xpSettings).excludedInputs).toEqual([])
    expect(solveOk(thorns, xpSettings).summary.xpPoints).toBe(119)
    const cheaper = solveOk(withCurses, xpSettings)
    expect(cheaper.summary.xpPoints).toBe(102)
    expect(keyVectorOf(cheaper, 'xp')).toEqual(oracleKeys(withCurses, xpSettings))
  })
})

/** Runs in 0 ms slices, collecting the progress after each one. */
function runSliced(problem: Problem, settings: Settings, options?: SolveOptions): { result: SolveResult; slices: number; progress: SolveTaskProgress[] } {
  const task = createSolveTask(problem, settings, options)
  const progress: SolveTaskProgress[] = []
  let slices = 0
  while (!task.run(0)) {
    slices++
    progress.push(task.progress)
    if (slices > 100_000) throw new Error('the task does not finish')
  }
  return { result: task.result(), slices, progress }
}

describe('infeasible: suggestionsComplete and capExcluded', () => {
  it('static reasons unrelated to the cap -> capExcluded; target-penalty-too-high -> not', () => {
    const unreachable = expectStatus(
      solveSync(advanced({ target: item('boots'), books: books({ protection: 3 }, { unbreaking: 3 }), goal: { protection: 4, unbreaking: 3 } }), JAVA),
      'infeasible',
    )
    expect(unreachable.reasons.map((r) => r.code)).toEqual(['goal-level-unreachable'])
    expect(unreachable.capExcluded).toBe(true)
    const penalty = expectStatus(
      solveSync(advanced({ target: item('boots', 6), books: books({ unbreaking: 3 }), goal: { unbreaking: 3, protection: 4 } }), JAVA),
      'infeasible',
    )
    expect(penalty.reasons.map((r) => r.code)).toContain('target-penalty-too-high')
    expect(penalty.capExcluded).toBe(false)
  })

  it('too-expensive -> not capExcluded', () => {
    const result = expectStatus(solveSync(advanced({ target: item('boots', 5), books: books({ thorns: 3 }) }), JAVA), 'infeasible')
    expect(result.reasons.map((r) => r.code)).toContain('too-expensive')
    expect(result.capExcluded).toBe(false)
  })

  it('goal + useOnlyNeeded re-solves above suggestionMaxComplexity are still checked (C = 118,098)', () => {
    const problem = advanced({
      target: item('boots', 4),
      books: books(
        { protection: 4 }, { soul_speed: 3 }, { thorns: 3 }, { feather_falling: 4, protection: 1 }, { depth_strider: 3, thorns: 1 },
        { unbreaking: 3, soul_speed: 1 }, { mending: 1, protection: 1 }, { unbreaking: 1, thorns: 1 }, { protection: 1 }, { feather_falling: 1, soul_speed: 1 },
      ),
      goal: { protection: 4, soul_speed: 3, thorns: 3 },
      useOnlyNeeded: true,
    })
    expect(estimateComplexity(problem, JAVA).effectiveComplexity).toBeGreaterThan(60_000)
    const result = expectStatus(solveSync(problem, JAVA), 'infeasible')
    expect(result.reasons.map((r) => r.code)).toEqual(['too-expensive'])
    expect(result.suggestions).toEqual([
      { code: 'drop-goal-enchantment', enchantment: 'soul_speed', totalLevels: 36, maxStepLevels: 32 },
      { code: 'drop-goal-enchantment', enchantment: 'thorns', totalLevels: 36, maxStepLevels: 32 },
    ])
    expect(result.suggestionsComplete).toBe(true)
    expect(result.capExcluded).toBe(false)
  })

  it('when the uncapped re-solve is undecided, the result is neither capExcluded nor complete', () => {
    const all: EnchantLevels = { protection: 4, feather_falling: 4, depth_strider: 3, soul_speed: 3, thorns: 3, unbreaking: 3, mending: 1 }
    const problem = advanced({
      target: item('boots', 4),
      books: books(
        ...Object.entries(all).map(([id, level]) => ({ [id]: level })),
        { unbreaking: 1 }, { protection: 1 }, { feather_falling: 1 }, { thorns: 1 }, { depth_strider: 1 },
      ),
      goal: all,
      useOnlyNeeded: true,
    })
    const result = expectStatus(solveSync(problem, JAVA), 'infeasible')
    expect(result.reasons).toEqual([{ code: 'no-plan' }])
    expect(result.capExcluded).toBe(false)
    expect(result.suggestionsComplete).toBe(false)
  })
})

describe('createSolveTask', () => {
  const withoutStats = (result: SolveResult) => ({ ...result, stats: undefined })

  it('gives the same result in slices as solveSync, with exact-search progress', () => {
    const { result, slices, progress } = runSliced(BOOTS_WITH_MAX_BOOKS, JAVA, { forceMethod: 'exact' })
    expect(slices).toBeGreaterThan(3)
    expect(withoutStats(result)).toEqual(withoutStats(solveSync(BOOTS_WITH_MAX_BOOKS, JAVA, { forceMethod: 'exact' })))
    const exact = progress.filter((p) => p.phase === 'exact')
    expect(exact.length).toBeGreaterThan(0)
    expect(exact.every((p) => p.total === 4374)).toBe(true)
    for (let i = 1; i < exact.length; i++) {
      expect(exact[i].done).toBeGreaterThanOrEqual(exact[i - 1].done)
      expect(exact[i].elapsedMs).toBeGreaterThanOrEqual(exact[i - 1].elapsedMs)
    }
  })

  it('slices the diagnostics re-solves too, with the same diagnosis as solveSync', () => {
    const { result, progress } = runSliced(BOOTS_WITH_MAX_BOOKS, JAVA, { levelCapOverride: 15 })
    expect(progress.some((p) => p.phase === 'diagnostics' && p.total === 1500)).toBe(true)
    const sync = expectStatus(solveSync(BOOTS_WITH_MAX_BOOKS, JAVA, { levelCapOverride: 15 }), 'infeasible')
    const sliced = expectStatus(result, 'infeasible')
    expect(sliced.reasons).toEqual(sync.reasons)
    expect(sliced.suggestions).toEqual(sync.suggestions)
    expect(sliced.reference).toEqual(sync.reference)
    expect(sliced.stats.diagnosticsMs).toBeGreaterThan(0)
    // The keep re-solve is sliced too.
    expect(withoutStats(runSliced(SMITE_BLOCKS_SHARPNESS, JAVA).result)).toEqual(withoutStats(solveSync(SMITE_BLOCKS_SHARPNESS, JAVA)))
  })

  it('stops at the next slice after cancel() and reports cancelled', () => {
    const task = createSolveTask(BOOTS_WITH_MAX_BOOKS, JAVA, { forceMethod: 'exact' })
    expect(task.run(0)).toBe(false)
    expect(() => task.result()).toThrow(/not finished/)
    task.cancel()
    expect(task.run(0)).toBe(true)
    expect(task.result()).toEqual({ status: 'cancelled' })
    expect(task.run(0)).toBe(true)
  })

  it('an engine error surfaces from run(), and again from any later run()', () => {
    const task = createSolveTask(SHARPNESS_SWORD_SMITE_LOOTING, JAVA, { forceMethod: 'tree-table' })
    expect(() => task.run(16)).toThrow(/additive/)
    expect(() => task.run(16)).toThrow(/additive/)
    expect(() => task.result()).toThrow(/not finished/)
  })

  it('reports the fast phase before any search', () => {
    expect(createSolveTask(BOOTS_WITH_MAX_BOOKS, JAVA).progress).toMatchObject({ phase: 'fast', done: 0, total: 1, elapsedMs: 0 })
  })
})
