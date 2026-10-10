// The slow cross-checks and time budgets are in exactSearch.perf.test.ts.

import type { Edition, ItemTypeId } from '../data/types.ts'
import {
  compareKeyVectors,
  ExactSearch,
  planKeyVector,
  solveExactSync,
  type ExactOk,
  type ExactOutcome,
  type ExactPlan,
  type ExactSearchOptions,
} from './exactSearch.ts'
import {
  advanced,
  books,
  JAVA,
  normalized,
  randomProblem,
  referenceSolve,
  replayPlan,
  scenarioKeys,
  seededRandom,
  settingsFor,
  solve,
  vectorKey,
} from './exactSearch.testkit.ts'
import { LIMITS } from './limits.ts'
import type { EnchantLevels, NormalizedProblem, PlanNode, Problem, Settings, SimpleProblem, TargetInput } from './types.ts'
import { xpAtLevel } from './xp.ts'

const EDITIONS: readonly Edition[] = ['java', 'bedrock']

/** These usually take 2-5 s, too close to the default 5 s on a busy machine. */
const HEAVY_TEST_TIMEOUT_MS = 60_000

const item = (itemType: ItemTypeId, anvilUses = 0, enchantments: EnchantLevels = {}): TargetInput => ({ itemType, enchantments, anvilUses })

const MAX_BOOTS_BOOKS = books({ soul_speed: 3 }, { thorns: 3 }, { feather_falling: 4 }, { depth_strider: 3 }, { protection: 4 }, { unbreaking: 3 }, { mending: 1 })
const BOOTS_WITH_MAX_BOOKS = advanced({ target: item('boots'), books: MAX_BOOTS_BOOKS })

function expectValidPlan(np: NormalizedProblem, settings: Settings, plan: ExactPlan, levelCap: number | null = settings.levelCap): void {
  const replay = replayPlan(plan.tree, np, settings, levelCap)   // throws on a refused step, including one over the cap
  expect(replay.keys).toEqual(plan.keys)
  expect(replay.final).toEqual(plan.final)
  if (levelCap !== null) for (const cost of replay.stepCosts) expect(cost).toBeLessThanOrEqual(levelCap)
  expect([...replay.leaves].sort((a, b) => a - b)).toEqual(plan.usedInputs)
  expect([...plan.usedInputs, ...plan.unusedInputs].sort((a, b) => a - b)).toEqual(np.inputs.map((_, i) => i))
  expect(plan.final.kind).toBe(np.targetIndex === null ? 'book' : 'item')
  expect(plan.final.named).toBe(settings.rename)
  if (np.targetIndex !== null) expect(replay.leaves[0]).toBe(np.targetIndex)
  for (const [id, level] of Object.entries(np.goal ?? {})) expect(plan.final.enchantments[id as keyof EnchantLevels] ?? 0).toBeGreaterThanOrEqual(level)
  if (!np.useOnlyNeeded) expect(plan.unusedInputs).toEqual([])
  expect(plan.usedInputs.length).toBeGreaterThan(0)
}

function expectOk(outcome: ExactOutcome): ExactOk {
  if (outcome.status !== 'ok') throw new Error(`expected a plan, got ${JSON.stringify(outcome)}`)
  return outcome
}

/** Also checks the plan properties. */
function solvedKeys(problem: Problem, settings: Settings, options?: ExactSearchOptions): [number, number, number, number] {
  const { np, outcome } = solve(problem, settings, options)
  const ok = expectOk(outcome)
  expectValidPlan(np, settings, ok.plan, options?.levelCap === undefined ? settings.levelCap : options.levelCap)
  return scenarioKeys(ok.plan.keys)
}

function expectMatchesReference(np: NormalizedProblem, settings: Settings, outcome: ExactOutcome, levelCap: number | null = settings.levelCap): void {
  const reference = referenceSolve(np, settings, levelCap)
  if (reference.best === null) {
    expect(outcome.status).toBe('no-plan')
    if (outcome.status !== 'no-plan') return
    // When not every input can be used: the largest usable subset (reported as 'cannot-use-all-inputs')
    if (reference.partial === null) {
      expect(outcome.partial).toBeNull()
    } else {
      expect(outcome.partial?.keys.inputsUsed).toBe(reference.partial.size)
      expect(outcome.partial && planKeyVector(outcome.partial.keys, settings.objective)).toEqual(reference.partial.best)
    }
    return
  }
  const ok = expectOk(outcome)
  expect(planKeyVector(ok.plan.keys, settings.objective)).toEqual(reference.best)
  if (np.goal === null) {
    expect([ok.plan, ...ok.otherMaximal].map((plan) => vectorKey(plan.final.enchantments)).sort()).toEqual(reference.maximal)
  }
}

