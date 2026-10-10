import { LIMITS, type Limits } from './limits.ts'
import { OBJECTIVE_KEYS, type Objective, type PlanKeyName, type SolveOptions } from './types.ts'

describe('LIMITS', () => {
  it('keeps the tuned values', () => {
    expect(LIMITS).toEqual({
      maxAnvilUses: 10,
      maxStackCount: 32,
      fastPathMaxBooks: 24,
      tieBreakMaxEvaluations: 20_000,
      exactComplexitySoft: 200_000,
      exactComplexityHard: 1_200_000,
      exactComplexityHardUseAll: 360_000,
      exactMaxDistinctEnchantments: 30,
      exactMaxStates: 150_000,
      exactTimeBudgetMs: 30_000,
      projectionMinFraction: 0.1,
      sliceMs: 16,
      progressIntervalMs: 100,
      diagnosticsBudgetMs: 1_500,
      suggestionMaxComplexity: 60_000,
      clientHardStopMs: 1_000,
      clientWatchdogMarginMs: 5_000,
    })
  })

  it('gives the client watchdog 36.5 s', () => {
    expect(LIMITS.exactTimeBudgetMs + LIMITS.diagnosticsBudgetMs + LIMITS.clientWatchdogMarginMs).toBe(36_500)
  })

  it('orders the complexity limits soft < use-all hard < hard', () => {
    expect(LIMITS.exactComplexitySoft).toBeLessThan(LIMITS.exactComplexityHardUseAll)
    expect(LIMITS.exactComplexityHardUseAll).toBeLessThan(LIMITS.exactComplexityHard)
  })

  it('lets options override any limit with an arbitrary number, not only its literal type', () => {
    const options: SolveOptions = { limits: { exactMaxStates: 1_000, exactTimeBudgetMs: 5 } }
    const merged: Limits = { ...LIMITS, ...options.limits }
    expect(merged.exactMaxStates).toBe(1_000)
    expectTypeOf<Limits['exactMaxStates']>().toEqualTypeOf<number>()
    expectTypeOf<(typeof LIMITS)['exactMaxStates']>().toEqualTypeOf<150_000>()
  })
})

describe('OBJECTIVE_KEYS', () => {
  it('lists every key exactly once for each objective, with inputs used last', () => {
    const all: PlanKeyName[] = ['totalLevels', 'maxStepLevels', 'xpPoints', 'finalPriorWorkPenalty', 'inputsUsed']
    for (const objective of ['levels', 'xp', 'finalPwp'] as const satisfies readonly Objective[]) {
      const keys = OBJECTIVE_KEYS[objective]
      expect(new Set(keys)).toEqual(new Set(all))
      expect(keys).toHaveLength(all.length)
      expect(keys[4]).toBe('inputsUsed')
    }
  })

  it('puts the objective first, then total levels, max step cost, XP points and final PWP', () => {
    expect(OBJECTIVE_KEYS.levels).toEqual(['totalLevels', 'maxStepLevels', 'xpPoints', 'finalPriorWorkPenalty', 'inputsUsed'])
    expect(OBJECTIVE_KEYS.xp).toEqual(['xpPoints', 'totalLevels', 'maxStepLevels', 'finalPriorWorkPenalty', 'inputsUsed'])
    expect(OBJECTIVE_KEYS.finalPwp).toEqual(['finalPriorWorkPenalty', 'totalLevels', 'maxStepLevels', 'xpPoints', 'inputsUsed'])
  })
})
