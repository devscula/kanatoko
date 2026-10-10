// Runs only with `npm run test:perf`. The main assertions are work counters with budgets at 1.5x RECORDED; the time limits
// are smoke checks at about 3x desktop times and may fail on a slow CI runner.

import { applicableEnchantments, areCompatible, maxLevel } from '../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../data/types.ts'
import { ExactSearch, planKeyVector, solveExactSync, type ExactOutcome } from './exactSearch.ts'
import { advanced, books, JAVA, normalized, randomProblem, referenceSolve, replayPlan, seededRandom, settingsFor, vectorKey } from './exactSearch.testkit.ts'
import type { AdvancedProblem, BookInput, EnchantLevels, NormalizedProblem, Settings } from './types.ts'

/**
 * Work depends only on the problem and the search order, not on the machine, so update these deliberately. Times when
 * recorded (Node 25, desktop): boots + 9 took 11 ms, 11 books 0.10-0.81 s, 12 books with a goal 0.25 s, the stacked boots
 * 0.30 s.
 */
const RECORDED = {
  bootsNineNoCap: { states: 2_489, transitions: 78_962 },
  elevenRandomUseAll: { maxStates: 71_397, maxTransitions: 8_141_418 },
  twelveDistinctGoal: { states: 39_889, transitions: 2_322_151 },
  stackedBootsGoal: { states: 21_231, transitions: 3_031_649 },
} as const

const budget = (recorded: number): number => Math.ceil(recorded * 1.5)
const TIMEOUT_MS = 180_000

function timed(np: NormalizedProblem, settings: Settings): { outcome: ExactOutcome; ms: number } {
  const start = performance.now()
  const outcome = solveExactSync(np, settings)
  return { outcome, ms: performance.now() - start }
}

function randomBooksProblem(seed: number, count: number, edition: Edition): AdvancedProblem {
  const random = seededRandom(seed)
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]
  const itemType = pick<ItemTypeId>(['sword', 'boots', 'helmet', 'chestplate', 'pickaxe', 'bow', 'trident', 'crossbow', 'axe', 'mace'])
  const pool = applicableEnchantments(edition, itemType)
  const bookList: BookInput[] = []
  const seen = new Set<string>()
  while (bookList.length < count) {
    const size = 1 + Math.floor(random() * 3)
    const chosen: EnchantmentId[] = []
    for (let tries = 0; chosen.length < size && tries < 20; tries++) {
      const id = pick(pool)
      if (!chosen.includes(id) && chosen.every((other) => areCompatible(edition, id, other))) chosen.push(id)
    }
    const enchantments: EnchantLevels = {}
    for (const id of chosen) enchantments[id] = 1 + Math.floor(random() * maxLevel(id))
    const key = vectorKey(enchantments)
    if (seen.has(key)) continue   // identical books would form a group and shrink C, so every book is kept distinct
    seen.add(key)
    bookList.push({ enchantments, anvilUses: 0 })
  }
  return advanced({ target: { itemType, enchantments: {}, anvilUses: 0 }, books: bookList })
}