describe('scenarios (Java, cap 39, levels, every input used unless noted)', () => {
  it('boots + 7 max books -> [66, 16, 1246, 15]; the same in Bedrock and without a cap', () => {
    expect(solvedKeys(BOOTS_WITH_MAX_BOOKS, JAVA)).toEqual([66, 16, 1246, 15])
    expect(solvedKeys(BOOTS_WITH_MAX_BOOKS, settingsFor('bedrock'))).toEqual([66, 16, 1246, 15])
    expect(solvedKeys(BOOTS_WITH_MAX_BOOKS, { ...JAVA, levelCap: null })).toEqual([66, 16, 1246, 15])
    // The same in simple mode (goal = the chosen levels, useOnlyNeeded)
    const simple: SimpleProblem = {
      mode: 'simple',
      item: 'boots',
      enchantments: [
        { id: 'soul_speed', level: 3 }, { id: 'thorns', level: 3 }, { id: 'feather_falling', level: 4 }, { id: 'depth_strider', level: 3 },
        { id: 'protection', level: 4 }, { id: 'unbreaking', level: 3 }, { id: 'mending', level: 1 },
      ],
    }
    expect(solvedKeys(simple, JAVA)).toEqual([66, 16, 1246, 15])
  })

  it('boots + 7 max books with objectives xp and finalPwp, and with rename', () => {
    const xp = solvedKeys(BOOTS_WITH_MAX_BOOKS, { ...JAVA, objective: 'xp' })
    expect(xp.slice(0, 3)).toEqual([66, 16, 1246])
    expect(solvedKeys(BOOTS_WITH_MAX_BOOKS, { ...JAVA, objective: 'finalPwp' })).toEqual([68, 21, 1456, 7])
    expect(solvedKeys(BOOTS_WITH_MAX_BOOKS, { ...JAVA, rename: true })).toEqual([67, 16, 1253, 15])
  })

  it.each([[0, 45], [1, 50], [2, 58]])('helmet with %i anvil uses + 6 books -> %i', (uses, total) => {
    const problem = advanced({
      target: item('helmet', uses),
      books: books({ protection: 4 }, { thorns: 3 }, { respiration: 3 }, { aqua_affinity: 1 }, { unbreaking: 3 }, { mending: 1 }),
    })
    expect(solvedKeys(problem, JAVA)[0]).toBe(total)
  })

  it('boots with 2 anvil uses + the 7 max books -> 83', () => {
    expect(solvedKeys(advanced({ target: item('boots', 2), books: MAX_BOOTS_BOOKS }), JAVA)[0]).toBe(83)
  })

  it('boots with 3 anvil uses + 5 books -> [79, 32, 3423, 31]', () => {
    const problem = advanced({
      target: item('boots', 3),
      books: books({ soul_speed: 3 }, { thorns: 3 }, { feather_falling: 4 }, { depth_strider: 3 }, { protection: 4 }),
    })
    expect(solvedKeys(problem, JAVA)).toEqual([79, 32, 3423, 31])
  })

  it('books only, Sharpness IV x2 + Unbreaking III -> [9, 5, 95, 3]', () => {
    const problem = advanced({ books: [{ enchantments: { sharpness: 4 }, anvilUses: 0, count: 2 }, { enchantments: { unbreaking: 3 }, anvilUses: 0 }] })
    expect(solvedKeys(problem, JAVA)).toEqual([9, 5, 95, 3])
  })

  it('sword + Sharpness IV x2, Looting III, Unbreaking III -> [24, 7, 290, 7]', () => {
    const problem = advanced({ target: item('sword'), books: books({ sharpness: 4 }, { sharpness: 4 }, { looting: 3 }, { unbreaking: 3 }) })
    expect(solvedKeys(problem, JAVA)).toEqual([24, 7, 290, 7])
  })

  it('trident{Loyalty III, Channeling} + {Riptide III, Unbreaking III} + {Mending} -> 8', () => {
    const problem = advanced({
      target: item('trident', 0, { loyalty: 3, channeling: 1 }),
      books: books({ riptide: 3, unbreaking: 3 }, { mending: 1 }),
    })
    expect(solvedKeys(problem, JAVA)[0]).toBe(8)
  })

  it('sword{Sharpness V} + Smite V + Looting III, every input used -> 13; with goal Looting III -> 6 without the Smite book', () => {
    const sharpnessSwordSmiteLooting = advanced({ target: item('sword', 0, { sharpness: 5 }), books: books({ smite: 5 }, { looting: 3 }) })
    expect(solvedKeys(sharpnessSwordSmiteLooting, JAVA)[0]).toBe(13)
    const { np, outcome } = solve({ ...sharpnessSwordSmiteLooting, goal: { looting: 3 }, useOnlyNeeded: true }, JAVA)
    const ok = expectOk(outcome)
    expectValidPlan(np, JAVA, ok.plan)
    expect(ok.plan.keys.totalLevels).toBe(6)
    expect(ok.plan.unusedInputs).toEqual([1])
  })

  it.each<[Edition, [number, number, number, number]]>([
    ['java', [26, 9, 322, 7]],
    ['bedrock', [19, 7, 209, 7]],
  ])('%s: pickaxe + Efficiency III x2, IV, Unbreaking III, Mending without a goal -> %j with Efficiency V', (edition, expected) => {
    const problem = advanced({ target: item('pickaxe'), books: books({ efficiency: 3 }, { efficiency: 3 }, { efficiency: 4 }, { unbreaking: 3 }, { mending: 1 }) })
    const settings = settingsFor(edition)
    const { np, outcome } = solve(problem, settings)
    const ok = expectOk(outcome)
    expectValidPlan(np, settings, ok.plan)
    expect(scenarioKeys(ok.plan.keys)).toEqual(expected)
    expect(ok.plan.final.enchantments).toEqual({ efficiency: 5, mending: 1, unbreaking: 3 })
    expect(ok.otherMaximal).toEqual([])
  })

  it('mace + Wind Burst I x4, Density V, Unbreaking III, Mending with the goal -> [42, 12, 570, 7]', () => {
    const problem: SimpleProblem = {
      mode: 'simple',
      item: 'mace',
      enchantments: [
        { id: 'wind_burst', level: 3, sources: [{ level: 1, count: 4 }] },
        { id: 'density', level: 5 }, { id: 'unbreaking', level: 3 }, { id: 'mending', level: 1 },
      ],
    }
    expect(solvedKeys(problem, JAVA)).toEqual([42, 12, 570, 7])
  })

  it.each<[Edition, number]>([['java', 13], ['bedrock', 9]])('%s: Unbreaking I x3 cannot reach III; x4 -> %i', (edition, total) => {
    const settings = settingsFor(edition)
    const unbreakingFrom = (count: number): SimpleProblem =>
      ({ mode: 'simple', item: 'boots', enchantments: [{ id: 'unbreaking', level: 3, sources: [{ level: 1, count }] }] })
    const three = solve(unbreakingFrom(3), settings)
    expect(three.outcome).toMatchObject({ status: 'no-plan', partial: null })
    expect(solvedKeys(unbreakingFrom(4), settings)[0]).toBe(total)
  })

  it.each<[Edition, [number, number, number, number]]>([
    ['java', [9, 8, 119, 3]],
    ['bedrock', [8, 7, 98, 3]],
  ])('%s: the Smite I book blocks Sharpness V, so both books are used -> %j; keeping Sharpness V costs 11', (edition, expected) => {
    const settings = settingsFor(edition)
    const problem = advanced({ target: item('sword'), books: books({ smite: 1 }, { sharpness: 5, looting: 3 }), goal: { looting: 3 }, useOnlyNeeded: true })
    const { np, outcome } = solve(problem, settings)
    const ok = expectOk(outcome)
    expectValidPlan(np, settings, ok.plan)
    expect(scenarioKeys(ok.plan.keys)).toEqual(expected)
    expect(ok.plan.usedInputs).toEqual([0, 1, 2])
    expect(ok.plan.final.enchantments.sharpness).toBeUndefined()
    // The keep alternative: re-solve with Sharpness V added to the goal
    expect(solvedKeys({ ...problem, goal: { looting: 3, sharpness: 5 } }, settings).slice(0, 2)).toEqual([11, 11])
  })

  it('blocking variants: boots + Frost Walker I + {Depth Strider III, Feather Falling IV}, goal Feather Falling IV -> Java 8 (not 10)', () => {
    const problem = advanced({ target: item('boots'), books: books({ frost_walker: 1 }, { depth_strider: 3, feather_falling: 4 }), goal: { feather_falling: 4 } })
    expect(solvedKeys(problem, JAVA)[0]).toBe(8)
    const bookOnly = advanced({ books: books({ sharpness: 5, looting: 3 }, { smite: 1 }), goal: { looting: 3 } })
    const { np, outcome } = solve(bookOnly, JAVA)
    expectMatchesReference(np, JAVA, outcome)
  })

  it('boots with 5 anvil uses + Thorns III is refused at cap 39 (43); + Mending instead -> 33', () => {
    const thorns = advanced({ target: item('boots', 5), books: books({ thorns: 3 }) })
    const { np, outcome } = solve(thorns, JAVA)
    expect(outcome.status).toBe('no-plan')
    if (outcome.status !== 'no-plan') return
    // Not every input can be used: the target alone is the largest usable subset (reported as 'cannot-use-all-inputs')
    expect(outcome.partial?.unusedInputs).toEqual([1])
    expect(outcome.partial?.usedInputs).toEqual([0])
    expect(solvedKeys(thorns, JAVA, { levelCap: null })).toEqual([43, 43, xpAtLevel(43), 63])
    expect(solvedKeys(thorns, JAVA, { levelCap: 43 })[0]).toBe(43)
    expect(solve(thorns, JAVA, { levelCap: 42 }).outcome.status).toBe('no-plan')
    expect(solvedKeys(advanced({ target: item('boots', 5), books: books({ mending: 1 }) }), JAVA)[0]).toBe(33)
    expectMatchesReference(np, JAVA, outcome)
  })

  it.each<[Edition, [number, number, number, number], [number, number, number, number]]>([
    ['java', [6, 4, 56, 3], [9, 5, 87, 3]],
    ['bedrock', [4, 2, 32, 3], [6, 3, 50, 3]],
  ])('%s: Unbreaking I, II, II -> %j; I x3, II -> %j', (edition, keysOneTwoTwo, keysThreeOnesTwo) => {
    const settings = settingsFor(edition)
    const withBooks = (...levels: number[]) => advanced({
      target: item('boots'), books: books(...levels.map((level) => ({ unbreaking: level }))), goal: { unbreaking: 3 }, useOnlyNeeded: true,
    })
    expect(solvedKeys(withBooks(1, 2, 2), settings)).toEqual(keysOneTwoTwo)
    expect(solvedKeys(withBooks(1, 1, 1, 2), settings)).toEqual(keysThreeOnesTwo)
  })

  it.each<[Edition, [number, number, number, number]]>([
    ['java', [13, 7, 141, 7]],
    ['bedrock', [9, 5, 85, 7]],
  ])('%s: boots + Unbreaking I x4 without a goal -> %j with Unbreaking III', (edition, expected) => {
    const settings = settingsFor(edition)
    const { np, outcome } = solve(advanced({ target: item('boots'), books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }] }), settings)
    const ok = expectOk(outcome)
    expectValidPlan(np, settings, ok.plan)
    expect(scenarioKeys(ok.plan.keys)).toEqual(expected)
    expect(ok.plan.final.enchantments).toEqual({ unbreaking: 3 })
  })

  it.each<[Edition, [number, number, number, number]]>([
    ['java', [14, 7, 158, 3]],
    ['bedrock', [8, 4, 74, 3]],
  ])('%s: levels that cannot all be reached together -> %j and the other maximal result', (edition, expected) => {
    const problem = advanced({
      target: item('boots'),
      books: books({ unbreaking: 1, feather_falling: 1 }, { unbreaking: 1, feather_falling: 2 }, { unbreaking: 2, feather_falling: 1 }),
    })
    for (const levelCap of [39, null] as const) {
      const settings = settingsFor(edition, { levelCap })
      const { np, outcome } = solve(problem, settings)
      const ok = expectOk(outcome)
      expectValidPlan(np, settings, ok.plan)
      expect(scenarioKeys(ok.plan.keys)).toEqual(expected)
      const vectors = [ok.plan, ...ok.otherMaximal].map((plan) => plan.final.enchantments)
      expect(vectors).toHaveLength(2)
      expect(vectors).toEqual(expect.arrayContaining([{ unbreaking: 3, feather_falling: 2 }, { unbreaking: 2, feather_falling: 3 }]))
      expect(ok.otherMaximal[0].keys).toEqual(ok.plan.keys)
      for (const other of ok.otherMaximal) expectValidPlan(np, settings, other)
      // A goal with both at III cannot be met even without a cap
      expect(solve({ ...problem, goal: { unbreaking: 3, feather_falling: 3 } }, settings).outcome.status).toBe('no-plan')
    }
  })

  it.each(EDITIONS)('%s: the 7 boots books combined into one book -> [49, 12, 793, 15]', (edition) => {
    expect(solvedKeys(advanced({ books: MAX_BOOTS_BOOKS }), settingsFor(edition))).toEqual([49, 12, 793, 15])
  })

  it('sword books combined into one book (Java) -> [31, 10, 435, 7]', () => {
    const problem = advanced({ books: books({ sharpness: 5 }, { looting: 3 }, { unbreaking: 3 }, { mending: 1 }, { fire_aspect: 2 }, { sweeping_edge: 3 }) })
    expect(solvedKeys(problem, JAVA)).toEqual([31, 10, 435, 7])
  })

  it('boots (uses 6){Unbreaking III} + rename: Bedrock refuses the rename (64), Java clamps it to 39', () => {
    const problem = advanced({ target: item('boots', 6, { unbreaking: 3 }), goal: { unbreaking: 3 }, useOnlyNeeded: true })
    expect(solve(problem, settingsFor('bedrock', { rename: true })).outcome.status).toBe('no-plan')
    const { outcome } = solve(problem, settingsFor('java', { rename: true }))
    const ok = expectOk(outcome)
    expect(scenarioKeys(ok.plan.keys)).toEqual([39, 39, 2727, 63])
    expect(ok.plan.tree).toEqual({ t: 'leaf', input: 0, preRename: true })
  })

  it.each<[Edition, [number, number, number, number]]>([
    ['java', [19, 9, 245, 3]],
    ['bedrock', [18, 8, 222, 3]],
  ])('%s: sword + Sharpness V + Smite V + Looting III without a goal -> %j, one of the conflicting pair kept', (edition, expected) => {
    const settings = settingsFor(edition)
    const { np, outcome } = solve(advanced({ target: item('sword'), books: books({ sharpness: 5 }, { smite: 5 }, { looting: 3 }) }), settings)
    const ok = expectOk(outcome)
    expectValidPlan(np, settings, ok.plan)
    expect(scenarioKeys(ok.plan.keys)).toEqual(expected)
    const vectors = [ok.plan, ...ok.otherMaximal].map((plan) => plan.final.enchantments)
    expect(vectors).toEqual(expect.arrayContaining([{ sharpness: 5, looting: 3 }, { smite: 5, looting: 3 }]))
    expect(vectors).toHaveLength(2)
    expect(ok.otherMaximal[0].keys.totalLevels).toBe(expected[0])
    expectMatchesReference(np, settings, outcome)
  })
})

