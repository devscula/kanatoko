// Larger runs of pipeline.integration.test.ts, only with `npm run test:perf`.

import type { Edition } from '../../data/types.ts'
import { checkAdditive } from '../../engine/fastPath.ts'
import { normalizeProblem } from '../../engine/normalize.ts'
import { solveSync } from '../../engine/solve.ts'
import { additiveCaseArb, pipelineCaseArb, sample } from './generators.ts'
import { expectOk, expectPlanProperties, keyVectorOf } from './planChecks.ts'

const SEEDS: Readonly<Record<Edition, number>> = { java: 0x5eed_1511, bedrock: 0x5eed_1512 }

describe.each<Edition>(['java', 'bedrock'])('method choice, large sweep (%s)', (edition) => {
  it('gives the same keys as forceMethod: exact on 3 000 goal problems with up to 10 books', () => {
    const cases = sample(pipelineCaseArb({ editions: [edition], maxBooks: 10 }), 3_000, SEEDS[edition])
    cases.forEach((testCase, index) => {
      const full = solveSync(testCase.problem, testCase.settings)
      const exact = solveSync(testCase.problem, testCase.settings, { forceMethod: 'exact', skipDiagnostics: true })
      const context = `case ${index}: ${JSON.stringify(testCase)}`
      expect(exact.status, context).toBe(full.status)
      if (full.status !== 'ok' || exact.status !== 'ok') return
      expect(keyVectorOf(full, testCase.settings.objective), context).toEqual(keyVectorOf(exact, testCase.settings.objective))
      expectPlanProperties(full, testCase)
    })
  }, 600_000)

  it('gives the same keys with the tree-table method as with the exact search on 1 000 additive problems with 1-10 books', () => {
    const cases = sample(additiveCaseArb({ editions: [edition], minBooks: 1, maxBooks: 10 }), 1_000, SEEDS[edition] + 1)
    cases.forEach((testCase, index) => {
      const context = `case ${index}: ${JSON.stringify(testCase)}`
      expect(checkAdditive(normalizeProblem(testCase.problem, testCase.settings), testCase.settings).eligible, context).toBe(true)
      const full = expectOk(solveSync(testCase.problem, testCase.settings))
      const exact = expectOk(solveSync(testCase.problem, testCase.settings, { forceMethod: 'exact', skipDiagnostics: true }))
      expect(keyVectorOf(full, 'levels'), context).toEqual(keyVectorOf(exact, 'levels'))
    })
  }, 600_000)
})
