// Larger runs and 8-input problems are in oracle.integration.perf.test.ts.

import type { Edition, EnchantmentId } from '../../data/types.ts'
import { normalizeProblem } from '../../engine/normalize.ts'
import { solveSync } from '../../engine/solve.ts'
import type { AdvancedProblem, BookInput, EnchantLevels } from '../../engine/types.ts'
import { OBJECTIVES } from '../oracle/bruteForce.ts'
import { areExclusive, enchantmentsOf, maxLevelOf } from '../oracle/gameFacts.ts'
import { caseFeatures, countInputs, sampleOracleCases, type CaseFeature } from '../oracle/generators.ts'
import { expensiveCaseArb, pipelineCaseArb, sample } from './generators.ts'
import { createTally, crossCheckAll, crossCheckWithOracle } from './oracleCrossCheck.ts'
import { keyVectorOf } from './planChecks.ts'

// Per edition
const ORACLE_CASES = 400
const PIPELINE_CASES = 150
const EXPENSIVE_CASES = 150

const SEEDS: Readonly<Record<Edition, number>> = { java: 0x5eed_0301, bedrock: 0x5eed_0302 }

describe.each<Edition>(['java', 'bedrock'])('solveSync vs the brute-force oracle (%s)', (edition) => {
  const oracleCases = sampleOracleCases(ORACLE_CASES, SEEDS[edition], { editions: [edition] })

  it(`agrees on ${ORACLE_CASES} problems of the oracle generator x 3 objectives`, () => {
    const tally = createTally()
    crossCheckAll(oracleCases, tally)
    // The generator produced every kind of case often enough
    expect(tally.ok).toBeGreaterThan(tally.solves / 2)
    expect(tally.infeasible).toBeGreaterThan(100)
    expect(tally.methods.exact).toBeGreaterThan(300)
    expect(tally.methods['tree-table']).toBeGreaterThan(20)
    expect(tally.methods.trivial).toBeGreaterThan(20)
    expect(tally.otherMaximal).toBeGreaterThan(5)
    expect(tally.discarded).toBeGreaterThan(50)
    expect(tally.suggestions).toBeGreaterThan(100)
  }, 120_000)

  it(`agrees on ${PIPELINE_CASES} goal problems with blocking and overlapping books`, () => {
    const tally = createTally()
    crossCheckAll(sample(pipelineCaseArb({ editions: [edition], maxBooks: 6 }), PIPELINE_CASES, SEEDS[edition] + 1), tally)
    expect(tally.methods['tree-table']).toBeGreaterThan(20)
    expect(tally.methods.exact).toBeGreaterThan(100)
    expect(tally.discarded).toBeGreaterThan(20)
    expect(tally.keep).toBeGreaterThan(5)
  }, 120_000)

  it(`agrees on ${EXPENSIVE_CASES} problems near the level cap (diagnosis and suggestions)`, () => {
    const tally = createTally()
    crossCheckAll(sample(expensiveCaseArb({ editions: [edition] }), EXPENSIVE_CASES, SEEDS[edition] + 2), tally)
    expect(tally.infeasible).toBeGreaterThan(50)
    expect(tally.tooExpensive).toBeGreaterThan(30)
    expect(tally.suggestions).toBeGreaterThan(30)
  }, 120_000)

  it('covers every feature in the oracle generator sample', () => {
    const seen = new Map<CaseFeature, number>()
    for (const testCase of oracleCases) for (const feature of caseFeatures(testCase)) seen.set(feature, (seen.get(feature) ?? 0) + 1)
    const expected: CaseFeature[] = [
      'simple', 'advanced', 'book-only', 'non-damageable-target', 'conflict', 'blocker', 'inapplicable', 'stacking', 'duplicate-inputs',
      'prior-work', 'extra-item', 'goal', 'no-goal', 'use-only-needed', 'use-all-with-goal', 'rename', 'no-cap',
    ]
    for (const feature of expected) expect(seen.get(feature) ?? 0, feature).toBeGreaterThan(5)
  })
})

// Inputs left out of the search