describe('scenarios against the exhaustive reference in both editions', () => {
  // Scenarios with known values only for Java must match the exhaustive reference in Bedrock too
  const cases: ReadonlyArray<[string, Problem]> = [
    ['books only, Sharpness IV x2 + Unbreaking III', advanced({ books: [{ enchantments: { sharpness: 4 }, anvilUses: 0, count: 2 }, { enchantments: { unbreaking: 3 }, anvilUses: 0 }] })],
    ['sword + Sharpness IV x2, Looting III, Unbreaking III', advanced({ target: item('sword'), books: books({ sharpness: 4 }, { sharpness: 4 }, { looting: 3 }, { unbreaking: 3 }) })],
    ['trident{Loyalty III, Channeling} + {Riptide III, Unbreaking III} + Mending', advanced({ target: item('trident', 0, { loyalty: 3, channeling: 1 }), books: books({ riptide: 3, unbreaking: 3 }, { mending: 1 }) })],
    ['sword{Sharpness V} + Smite V + Looting III', advanced({ target: item('sword', 0, { sharpness: 5 }), books: books({ smite: 5 }, { looting: 3 }) })],
    ['the same with goal Looting III', advanced({ target: item('sword', 0, { sharpness: 5 }), books: books({ smite: 5 }, { looting: 3 }), goal: { looting: 3 } })],
    ['pickaxe + Efficiency III x2, IV, Unbreaking III, Mending', advanced({ target: item('pickaxe'), books: books({ efficiency: 3 }, { efficiency: 3 }, { efficiency: 4 }, { unbreaking: 3 }, { mending: 1 }) })],
    ['a Smite I book that blocks Sharpness V', advanced({ target: item('sword'), books: books({ smite: 1 }, { sharpness: 5, looting: 3 }), goal: { looting: 3 } })],
    ['Unbreaking I, II, II, goal III', advanced({ target: item('boots'), books: books({ unbreaking: 1 }, { unbreaking: 2 }, { unbreaking: 2 }), goal: { unbreaking: 3 } })],
    ['Unbreaking I x3, II, goal III', advanced({ target: item('boots'), books: books({ unbreaking: 1 }, { unbreaking: 1 }, { unbreaking: 1 }, { unbreaking: 2 }), goal: { unbreaking: 3 } })],
    ['Unbreaking I x4, no goal', advanced({ target: item('boots'), books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }] })],
    ['levels that cannot all be reached together', advanced({ target: item('boots'), books: books({ unbreaking: 1, feather_falling: 1 }, { unbreaking: 1, feather_falling: 2 }, { unbreaking: 2, feather_falling: 1 }) })],
    ['sword + Sharpness V, Smite V, Looting III', advanced({ target: item('sword'), books: books({ sharpness: 5 }, { smite: 5 }, { looting: 3 }) })],
  ]
  const variants: ReadonlyArray<Partial<Settings>> = [{}, { levelCap: null }, { objective: 'xp' }, { objective: 'finalPwp' }, { rename: true }]

  it.each(cases)('%s', (_label, problem) => {
    for (const edition of EDITIONS) {
      for (const variant of variants) {
        const settings = settingsFor(edition, variant)
        const { np, outcome } = solve(problem, settings)
        expectMatchesReference(np, settings, outcome)
        if (outcome.status === 'ok') expectValidPlan(np, settings, outcome.plan)
      }
    }
  })
})

