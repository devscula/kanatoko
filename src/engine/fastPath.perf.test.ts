// Runs only with `npm run test:perf`.
import fc from 'fast-check'
import { applicableEnchantments, areCompatible, enchantmentsInEdition, maxLevel } from '../data/gameData.ts'
import type { EnchantmentId, ItemTypeId } from '../data/types.ts'
import { additiveDpKeys, bruteForceKeys, type AdditiveMode, type Keys } from './__fixtures__/additiveBruteForce.ts'
import { checkAdditive, solveTreeTable, solveWeights } from './fastPath.ts'
import { LIMITS } from './limits.ts'
import { normalizeProblem } from './normalize.ts'
import { validateProblem } from './validate.ts'
import { clearTreeTableCache, getTreeTable } from './treeTables.ts'
import type { Settings, SimpleProblem } from './types.ts'

const SEED = 20260928
const java: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
/** A budget that always completes the tie-break (about 300 000 evaluations at 11 books with all-distinct weights). */
const UNLIMITED = 10_000_000

function weightsArb(minLength: number, maxLength: number): fc.Arbitrary<number[]> {
  return fc.integer({ min: minLength, max: maxLength }).chain((length) => {
    const of = (value: fc.Arbitrary<number>) => fc.array(value, { minLength: length, maxLength: length })
    return fc.oneof(
      fc.integer({ min: 1, max: 12 }).map((w) => new Array<number>(length).fill(w)),
      fc.tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 })).chain(([a, b]) => of(fc.constantFrom(a, b))),
      of(fc.constantFrom(1, 2, 3, 4, 6, 8, 12)),
      of(fc.integer({ min: 1, max: 20 })),
    )
  })
}

const modeArb = fc.oneof(
  fc.record({ mode: fc.constant<AdditiveMode>('item'), targetUses: fc.integer({ min: 0, max: 3 }) }),
  fc.record({ mode: fc.constant<AdditiveMode>('book-only'), targetUses: fc.constant(0) }),
)

function keysOf(weights: readonly number[], mode: AdditiveMode, targetUses: number, budget: number): { keys: Keys; complete: boolean } {
  const { best, tieBreakComplete } = solveWeights(weights, mode, targetUses, budget)
  return { keys: [best.totalLevels, best.maxStepLevels, best.xpPoints, best.finalPriorWorkPenalty], complete: tieBreakComplete }
}

describe('tree-table vs additive brute force', () => {
  it('gives the exact key vector for 2 000 synthetic weight vectors with heavy ties, 2-11 books', () => {
    fc.assert(
      fc.property(modeArb, weightsArb(2, 11), ({ mode, targetUses }, weights) => {
        const expected = additiveDpKeys(weights, mode, targetUses)
        const full = keysOf(weights, mode, targetUses, UNLIMITED)
        expect(full.complete).toBe(true)
        expect(full.keys).toEqual(expected)
        // Default budget: the total is always optimal, and every key matches when the tie-break completed
        const budgeted = keysOf(weights, mode, targetUses, LIMITS.tieBreakMaxEvaluations)
        expect(budgeted.keys[0]).toBe(expected[0])
        if (budgeted.complete) expect(budgeted.keys).toEqual(expected)
      }),
      { numRuns: 2_000, seed: SEED },
    )
  }, 600_000)

  it('gives the exact key vector for all-distinct weights, 2-11 books', () => {
    const distinct = fc.integer({ min: 2, max: 11 }).chain((length) => fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { minLength: length, maxLength: length }))
    fc.assert(
      fc.property(modeArb, distinct, ({ mode, targetUses }, weights) => {
        expect(keysOf(weights, mode, targetUses, UNLIMITED).keys).toEqual(additiveDpKeys(weights, mode, targetUses))
      }),
      { numRuns: 300, seed: SEED + 1 },
    )
  }, 600_000)

  it('matches every combination of shape and assignment at 8 leaves', () => {
    fc.assert(
      fc.property(modeArb, weightsArb(7, 7), ({ mode, targetUses }, weights) => {
        const w = mode === 'book-only' ? [...weights, weights[6]] : weights   // 8 leaves in both modes
        expect(keysOf(w, mode, targetUses, UNLIMITED).keys).toEqual(bruteForceKeys(w, mode, targetUses))
      }),
      { numRuns: 60, seed: SEED + 2 },
    )
  }, 600_000)
})

