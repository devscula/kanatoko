// Runs only with `npm run test:perf`. Timings depend on the machine, so the limits are tens of times the measured ones.
import { bruteForceSolve } from './bruteForce.ts'
import { countInputs, sampleOracleCases, type OracleCase } from './generators.ts'

function timeAll(cases: readonly OracleCase[]): { readonly totalMs: number; readonly worstMs: number } {
  let worstMs = 0
  const start = performance.now()
  for (const { problem, settings } of cases) {
    const caseStart = performance.now()
    bruteForceSolve(problem, settings)
    worstMs = Math.max(worstMs, performance.now() - caseStart)
  }
  return { totalMs: performance.now() - start, worstMs }
}

describe('oracle performance', () => {
  it('solves 200 random problems per edition (2-7 inputs) within 60 s', () => {
    const cases = [
      ...sampleOracleCases(200, 1, { editions: ['java'] }),
      ...sampleOracleCases(200, 2, { editions: ['bedrock'] }),
    ]
    const { totalMs, worstMs } = timeAll(cases)
    console.info(`oracle: 400 problems in ${totalMs.toFixed(0)} ms (slowest ${worstMs.toFixed(0)} ms)`)
    expect(totalMs).toBeLessThan(60_000)
  }, 120_000)

  it('solves 20 problems with 8 inputs and without rename within 60 s', () => {
    const cases = sampleOracleCases(20, 3, { minInputs: 8, maxInputs: 8 })
      .map(({ problem, settings }) => ({ problem, settings: { ...settings, rename: false } }))
    for (const { problem } of cases) expect(countInputs(problem)).toBe(8)
    const { totalMs, worstMs } = timeAll(cases)
    console.info(`oracle: 20 problems with 8 inputs in ${totalMs.toFixed(0)} ms (slowest ${worstMs.toFixed(0)} ms)`)
    expect(totalMs).toBeLessThan(60_000)
  }, 120_000)
})