describe('roots when every input must be used', () => {
  it('reports the largest usable subset when the full set has no plan (Bedrock no-effect, Java nothing-transfers)', () => {
    // Bedrock refuses an Efficiency V book on an Efficiency V pickaxe because no level changes; Java charges for it and accepts
    const bedrock = settingsFor('bedrock')
    const pickaxe = advanced({ target: item('pickaxe', 0, { efficiency: 5 }), books: books({ efficiency: 5 }) })
    expect(solve(pickaxe, bedrock).outcome).toMatchObject({ status: 'no-plan', partial: { usedInputs: [0], unusedInputs: [1] }, noEffectRefusals: true })
    expect(solve(pickaxe, JAVA).outcome.status).toBe('ok')
    // The refusal is reported even when it only happens in smaller subsets (the full set has no pair left to try)
    const twoBooks = advanced({ ...pickaxe, books: [{ enchantments: { efficiency: 5 }, anvilUses: 0, count: 2 }] })
    expect(solve(twoBooks, bedrock).outcome).toMatchObject({ status: 'no-plan', noEffectRefusals: true })
    // With an Unbreaking III book, the Efficiency V book can be merged into it first
    const withUnbreaking = advanced({ ...pickaxe, books: books({ efficiency: 5 }, { unbreaking: 3 }), goal: { unbreaking: 3 }, useOnlyNeeded: false })
    expect(expectOk(solve(withUnbreaking, bedrock).outcome).plan.unusedInputs).toEqual([])

    // Java: nothing on the Smite book transfers to a Sharpness sword
    const sharpnessSwordWithSmite = advanced({ target: item('sword', 0, { sharpness: 5 }), books: books({ smite: 5 }), goal: { sharpness: 5 }, useOnlyNeeded: false })
    expect(solve(sharpnessSwordWithSmite, JAVA).outcome).toMatchObject({ status: 'no-plan', partial: { usedInputs: [0], unusedInputs: [1] }, noEffectRefusals: false })
    // With useOnlyNeeded the unusable input is simply left out, so nothing is reported
    expect(solve({ ...sharpnessSwordWithSmite, useOnlyNeeded: true }, JAVA).outcome.status).toBe('ok')
  })

  it('the partial plan is the largest usable subset (boots with 5 uses: Thorns III never fits under the cap)', () => {
    // Boots with a prior work penalty of 31: Mending + Unbreaking III merged into one book fit at 37, but adding Thorns III costs 46 or more
    const problem = advanced({ target: item('boots', 5), books: books({ mending: 1 }, { unbreaking: 3 }, { thorns: 3 }) })
    const { np, outcome } = solve(problem, JAVA)
    expect(outcome.status).toBe('no-plan')
    if (outcome.status !== 'no-plan' || outcome.partial === null) throw new Error('expected a partial plan')
    expect(outcome.partial.usedInputs).toEqual([0, 1, 2])
    expect(outcome.partial.unusedInputs).toEqual([3])
    expect(outcome.partial.keys.totalLevels).toBe(2 + 37)   // Mending book onto the Unbreaking book: 2; onto the boots: 31 + 1 + 3 + 2
    expectValidPlan({ ...np, useOnlyNeeded: true }, JAVA, outcome.partial)
    expectMatchesReference(np, JAVA, outcome)
  })
})