function maxBooksProblem(item: ItemTypeId, limit: number): SimpleProblem {
  const problem = buildMaxBooksProblem(item, limit)
  expect(validateProblem(problem, java)).toEqual([])
  return problem
}

function buildMaxBooksProblem(item: ItemTypeId, limit: number): SimpleProblem {
  const pool = item === 'enchanted_book' ? enchantmentsInEdition('java').map((e) => e.id) : [...applicableEnchantments('java', item)]
  const chosen: EnchantmentId[] = []
  for (const id of pool) if (chosen.every((other) => areCompatible('java', id, other))) chosen.push(id)
  return {
    mode: 'simple',
    item,
    enchantments: chosen.slice(0, limit).map((id) => ({ id, level: maxLevel(id) })),
  }
}

function timeMs(run: () => void): number {
  const start = performance.now()
  run()
  return performance.now() - start
}

describe('performance budgets of the tree-table method', () => {
  it('solves real problems with up to 11 books within 20 000 evaluations and 10 ms (warm tables)', () => {
    const problems = (['boots', 'helmet', 'sword', 'pickaxe', 'bow', 'trident', 'mace'] as const).map((item) => maxBooksProblem(item, 11))
    problems.push(maxBooksProblem('enchanted_book', 11))
    for (const problem of problems) {
      const np = normalizeProblem(problem, java)
      const check = checkAdditive(np, java)
      expect(check.eligible).toBe(true)
      solveTreeTable(np, java, { check })   // warm the tables
      let evaluations = 0
      const ms = Math.min(...Array.from({ length: 5 }, () => timeMs(() => {
        evaluations = solveTreeTable(np, java, { check }).stats.tieBreakEvaluations
      })))
      expect(evaluations).toBeLessThanOrEqual(LIMITS.tieBreakMaxEvaluations)
      expect(ms, `${problem.item}: ${ms.toFixed(2)} ms`).toBeLessThanOrEqual(10)
    }
  })

  it('stops a large tie-break at the budget within 10 ms (warm tables)', () => {
    const weights = [40, 39, 38, 37, 34, 33, 30, 29, 24, 20, 17]
    solveWeights(weights, 'book-only', 0)
    const ms = Math.min(...Array.from({ length: 5 }, () => timeMs(() => solveWeights(weights, 'book-only', 0))))
    const solution = solveWeights(weights, 'book-only', 0)
    expect(solution).toMatchObject({ tieBreakComplete: false, tieBreakEvaluations: LIMITS.tieBreakMaxEvaluations })
    expect(ms).toBeLessThanOrEqual(10)
  })

  it('builds the tables for 24 books from scratch within 60 ms, with the known class counts', () => {
    clearTreeTableCache()
    const problem = maxBooksProblem('enchanted_book', 24)
    expect(problem.enchantments).toHaveLength(24)
    const np = normalizeProblem(problem, java)
    const ms = timeMs(() => {
      const outcome = solveTreeTable(np, java)
      expect(outcome.stats.classes).toBe(getTreeTable(24, 0, 'book-only').classes.length)
    })
    expect(ms).toBeLessThanOrEqual(60)
    expect(getTreeTable(8, 0, 'item').classes).toHaveLength(5)
    expect(getTreeTable(10, 0, 'item').classes).toHaveLength(7)
    expect(getTreeTable(12, 0, 'item').classes).toHaveLength(10)
    expect(getTreeTable(21, 0, 'item').classes).toHaveLength(27)
    clearTreeTableCache()
    expect(timeMs(() => getTreeTable(25, 0, 'item'))).toBeLessThanOrEqual(60)
  })
})
