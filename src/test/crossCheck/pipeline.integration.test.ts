// If the pipeline wrongly treats a problem as additive (for example when a book without goal enchantments could block an
// enchantment on another input), the tree-table method returns a costlier plan than forceMethod: 'exact'. Larger runs are
// in pipeline.integration.perf.test.ts.

import type { Edition } from '../../data/types.ts'
import { checkAdditive } from '../../engine/fastPath.ts'
import { normalizeProblem } from '../../engine/normalize.ts'
import { solveSync } from '../../engine/solve.ts'
import type { SolveMethod } from '../../engine/types.ts'
import type { OracleCase } from '../oracle/generators.ts'
import { additiveCaseArb, pipelineCaseArb, sample } from './generators.ts'
import { expectOk, expectPlanProperties, keyVectorOf } from './planChecks.ts'

const EDITIONS: readonly Edition[] = ['java', 'bedrock']
// Per edition
const PIPELINE_CASES = 500
const ADDITIVE_CASES = 200

const SEEDS: Readonly<Record<Edition, number>> = { java: 0x5eed_1501, bedrock: 0x5eed_1502 }

/** Returns the pipeline's method, or null when infeasible. */
export function comparePipelineWithExact({ problem, settings }: OracleCase): SolveMethod | null {
  const full = solveSync(problem, settings)
  const exact = solveSync(problem, settings, { forceMethod: 'exact', skipDiagnostics: true })
  if (full.status !== 'ok') {
    expect(full.status).toBe(exact.status)
    return null
  }
  const exactOk = expectOk(exact)
  expect(exactOk.method).toBe('exact')
  expect(keyVectorOf(full, settings.objective)).toEqual(keyVectorOf(exactOk, settings.objective))
  expectPlanProperties(full, { problem, settings })
  return full.method
}

function withCase<T>(index: number, testCase: OracleCase, check: () => T): T {
  try {
    return check()
  } catch (error) {
    throw new Error(`case ${index}: ${JSON.stringify(testCase)}\n${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

describe.each(EDITIONS)('full pipeline vs forceMethod: exact (%s)', (edition) => {
  it(`gives the same key vector on ${PIPELINE_CASES} goal problems with blocking and overlapping books`, () => {
    const cases = sample(pipelineCaseArb({ editions: [edition], maxBooks: 8 }), PIPELINE_CASES, SEEDS[edition])
    const methods = new Map<SolveMethod | null, number>()
    let blockedTreeTable = 0
    cases.forEach((testCase, index) => {
      const method = withCase(index, testCase, () => comparePipelineWithExact(testCase))
      methods.set(method, (methods.get(method) ?? 0) + 1)
      // Enough problems skip the tree-table method because a book without goal enchantments conflicts with another input
      const check = checkAdditive(normalizeProblem(testCase.problem, testCase.settings), testCase.settings)
      if (!check.eligible && check.because === 'conflict') blockedTreeTable++
    })
    expect(methods.get('tree-table') ?? 0).toBeGreaterThan(40)
    expect(methods.get('exact') ?? 0).toBeGreaterThan(200)
    expect(blockedTreeTable).toBeGreaterThan(40)
  }, 120_000)
})

describe.each(EDITIONS)('tree-table vs exact on additive problems (%s)', (edition) => {
  it(`gives the same key vector on ${ADDITIVE_CASES} real-data problems with 1-10 books`, () => {
    const cases = sample(additiveCaseArb({ editions: [edition], minBooks: 1, maxBooks: 10 }), ADDITIVE_CASES, SEEDS[edition] + 1)
    let treeTable = 0
    let trivial = 0
    cases.forEach((testCase, index) => {
      withCase(index, testCase, () => {
        const np = normalizeProblem(testCase.problem, testCase.settings)
        expect(checkAdditive(np, testCase.settings)).toMatchObject({ eligible: true })
        const full = expectOk(solveSync(testCase.problem, testCase.settings))
        // Some problems, such as books only with a single book that meets the goal, get a trivial plan before any search
        if (full.method === 'trivial') trivial++
        else expect(full.stats.fastPath?.eligible).toBe(true)
        if (full.method === 'tree-table') treeTable++
        const exact = expectOk(solveSync(testCase.problem, testCase.settings, { forceMethod: 'exact', skipDiagnostics: true }))
        expect(keyVectorOf(full, 'levels')).toEqual(keyVectorOf(exact, 'levels'))
        expectPlanProperties(full, testCase)
      })
    })
    // Problems whose tie-break does not finish within budget (such as 10 books only) go to the exact search, but most are
    // solved by the tree-table method
    expect(treeTable).toBeGreaterThan((ADDITIVE_CASES - trivial) * 0.8)
  }, 120_000)
})