describe('objective xp keeps the single best (x, t, m) entry', () => {
  // Found by random search: partial plans that tie on XP points and differ only in total levels (in the second case, in max step)
  it('equal XP is broken by total levels', () => {
    const settings = settingsFor('bedrock', { objective: 'xp' })
    const problem = advanced({
      target: item('fishing_rod'),
      books: [...books({ lure: 3, unbreaking: 3 }, { luck_of_the_sea: 3 }, { luck_of_the_sea: 3 }), { enchantments: { lure: 1 }, anvilUses: 0, count: 2 }],
      goal: { luck_of_the_sea: 1 },
      useOnlyNeeded: false,
    })
    const { np, outcome } = solve(problem, settings)
    expect(expectOk(outcome).plan.keys).toEqual({ totalLevels: 27, maxStepLevels: 10, xpPoints: 367, finalPriorWorkPenalty: 7, inputsUsed: 6 })
    expectMatchesReference(np, settings, outcome)
  })

  it('equal XP and total levels are broken by the max step', () => {
    const settings = settingsFor('bedrock', { objective: 'xp' })
    const problem = advanced({
      books: [
        { enchantments: { density: 5 }, anvilUses: 1 },
        { enchantments: { channeling: 1, density: 1, piercing: 1 }, anvilUses: 0 },
        { enchantments: { channeling: 1, density: 1 }, anvilUses: 2 },
        { enchantments: { blast_protection: 2, depth_strider: 1, piercing: 4 }, anvilUses: 0 },
        { enchantments: { blast_protection: 4, channeling: 1, piercing: 3 }, anvilUses: 0 },
        { enchantments: { density: 5 }, anvilUses: 0 },
      ],
      goal: { density: 1 },
      useOnlyNeeded: false,
    })
    const { np, outcome } = solve(problem, settings)
    expect(expectOk(outcome).plan.keys).toEqual({ totalLevels: 33, maxStepLevels: 13, xpPoints: 493, finalPriorWorkPenalty: 15, inputsUsed: 6 })
    expectMatchesReference(np, settings, outcome)
  })
})

describe('rename', () => {
  it('book-only mode may rename any book as the base, and a renamed product is never a right input', () => {
    for (const edition of EDITIONS) {
      const settings = settingsFor(edition, { rename: true })
      const { np, outcome } = solve(advanced({ books: books({ sharpness: 5 }, { unbreaking: 3 }, { looting: 3 }) }), settings)
      expectMatchesReference(np, settings, outcome)
      expectValidPlan(np, settings, expectOk(outcome).plan)
    }
  })

  it('a target with prior work is renamed on a combine step (+1) rather than before it (PWP + 1)', () => {
    const settings = settingsFor('java', { rename: true })
    const problem = advanced({ target: item('boots', 3), books: books({ protection: 4 }, { unbreaking: 3 }) })
    const { np, outcome } = solve(problem, settings)
    expectMatchesReference(np, settings, outcome)
    const renames = (node: PlanNode): { pre: number; onStep: number } => {
      if (node.t === 'leaf') return { pre: node.preRename ? 1 : 0, onStep: 0 }
      const left = renames(node.left)
      const right = renames(node.right)
      return { pre: left.pre + right.pre, onStep: left.onStep + right.onStep + (node.rename ? 1 : 0) }
    }
    const plan = expectOk(outcome).plan
    expect(renames(plan.tree)).toEqual({ pre: 0, onStep: 1 })
    // A rename-only step would cost 7 + 1 = 8 levels
    expect(plan.keys.totalLevels).toBe(expectOk(solve(problem, JAVA).outcome).plan.keys.totalLevels + 1)
  })
})

describe('grouping identical inputs', () => {
  it('Wind Burst I x4 has 5 subsets instead of 16, and C follows the grouped formula', () => {
    const wind = advanced({ books: [{ enchantments: { wind_burst: 1 }, anvilUses: 0, count: 4 }], goal: { wind_burst: 3 } })
    const grouped = expectOk(solve(wind, JAVA).outcome)
    const ungrouped = expectOk(solve(wind, JAVA, { grouping: false }).outcome)
    expect(grouped.stats.subsets).toBe(4)          // the empty set is not processed: 5 - 1
    expect(ungrouped.stats.subsets).toBe(15)       // 16 - 1
    expect(grouped.stats.complexity).toBe((5 * 6) / 2)
    expect(ungrouped.stats.complexity).toBe(3 ** 4)
    expect(grouped.plan.keys).toEqual(ungrouped.plan.keys)

    // Mace + Wind Burst I x4 and three other books: groups {4, 1, 1, 1} with a target -> C = 2 * 15 * 3 * 3 * 3
    const maceSimpleMode: SimpleProblem = {
      mode: 'simple',
      item: 'mace',
      enchantments: [{ id: 'wind_burst', level: 3, sources: [{ level: 1, count: 4 }] }, { id: 'density', level: 5 }, { id: 'unbreaking', level: 3 }, { id: 'mending', level: 1 }],
    }
    expect(solve(maceSimpleMode, JAVA).outcome.stats.complexity).toBe(2 * 15 * 27)
  })

  it('maps the copies of a group to its inputs in index order along the leaves', () => {
    const { np, outcome } = solve(advanced({ target: item('boots'), books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }] }), JAVA)
    const plan = expectOk(outcome).plan
    const replay = replayPlan(plan.tree, np, JAVA)
    const bookLeaves = replay.leaves.filter((input) => input !== 0)
    expect(bookLeaves).toEqual([1, 2, 3, 4])
  })
})