describe('performance budgets of the exact search', () => {
  it('C ≤ 40 000: boots + 9 distinct books, no cap', () => {
    const problem = advanced({
      target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
      books: books(
        { protection: 4 }, { thorns: 3 }, { feather_falling: 4 }, { depth_strider: 3 }, { soul_speed: 3 },
        { swift_sneak: 3 }, { unbreaking: 3 }, { mending: 1 }, { vanishing_curse: 1 },
      ),
    })
    const settings = { ...JAVA, levelCap: null }
    const np = normalized(problem, settings)
    solveExactSync(np, settings)   // warm-up
    const { outcome, ms } = timed(np, settings)
    console.log('boots + 9, no cap', JSON.stringify(outcome.stats), `${ms.toFixed(1)} ms`)
    expect(outcome.status).toBe('ok')
    expect(outcome.stats.complexity).toBe(39_366)
    expect(outcome.stats.states).toBeLessThanOrEqual(budget(RECORDED.bootsNineNoCap.states))
    expect(outcome.stats.transitions).toBeLessThanOrEqual(budget(RECORDED.bootsNineNoCap.transitions))
    expect(ms).toBeLessThanOrEqual(150)
  }, TIMEOUT_MS)

  it('target + 11 random books with 1-3 enchantments, every input used, cap 39 (10 seeds)', () => {
    let maxStates = 0
    let maxTransitions = 0
    let slowest = 0
    for (let seed = 1; seed <= 10; seed++) {
      const problem = randomBooksProblem(seed, 11, 'java')
      const np = normalized(problem, JAVA)
      const { outcome, ms } = timed(np, JAVA)
      console.log(`11 random books, seed ${seed}`, outcome.status, JSON.stringify(outcome.stats), `${ms.toFixed(0)} ms`)
      expect(outcome.status).not.toBe('aborted')
      expect(outcome.stats.complexity).toBe(354_294)
      maxStates = Math.max(maxStates, outcome.stats.states)
      maxTransitions = Math.max(maxTransitions, outcome.stats.transitions)
      slowest = Math.max(slowest, ms)
    }
    expect(maxStates).toBeLessThanOrEqual(150_000)
    expect(maxStates).toBeLessThanOrEqual(budget(RECORDED.elevenRandomUseAll.maxStates))
    expect(maxTransitions).toBeLessThanOrEqual(budget(RECORDED.elevenRandomUseAll.maxTransitions))
    expect(slowest).toBeLessThanOrEqual(9_000)
  }, TIMEOUT_MS)

  it('target + 12 distinct inputs with a goal (C = 1 062 882) and the stacked-boots row', () => {
    const sword = advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
      books: books(
        { sharpness: 5 }, { smite: 5 }, { bane_of_arthropods: 5 }, { looting: 3 }, { unbreaking: 3 }, { mending: 1 },
        { fire_aspect: 2 }, { knockback: 2 }, { sweeping_edge: 3 }, { sharpness: 4 }, { looting: 2 }, { unbreaking: 2 },
      ),
      goal: { sharpness: 5, looting: 3, unbreaking: 3, mending: 1, fire_aspect: 2, knockback: 2, sweeping_edge: 3 },
    })
    const swordNp = normalized(sword, JAVA)
    const swordRun = timed(swordNp, JAVA)
    console.log('target + 12 distinct, goal', swordRun.outcome.status, JSON.stringify(swordRun.outcome.stats), `${swordRun.ms.toFixed(0)} ms`)
    expect(swordRun.outcome.stats.complexity).toBe(1_062_882)
    expect(swordRun.outcome.status).toBe('ok')
    expect(swordRun.ms).toBeLessThanOrEqual(5_000)

    const stacked = advanced({
      target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
      books: [
        { enchantments: { protection: 2 }, anvilUses: 0, count: 4 },
        { enchantments: { feather_falling: 2 }, anvilUses: 0, count: 4 },
        { enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 },
        ...books({ thorns: 3 }, { depth_strider: 3 }, { soul_speed: 3 }, { mending: 1 }),
      ],
      goal: { protection: 4, feather_falling: 4, unbreaking: 3, thorns: 3, depth_strider: 3, soul_speed: 3, mending: 1 },
    })
    const stackedNp = normalized(stacked, JAVA)
    const stackedRun = timed(stackedNp, JAVA)
    console.log('stacked boots, goal', stackedRun.outcome.status, JSON.stringify(stackedRun.outcome.stats), `${stackedRun.ms.toFixed(0)} ms`)
    expect(stackedRun.outcome.stats.complexity).toBe(546_750)
    expect(stackedRun.outcome.status).toBe('ok')
    expect(stackedRun.ms).toBeLessThanOrEqual(5_000)
    expect(swordRun.outcome.stats.states).toBeLessThanOrEqual(budget(RECORDED.twelveDistinctGoal.states))
    expect(swordRun.outcome.stats.transitions).toBeLessThanOrEqual(budget(RECORDED.twelveDistinctGoal.transitions))
    expect(stackedRun.outcome.stats.states).toBeLessThanOrEqual(budget(RECORDED.stackedBootsGoal.states))
    expect(stackedRun.outcome.stats.transitions).toBeLessThanOrEqual(budget(RECORDED.stackedBootsGoal.transitions))
  }, TIMEOUT_MS)

  it('memory: at most 200 bytes per state at the state limit', () => {
    // Target + 12 books, every input used, no cap (up to 287 000 states without a limit): the search stops at 150 000 states.
    // The check uses the typed arrays the search allocated; the Node heap delta is noisy because grown arrays linger until GC.
    const settings = { ...JAVA, levelCap: null }
    for (let seed = 1; seed <= 20; seed++) {
      const np = normalized(randomBooksProblem(seed, 12, 'java'), settings)
      const search = new ExactSearch(np, settings)
      search.run(Number.POSITIVE_INFINITY)
      const outcome = search.result()
      if (outcome.status !== 'aborted' || outcome.cause !== 'state-limit') continue
      const perState = search.storageBytes / outcome.stats.states
      console.log(`state limit reached with seed ${seed}: ${perState.toFixed(1)} bytes per state`)
      expect(outcome.stats.states).toBe(150_000)
      expect(perState).toBeLessThanOrEqual(200)
      return
    }
    throw new Error('no seed reached the state limit')
  }, TIMEOUT_MS)
})