// mulberry32
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Books whose enchantments neither appear in nor conflict with any input or the goal. They may conflict with each other. */
function unrelatedBooks(problem: AdvancedProblem, edition: Edition, random: () => number): BookInput[] {
  const present = new Set<EnchantmentId>()
  const add = (levels: EnchantLevels): void => {
    for (const [id, level] of Object.entries(levels)) if ((level ?? 0) > 0) present.add(id as EnchantmentId)
  }
  if (problem.target !== null) add(problem.target.enchantments)
  for (const input of [...problem.extraItems, ...problem.books]) add(input.enchantments)
  add(problem.goal ?? {})
  const candidates = enchantmentsOf(edition).filter((id) => !present.has(id) && [...present].every((other) => !areExclusive(edition, id, other)))
  const pick = (): EnchantmentId => candidates[Math.floor(random() * candidates.length)]
  const level = (id: EnchantmentId): number => 1 + Math.floor(random() * maxLevelOf(id))
  const uses = (): number => (random() < 0.6 ? 0 : 1 + Math.floor(random() * 2))
  if (candidates.length === 0) return []
  const first = pick()
  const second = pick()
  const firstBook: EnchantLevels = random() < 0.5 && second !== first && !areExclusive(edition, first, second)
    ? { [first]: level(first), [second]: level(second) }
    : { [first]: level(first) }
  const books: BookInput[] = [{ enchantments: firstBook, anvilUses: uses(), ...(random() < 0.15 ? { count: 2 } : {}) }]
  if (random() < 0.5) {
    const other = pick()
    books.push({ enchantments: { [other]: level(other) }, anvilUses: uses() })
  }
  return books
}

describe.each<Edition>(['java', 'bedrock'])('books left out of the search vs the brute-force oracle (%s)', (edition) => {
  it('adding books that have no goal enchantment and share none with, nor conflict with, any other input changes no optimum', () => {
    const random = seededRandom(SEEDS[edition] + 10)
    const tally = createTally()
    const seen = new Map<string, number>()
    const note = (key: string): void => { seen.set(key, (seen.get(key) ?? 0) + 1) }
    let checked = 0
    const cases = sampleOracleCases(600, SEEDS[edition] + 10, { editions: [edition], maxInputs: 5 })
    cases.forEach(({ problem, settings }, index) => {
      if (problem.mode !== 'advanced' || problem.goal === null || !problem.useOnlyNeeded) return
      const extra = unrelatedBooks(problem, edition, random)
      if (extra.length === 0) return
      const augmented: AdvancedProblem = { ...problem, books: [...problem.books, ...extra] }
      const before = countInputs(problem)
      const after = countInputs(augmented)
      if (after > 7) return
      try {
        // The engine leaves the added books (the last input indices) out of the search
        expect(normalizeProblem(augmented, settings).excludedInputs.slice(-(after - before))).toEqual(Array.from({ length: after - before }, (_, i) => before + i))
        // The oracle enumerates the added books anyway
        crossCheckWithOracle({ problem: augmented, settings }, tally)
        // Feasibility and optimal keys match the problem without the added books
        for (const objective of OBJECTIVES) {
          const objectiveSettings = { ...settings, objective }
          const original = solveSync(problem, objectiveSettings)
          const withExtra = solveSync(augmented, objectiveSettings)
          expect(withExtra.status).toBe(original.status)
          if (original.status === 'ok' && withExtra.status === 'ok') expect(keyVectorOf(withExtra, objective)).toEqual(keyVectorOf(original, objective))
        }
        checked++
        if (problem.target === null) note('book-only')
        if (settings.rename) note('rename')
        if (settings.levelCap === null) note('no-cap')
        if (extra.some((book) => book.anvilUses > 0)) note('prior-work')
        if (extra.length > 1 || extra.some((book) => (book.count ?? 1) > 1)) note('several')
      } catch (error) {
        throw new Error(`case ${index}: ${JSON.stringify({ problem: augmented, settings })}\n${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
    })
    expect(checked).toBeGreaterThan(60)
    expect(tally.ok).toBeGreaterThan(60)
    expect(tally.infeasible).toBeGreaterThan(20)
    for (const key of ['book-only', 'rename', 'no-cap', 'prior-work', 'several']) expect(seen.get(key) ?? 0, key).toBeGreaterThanOrEqual(5)
  }, 120_000)
})