describe('seeds and bound pruning', () => {
  const smiteBlocksSharpness = advanced({ target: item('sword'), books: books({ smite: 1 }, { sharpness: 5, looting: 3 }), goal: { looting: 3 } })

  it('a qualifying plan seeds the bound and does not change the answer', () => {
    const { np, outcome } = solve(BOOTS_WITH_MAX_BOOKS, JAVA)
    const plan = expectOk(outcome).plan
    const seeded = new ExactSearch(np, JAVA, { seeds: [plan.tree] })
    expect(seeded.bound).toEqual({ totalLevels: 66, xpPoints: null, finalAnvilUses: null })
    seeded.run(Number.POSITIVE_INFINITY)
    const result = expectOk(seeded.result())
    expect(result.plan.keys).toEqual(plan.keys)
    expect(result.stats.prunedByBound).toBeGreaterThan(0)
    expect(result.stats.transitions).toBeLessThan(outcome.stats.transitions)

    const xp = { ...JAVA, objective: 'xp' as const }
    expect(new ExactSearch(np, xp, { seeds: [plan.tree] }).bound).toEqual({ totalLevels: null, xpPoints: 1246, finalAnvilUses: null })
    // finalPwp uses no total or XP bound, and the anvil-uses bound needs a goal and useOnlyNeeded (this problem has no goal)
    expect(new ExactSearch(np, { ...JAVA, objective: 'finalPwp' }, { seeds: [plan.tree] }).bound).toEqual({ totalLevels: null, xpPoints: null, finalAnvilUses: null })
  })

  it('value seeds are trusted; boundPruning: false ignores every seed', () => {
    const np = normalized(BOOTS_WITH_MAX_BOOKS, JAVA)
    expect(new ExactSearch(np, JAVA, { seeds: [{ totalLevels: 70, xpPoints: 1500 }, { totalLevels: 68, xpPoints: 1600 }] }).bound.totalLevels).toBe(68)
    expect(new ExactSearch(np, JAVA, { seeds: [{ totalLevels: 70, xpPoints: 1500 }], boundPruning: false }).bound.totalLevels).toBeNull()
  })

  it('rejects seeds that are not valid answers to the problem', () => {
    // Bedrock, boots + Unbreaking I x4, goal III: the one-at-a-time chain costs 3 but only reaches II. As a seed it would prune the optimum of 9
    const bedrock = settingsFor('bedrock')
    const unbreaking = advanced({ target: item('boots'), books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }], goal: { unbreaking: 3 } })
    const np = normalized(unbreaking, bedrock)
    const leaf = (input: number, preRename = false): PlanNode => ({ t: 'leaf', input, preRename })
    const join = (left: PlanNode, right: PlanNode, rename = false): PlanNode => ({ t: 'combine', left, right, rename })
    const chain = join(join(leaf(0), leaf(1)), leaf(2))
    expect(replayPlan(chain, np, bedrock).final.enchantments).toEqual({ unbreaking: 2 })
    const search = new ExactSearch(np, bedrock, { seeds: [chain] })
    expect(search.bound.totalLevels).toBeNull()
    search.run(Number.POSITIVE_INFINITY)
    expect(expectOk(search.result()).plan.keys.totalLevels).toBe(9)

    const rejected = (problem: Problem, settings: Settings, seed: PlanNode): void => {
      expect(new ExactSearch(normalized(problem, settings), settings, { seeds: [seed] }).bound.totalLevels, JSON.stringify(seed)).toBeNull()
    }
    const bootsChain = [1, 2, 3, 4, 5, 6, 7].reduce<PlanNode>((acc, input) => join(acc, leaf(input)), leaf(0))
    rejected(BOOTS_WITH_MAX_BOOKS, JAVA, bootsChain)                                    // step 7 costs 65, over the cap
    rejected(BOOTS_WITH_MAX_BOOKS, JAVA, join(leaf(0), leaf(1)))                        // not every input is used
    rejected(BOOTS_WITH_MAX_BOOKS, { ...JAVA, rename: true }, join(leaf(0), leaf(1)))   // not renamed
    rejected(smiteBlocksSharpness, JAVA, join(leaf(1), leaf(0)))                        // the target is not the base
    rejected(smiteBlocksSharpness, JAVA, join(leaf(0), leaf(0)))                        // the same input twice
    rejected(smiteBlocksSharpness, JAVA, join(leaf(0), leaf(9)))                        // an input out of range
    rejected(smiteBlocksSharpness, JAVA, join(leaf(0), leaf(1)))                        // the goal is not met
    // The goal is met, but an input is unused in a problem that must use every input
    const sharpnessSwordMustUseAll = advanced({ target: item('sword', 0, { sharpness: 5 }), books: books({ smite: 5 }, { looting: 3 }), goal: { looting: 3 }, useOnlyNeeded: false })
    rejected(sharpnessSwordMustUseAll, JAVA, join(leaf(0), leaf(2)))
    expect(new ExactSearch(normalized({ ...sharpnessSwordMustUseAll, useOnlyNeeded: true }, JAVA), JAVA, { seeds: [join(leaf(0), leaf(2))] }).bound.totalLevels).toBe(6)
    rejected(smiteBlocksSharpness, { ...JAVA, rename: true }, join(leaf(0), leaf(2, true), true))   // a renamed right leaf
    rejected(smiteBlocksSharpness, { ...JAVA, rename: true }, join(leaf(0, true), leaf(2), true))   // renamed twice
    // No goal: when enchantments that could remain conflict, the maximal result is not unique, so the plan is not a seed
    const swordSharpnessOrSmite = advanced({ target: item('sword'), books: books({ sharpness: 5 }, { smite: 5 }, { looting: 3 }) })
    const swordSharpnessOrSmitePlan = expectOk(solve(swordSharpnessOrSmite, JAVA).outcome).plan.tree
    rejected(swordSharpnessOrSmite, JAVA, swordSharpnessOrSmitePlan)
    // No goal: a plan below the reachable level (it stops at Unbreaking II)
    const unbreakingNoGoal = advanced({ target: item('boots'), books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }] })
    rejected(unbreakingNoGoal, JAVA, join(join(join(join(leaf(0), leaf(1)), leaf(2)), leaf(3)), leaf(4)))
    const unbreakingNoGoalBest = expectOk(solve(unbreakingNoGoal, JAVA).outcome).plan.tree
    expect(new ExactSearch(normalized(unbreakingNoGoal, JAVA), JAVA, { seeds: [unbreakingNoGoalBest] }).bound.totalLevels).toBe(13)
    // A valid seed is accepted (a plan that renames first)
    const renamed = { ...JAVA, rename: true }
    const valid = join(join(leaf(0, true), leaf(1)), leaf(2))
    expect(new ExactSearch(normalized(smiteBlocksSharpness, renamed), renamed, { seeds: [valid] }).bound.totalLevels).not.toBeNull()
  })

  it('bound pruning from roots found on the way prunes with a goal and useOnlyNeeded', () => {
    const problem = advanced({
      target: item('sword'),
      books: books({ sharpness: 5 }, { sharpness: 4 }, { sharpness: 4 }, { smite: 5 }, { looting: 3 }, { unbreaking: 3 }, { mending: 1 }, { fire_aspect: 2 }),
      goal: { sharpness: 5, looting: 3 },
    })
    const pruned = expectOk(solve(problem, JAVA).outcome)
    const unpruned = expectOk(solve(problem, JAVA, { boundPruning: false }).outcome)
    expect(pruned.plan.keys).toEqual(unpruned.plan.keys)
    expect(pruned.stats.prunedByBound).toBeGreaterThan(0)
    expect(pruned.stats.transitions).toBeLessThan(unpruned.stats.transitions / 2)
    expect(unpruned.stats.prunedByBound).toBe(0)
  })
})

