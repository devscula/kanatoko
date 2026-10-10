// Runs only with `npm run test:perf`. Wall-clock budgets are about 3x the times measured on a fast desktop, to allow for
// slow CI runners; the work-counter budgets are in each search's own perf tests.

import { estimateComplexity } from './complexity.ts'
import { createSolveTask, solveSync } from './solve.ts'
import type { AdvancedProblem, BookInput, EnchantLevels, Problem, Settings, SolveOptions } from './types.ts'

const JAVA: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
const books = (...levels: EnchantLevels[]): BookInput[] => levels.map((enchantments) => ({ enchantments, anvilUses: 0 }))
const BOOTS_WITH_MAX_BOOKS: AdvancedProblem = {
  mode: 'advanced',
  target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
  extraItems: [],
  books: books({ soul_speed: 3 }, { thorns: 3 }, { feather_falling: 4 }, { depth_strider: 3 }, { protection: 4 }, { unbreaking: 3 }, { mending: 1 }),
  goal: null,
  useOnlyNeeded: true,
}

function fastest(runs: number, action: () => void): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    action()
    best = Math.min(best, performance.now() - start)
  }
  return best
}

function sliced(problem: Problem, settings: Settings, options?: SolveOptions): { longestSliceMs: number; totalMs: number; slices: number } {
  const task = createSolveTask(problem, settings, options)
  let longestSliceMs = 0
  let totalMs = 0
  let slices = 0
  for (;;) {
    const start = performance.now()
    const done = task.run(16)
    const ms = performance.now() - start
    longestSliceMs = Math.max(longestSliceMs, ms)
    totalMs += ms
    slices++
    if (done) break
  }
  return { longestSliceMs, totalMs, slices }
}

const SWORD_BOOKS = books(
  { sharpness: 1, unbreaking: 1 }, { sharpness: 2, looting: 1 }, { unbreaking: 2, fire_aspect: 1 }, { looting: 2, knockback: 1 },
  { sharpness: 3 }, { fire_aspect: 2, mending: 1 }, { knockback: 2, sweeping_edge: 1 }, { sweeping_edge: 2, unbreaking: 1 },
  { looting: 1, sharpness: 1 }, { smite: 2 }, { bane_of_arthropods: 1, unbreaking: 3 }, { sweeping_edge: 3, looting: 3 },
)

describe('pipeline time budgets', () => {
  it('rejects target + 12 multi-enchantment books, use all, no cap, without searching (≤ 5 ms)', () => {
    const problem: AdvancedProblem = { ...BOOTS_WITH_MAX_BOOKS, target: { itemType: 'sword', enchantments: {}, anvilUses: 0 }, books: SWORD_BOOKS }
    const settings: Settings = { ...JAVA, levelCap: null }
    expect(estimateComplexity(problem, settings).level).toBe('too-complex')
    expect(solveSync(problem, settings)).toMatchObject({ status: 'too-complex', cause: 'complexity-limit', stats: { exact: null } })
    expect(fastest(5, () => solveSync(problem, settings))).toBeLessThan(5)
  })

  it('solves boots + 7 max books end to end with warm tables (≤ 10 ms) and estimates it (≤ 2 ms)', () => {
    solveSync(BOOTS_WITH_MAX_BOOKS, JAVA)
    expect(fastest(5, () => solveSync(BOOTS_WITH_MAX_BOOKS, JAVA))).toBeLessThan(10)
    expect(fastest(5, () => estimateComplexity(BOOTS_WITH_MAX_BOOKS, JAVA))).toBeLessThan(2)
  })

  it('runs an exact search with C ≤ 40 000 through the pipeline (≤ 150 ms)', () => {
    const problem: AdvancedProblem = { ...BOOTS_WITH_MAX_BOOKS, target: { itemType: 'sword', enchantments: {}, anvilUses: 0 }, books: SWORD_BOOKS.slice(0, 9) }
    const result = solveSync(problem, JAVA)
    expect(result.status === 'ok' && result.method).toBe('exact')
    expect(fastest(3, () => solveSync(problem, JAVA))).toBeLessThan(150)
  })
})

describe('slices stay short', () => {
  it('yields about every sliceMs during a long exact search', () => {
    // Target + 11 books, every input used, cap 39: 0.36-2.9 s on a fast desktop.
    const problem: AdvancedProblem = { ...BOOTS_WITH_MAX_BOOKS, target: { itemType: 'sword', enchantments: {}, anvilUses: 0 }, books: SWORD_BOOKS.slice(0, 11) }
    const run = sliced(problem, JAVA)
    expect(run.slices).toBeGreaterThan(10)
    // The clock is read every 512 pairs, so a slice runs slightly over; this is still short enough on slow CI for the worker
    // to receive a cancel.
    expect(run.longestSliceMs).toBeLessThan(16 + 60)
  })

  it('slices the diagnostics re-solves too', () => {
    // No goal and every input used: infeasible at cap 39, so diagnostics re-solve without the cap (exact search) and run the
    // binary search over caps.
    const problem: AdvancedProblem = { ...BOOTS_WITH_MAX_BOOKS, target: { itemType: 'sword', enchantments: {}, anvilUses: 5 }, books: SWORD_BOOKS.slice(0, 10) }
    const result = solveSync(problem, JAVA)
    expect(result.status).toBe('infeasible')
    const run = sliced(problem, JAVA)
    expect(run.slices).toBeGreaterThan(10)
    expect(run.longestSliceMs).toBeLessThan(16 + 60)
  })
})