describe('heavy cross-checks', () => {
  it('7 inputs: exhaustive reference, grouping and pruning (300 problems)', () => {
    const random = seededRandom(7_000_007)
    for (let i = 0; i < 300; i++) {
      const { problem, settings } = randomProblem(random, { minInputs: 7, maxInputs: 7 })
      const np = normalized(problem, settings)
      const outcome = solveExactSync(np, settings)
      const reference = referenceSolve(np, settings)
      const label = JSON.stringify({ problem, settings })
      if (reference.best === null) {
        expect(outcome.status, label).toBe('no-plan')
        continue
      }
      expect(outcome.status, label).toBe('ok')
      if (outcome.status !== 'ok') continue
      expect(planKeyVector(outcome.plan.keys, settings.objective), label).toEqual(reference.best)
      if (np.goal === null) {
        expect([outcome.plan, ...outcome.otherMaximal].map((plan) => vectorKey(plan.final.enchantments)).sort(), label).toEqual(reference.maximal)
      }
      expect(replayPlan(outcome.plan.tree, np, settings).keys).toEqual(outcome.plan.keys)
      for (const options of [{ grouping: false }, { boundPruning: false }]) {
        const other = solveExactSync(np, settings, options)
        expect(other.status === 'ok' && other.plan.keys, label).toEqual(outcome.plan.keys)
      }
    }
  }, TIMEOUT_MS)

  it('grouped vs ungrouped and pruning on vs off on larger random problems (8-10 inputs, 300 problems)', () => {
    const random = seededRandom(8_000_009)
    for (let i = 0; i < 300; i++) {
      const { problem, settings } = randomProblem(random, { minInputs: 8, maxInputs: 10 })
      const np = normalized(problem, settings)
      const outcome = solveExactSync(np, settings)
      const label = JSON.stringify({ problem, settings })
      for (const options of [{ grouping: false }, { boundPruning: false }]) {
        const other = solveExactSync(np, settings, options)
        expect(other.status, label).toBe(outcome.status)
        if (outcome.status === 'ok' && other.status === 'ok') expect(other.plan.keys, label).toEqual(outcome.plan.keys)
      }
      if (outcome.status === 'ok') expect(replayPlan(outcome.plan.tree, np, settings).keys, label).toEqual(outcome.plan.keys)
    }
  }, TIMEOUT_MS)

  it('both editions agree with the reference on bigger scenario-like inputs', () => {
    for (const edition of ['java', 'bedrock'] as const) {
      const settings = settingsFor(edition)
      const problem = advanced({
        target: { itemType: 'boots', enchantments: {}, anvilUses: 1 },
        books: books({ protection: 4 }, { thorns: 3 }, { feather_falling: 4 }, { unbreaking: 3 }, { mending: 1 }, { depth_strider: 3 }),
      })
      const np = normalized(problem, settings)
      const outcome = solveExactSync(np, settings)
      expect(outcome.status === 'ok' && planKeyVector(outcome.plan.keys, 'levels')).toEqual(referenceSolve(np, settings).best)
    }
  }, TIMEOUT_MS)
})