describe("the anvil-uses bound for objective 'finalPwp' with a goal and useOnlyNeeded", () => {
  const FINAL_PWP: Settings = { ...JAVA, objective: 'finalPwp' }
  // Boots + 8 books (none left out of the search), goal {Unbreaking III, Mending, Protection IV}: a finished object found
  // early with few books lets the search drop combinations that would need more anvil uses
  const problem = advanced({
    target: item('boots'),
    books: books({ unbreaking: 3 }, { mending: 1 }, { protection: 4 }, { feather_falling: 4, unbreaking: 1 }, { thorns: 3, protection: 1 },
      { depth_strider: 3, mending: 1 }, { unbreaking: 2, feather_falling: 2 }, { protection: 3, thorns: 1 }),
    goal: { unbreaking: 3, mending: 1, protection: 4 },
  })

  it('prunes by the anvil uses of roots found on the way without changing the answer', () => {
    const pruned = expectOk(solve(problem, FINAL_PWP).outcome)
    const unpruned = expectOk(solve(problem, FINAL_PWP, { boundPruning: false }).outcome)
    expect(pruned.plan.keys).toEqual(unpruned.plan.keys)
    expect(normalized(problem, FINAL_PWP).excludedInputs).toEqual([])
    expect(pruned.plan.keys).toMatchObject({ finalPriorWorkPenalty: 3, inputsUsed: 4 })
    expect(pruned.stats.prunedByBound).toBeGreaterThan(0)
    expect(pruned.stats.states).toBeLessThan(unpruned.stats.states)
    expect(unpruned.stats.prunedByBound).toBe(0)
  })

  it('a qualifying seed sets the bound (and the total at that many uses); other objectives and boundPruning: false do not use it', () => {
    const { np, outcome } = solve(problem, FINAL_PWP)
    const plan = expectOk(outcome).plan
    const seeded = new ExactSearch(np, FINAL_PWP, { seeds: [plan.tree] })
    expect(seeded.bound).toEqual({ totalLevels: null, xpPoints: null, finalAnvilUses: 2 })
    seeded.run(Number.POSITIVE_INFINITY)
    expect(expectOk(seeded.result()).plan.keys).toEqual(plan.keys)
    // A value seed sets it only when it carries anvil uses
    expect(new ExactSearch(np, FINAL_PWP, { seeds: [{ totalLevels: 99, xpPoints: 9999, finalAnvilUses: 5 }] }).bound.finalAnvilUses).toBe(5)
    expect(new ExactSearch(np, FINAL_PWP, { seeds: [{ totalLevels: 99, xpPoints: 9999 }] }).bound.finalAnvilUses).toBeNull()
    expect(new ExactSearch(np, FINAL_PWP, { seeds: [plan.tree], boundPruning: false }).bound.finalAnvilUses).toBeNull()
    expect(new ExactSearch(np, JAVA, { seeds: [plan.tree] }).bound.finalAnvilUses).toBeNull()
    // Not used when every input must be used, since the only root is the full set
    const useAll = normalized({ ...problem, useOnlyNeeded: false }, FINAL_PWP)
    expect(new ExactSearch(useAll, FINAL_PWP, { seeds: [{ totalLevels: 99, xpPoints: 9999, finalAnvilUses: 5 }] }).bound.finalAnvilUses).toBeNull()
  })

  it('a known uses bound stops the projected-time abort, like the other bounds', () => {
    const np = normalized(problem, FINAL_PWP)
    const limits = { exactTimeBudgetMs: 30_000, projectionMinFraction: 0.1 }
    let clock = 0
    const unbounded = new ExactSearch(np, FINAL_PWP, { now: () => (clock += 100), limits, boundPruning: false })
    unbounded.run(Number.POSITIVE_INFINITY)
    expect(unbounded.result()).toMatchObject({ status: 'aborted', cause: 'time-limit' })
    expect(unbounded.result().elapsedMs).toBeLessThan(30_000)   // stopped on the projection
    let clock2 = 0
    const bounded = new ExactSearch(np, FINAL_PWP, { now: () => (clock2 += 100), limits })
    bounded.run(Number.POSITIVE_INFINITY)
    expect(bounded.result().status).toBe('ok')
  })

  it('300 random problems (both editions, rename, with and without a cap, books only): the same keys as the exhaustive reference and as without the bound', () => {
    const random = seededRandom(20260928)
    let pruning = 0
    let ok = 0
    for (let i = 0; i < 300; i++) {
      const drawn = randomProblem(random, { minInputs: 3, maxInputs: 6, noGoalRate: 0 })
      const problem = { ...drawn.problem, useOnlyNeeded: true }
      const settings: Settings = { ...drawn.settings, objective: 'finalPwp' }
      const np = normalized(problem, settings)
      const outcome = solveExactSync(np, settings)
      try {
        expectMatchesReference(np, settings, outcome)
        const unpruned = solveExactSync(np, settings, { boundPruning: false })
        expect(unpruned.status).toBe(outcome.status)
        if (outcome.status === 'ok' && unpruned.status === 'ok') {
          expect(outcome.plan.keys).toEqual(unpruned.plan.keys)
          expectValidPlan(np, settings, outcome.plan)
          expect(expectOk(solveExactSync(np, settings, { seeds: [outcome.plan.tree] })).plan.keys).toEqual(outcome.plan.keys)
          ok++
        }
        if (outcome.stats.prunedByBound > 0) pruning++
      } catch (error) {
        throw new Error(`problem ${i}: ${JSON.stringify({ problem, settings })}\n${String(error)}`, { cause: error })
      }
    }
    expect(ok).toBeGreaterThanOrEqual(100)
    expect(pruning).toBeGreaterThanOrEqual(30)
  }, HEAVY_TEST_TIMEOUT_MS)
})

describe('slicing, progress and limits', () => {
  it('a search run in many small slices gives the same plan as one synchronous run', () => {
    const np = normalized(BOOTS_WITH_MAX_BOOKS, JAVA)
    const once = solveExactSync(np, JAVA)
    let clock = 0
    const search = new ExactSearch(np, JAVA, { now: () => clock++ })   // each clock read advances 1 ms, so every slice stops at once
    let slices = 0
    let lastDone = search.progress.done
    expect(search.progress.total).toBe(4374)
    while (!search.run(0)) {
      slices++
      expect(search.progress.done).toBeGreaterThanOrEqual(lastDone)
      expect(search.progress.done).toBeLessThan(search.progress.total)
      lastDone = search.progress.done
      expect(() => search.result()).toThrow(/not finished/)
    }
    expect(slices).toBeGreaterThan(5)
    expect(search.progress.done).toBe(search.progress.total)
    const sliced = expectOk(search.result())
    expect(sliced.plan).toEqual(expectOk(once).plan)
    expect(sliced.stats).toEqual(once.stats)
    expect(search.run(10)).toBe(true)   // does nothing once finished
  })

  it('done reaches C for every grouping and target shape', () => {
    const problems: Problem[] = [
      advanced({ books: [{ enchantments: { wind_burst: 1 }, anvilUses: 0, count: 3 }, { enchantments: { mending: 1 }, anvilUses: 0 }] }),
      advanced({ target: item('boots'), books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 2 }, ...books({ mending: 1 })] }),
    ]
    for (const problem of problems) {
      const search = new ExactSearch(normalized(problem, JAVA), JAVA)
      search.run(Number.POSITIVE_INFINITY)
      expect(search.progress.done).toBe(search.progress.total)
    }
  })

  it('aborts on the state limit', () => {
    const outcome = solve(BOOTS_WITH_MAX_BOOKS, JAVA, { limits: { exactMaxStates: 50 } }).outcome
    expect(outcome).toMatchObject({ status: 'aborted', cause: 'state-limit' })
    expect(outcome.stats.states).toBe(50)
  })

  it('aborts on the time budget', () => {
    let clock = 0
    const outcome = solve(BOOTS_WITH_MAX_BOOKS, JAVA, { now: () => (clock += 50), limits: { exactTimeBudgetMs: 100, projectionMinFraction: 1 } }).outcome
    expect(outcome).toMatchObject({ status: 'aborted', cause: 'time-limit' })
    expect(outcome.elapsedMs).toBeGreaterThan(100)
  })

  it('aborts early on the projected time while no bound is known, before the budget is spent', () => {
    let clock = 0
    const np = normalized(BOOTS_WITH_MAX_BOOKS, JAVA)
    const search = new ExactSearch(np, JAVA, { now: () => (clock += 20), limits: { exactTimeBudgetMs: 5_000, projectionMinFraction: 0.1 } })
    search.run(Number.POSITIVE_INFINITY)
    const outcome = search.result()
    expect(outcome).toMatchObject({ status: 'aborted', cause: 'time-limit' })
    expect(outcome.elapsedMs).toBeLessThan(5_000)
    expect(search.progress.done / search.progress.total).toBeGreaterThanOrEqual(0.1)
    // With a known bound there is no projected-time abort, and the search finishes within the budget
    let clock2 = 0
    const plan = expectOk(solveExactSync(np, JAVA)).plan
    const seeded = new ExactSearch(np, JAVA, { now: () => (clock2 += 20), seeds: [plan.tree], limits: { exactTimeBudgetMs: 5_000, projectionMinFraction: 0.1 } })
    seeded.run(Number.POSITIVE_INFINITY)
    expect(seeded.result().status).toBe('ok')
  })

  it('throws a RangeError when the enchantment universe exceeds the limit', () => {
    const np = normalized(advanced({ books: books({ sharpness: 5 }, { unbreaking: 3 }, { mending: 1 }) }), JAVA)
    expect(() => new ExactSearch(np, JAVA, { limits: { exactMaxDistinctEnchantments: 2 } })).toThrow(RangeError)
    expect(LIMITS.exactMaxDistinctEnchantments).toBe(30)
  })

  it('handles problems without anything to combine', () => {
    expect(solve(advanced({ books: [] }), JAVA).outcome).toMatchObject({ status: 'no-plan', partial: null, noEffectRefusals: false })
    const alone = expectOk(solve(advanced({ target: item('sword', 2, { sharpness: 5 }) }), JAVA).outcome)
    expect(alone.plan.tree).toEqual({ t: 'leaf', input: 0, preRename: false })
    expect(alone.plan.keys).toEqual({ totalLevels: 0, maxStepLevels: 0, xpPoints: 0, finalPriorWorkPenalty: 3, inputsUsed: 1 })
  })
})

