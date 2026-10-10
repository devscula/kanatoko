// Larger runs of oracle.integration.test.ts, only with `npm run test:perf`.

import type { Edition } from '../../data/types.ts'
import { sampleOracleCases } from '../oracle/generators.ts'
import { expensiveCaseArb, pipelineCaseArb, sample } from './generators.ts'
import { createTally, crossCheckAll } from './oracleCrossCheck.ts'

const SEEDS: Readonly<Record<Edition, number>> = { java: 0x5eed_0311, bedrock: 0x5eed_0312 }

describe.each<Edition>(['java', 'bedrock'])('solveSync vs the brute-force oracle, large sweep (%s)', (edition) => {
  it('agrees on 3 000 problems of the oracle generator x 3 objectives', () => {
    const tally = createTally()
    crossCheckAll(sampleOracleCases(3_000, SEEDS[edition], { editions: [edition] }), tally)
    expect(tally.cases).toBe(3_000)
  }, 600_000)

  it('agrees on 1 000 pipeline-shaped and 1 000 near-cap problems', () => {
    const tally = createTally()
    crossCheckAll(sample(pipelineCaseArb({ editions: [edition], maxBooks: 7 }), 1_000, SEEDS[edition] + 1), tally)
    crossCheckAll(sample(expensiveCaseArb({ editions: [edition], maxInputs: 8 }), 1_000, SEEDS[edition] + 2), tally)
    expect(tally.tooExpensive).toBeGreaterThan(200)
  }, 600_000)

  it('agrees on 40 problems with 8 inputs and no rename', () => {
    const cases = sampleOracleCases(40, SEEDS[edition] + 3, { editions: [edition], minInputs: 8, maxInputs: 8 })
      .map((testCase) => ({ ...testCase, settings: { ...testCase.settings, rename: false } }))
    const tally = createTally()
    crossCheckAll(cases, tally)
    expect(tally.cases).toBe(40)
  }, 600_000)
})