describe('key vectors', () => {
  const keys = { totalLevels: 1, maxStepLevels: 2, xpPoints: 3, finalPriorWorkPenalty: 4, inputsUsed: 5 }
  it('orders the keys by objective and compares lexicographically', () => {
    expect(planKeyVector(keys, 'levels')).toEqual([1, 2, 3, 4, 5])
    expect(planKeyVector(keys, 'xp')).toEqual([3, 1, 2, 4, 5])
    expect(planKeyVector(keys, 'finalPwp')).toEqual([4, 1, 2, 3, 5])
    expect(compareKeyVectors([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])).toBe(0)
    expect(compareKeyVectors([1, 2, 3, 4, 5], [1, 2, 4, 0, 0])).toBeLessThan(0)
    expect(compareKeyVectors([2, 0, 0, 0, 0], [1, 9, 9, 9, 9])).toBeGreaterThan(0)
  })
})

describe('random problems with at most 6 inputs: exhaustive reference and plan properties', () => {
  const SEED = 20260927
  const PROBLEMS = 1_000

  it(`${PROBLEMS} problems: equal key vectors, maximal sets and partial plans; grouping, pruning and seeding do not change the answer`, () => {
    const random = seededRandom(SEED)
    const seen = new Map<string, number>()
    const note = (key: string): void => { seen.set(key, (seen.get(key) ?? 0) + 1) }
    for (let i = 0; i < PROBLEMS; i++) {
      const { problem, settings } = randomProblem(random, { minInputs: 2, maxInputs: 6 })
      const np = normalized(problem, settings)
      const label = JSON.stringify({ problem, settings })
      const outcome = solveExactSync(np, settings)
      try {
        expectMatchesReference(np, settings, outcome)
        const ungrouped = solveExactSync(np, settings, { grouping: false })
        const unpruned = solveExactSync(np, settings, { boundPruning: false })
        for (const other of [ungrouped, unpruned]) {
          expect(other.status).toBe(outcome.status)
          if (outcome.status === 'ok' && other.status === 'ok') {
            expect(other.plan.keys).toEqual(outcome.plan.keys)
            expect(other.otherMaximal.map((p) => vectorKey(p.final.enchantments)).sort())
              .toEqual(outcome.otherMaximal.map((p) => vectorKey(p.final.enchantments)).sort())
          }
        }
        if (outcome.status === 'ok') {
          expectValidPlan(np, settings, outcome.plan)
          for (const other of outcome.otherMaximal) expectValidPlan(np, settings, other)
          // Seeding with the optimal plan does not change the answer
          const seeded = solveExactSync(np, settings, { seeds: [outcome.plan.tree] })
          expect(expectOk(seeded).plan.keys).toEqual(outcome.plan.keys)
          // Deterministic
          expect(expectOk(solveExactSync(np, settings)).plan).toEqual(outcome.plan)
          note('ok')
          if (np.goal === null) note(outcome.otherMaximal.length > 0 ? 'no-goal-several-maximal' : 'no-goal')
          if (outcome.plan.unusedInputs.length > 0) note('inputs-unused')
          if (settings.rename) note('renamed')
        } else if (outcome.status === 'no-plan') {
          note('no-plan')
          if (outcome.partial !== null) {
            expectValidPlan({ ...np, useOnlyNeeded: true }, settings, outcome.partial)
            note('partial')
          }
        }
        note(settings.objective)
        note(settings.edition)
        if (np.targetIndex === null) note('book-only')
        if (np.inputs.some((input) => input.kind === 'item' && input.origin.source === 'extra-item')) note('extra-item')
      } catch (error) {
        throw new Error(`problem ${i}: ${label}\n${String(error)}`, { cause: error })
      }
    }
    for (const key of ['ok', 'no-plan', 'partial', 'no-goal', 'no-goal-several-maximal', 'inputs-unused', 'renamed', 'levels', 'xp', 'finalPwp', 'java', 'bedrock', 'book-only', 'extra-item']) {
      expect(seen.get(key) ?? 0, key).toBeGreaterThanOrEqual(10)
    }
  }, HEAVY_TEST_TIMEOUT_MS)

  it('sliced runs equal synchronous runs on random problems', () => {
    const random = seededRandom(SEED + 1)
    for (let i = 0; i < 30; i++) {
      const { problem, settings } = randomProblem(random, { minInputs: 4, maxInputs: 6 })
      const np = normalized(problem, settings)
      let clock = 0
      const search = new ExactSearch(np, settings, { now: () => clock++ })
      while (!search.run(3)) { /* stops at every slice */ }
      const sync = solveExactSync(np, settings)
      const sliced = search.result()
      expect({ ...sliced, elapsedMs: 0 }).toEqual({ ...sync, elapsedMs: 0 })
    }
  })
})
