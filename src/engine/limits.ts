export const LIMITS = {
  maxAnvilUses: 10,                   // input anvil uses (PWP up to 1023)
  maxStackCount: 32,                  // BookStack.count / BookInput.count
  fastPathMaxBooks: 24,               // more used books than this skip the tree-table method
  tieBreakMaxEvaluations: 20_000,     // plans the tree-table tie-break may evaluate before it is marked partial
  exactComplexitySoft: 200_000,       // C_eff above: warning 'slow-search' (seconds on phones)
  exactComplexityHard: 1_200_000,     // C_eff above, with goal + useOnlyNeeded: 'too-complex' without searching
  exactComplexityHardUseAll: 360_000, // C_eff above, when every input is used: 'too-complex' without searching
  exactMaxDistinctEnchantments: 30,   // enchantment universe of one problem (bit masks)
  exactMaxStates: 150_000,            // abort -> 'too-complex' (cause 'state-limit')
  exactTimeBudgetMs: 30_000,          // abort -> 'too-complex' (cause 'time-limit'), also the projected-time abort
  projectionMinFraction: 0.1,         // projected-time abort is checked from this fraction of C onwards
  sliceMs: 16,                        // worker yield interval
  progressIntervalMs: 100,
  diagnosticsBudgetMs: 1_500,         // failure diagnostics, suggestions and the keep alternative together
  suggestionMaxComplexity: 60_000,    // re-solves for suggestions and the keep alternative only below this
  clientHardStopMs: 1_000,            // a worker that has not acknowledged a cancel by then is terminated
  clientWatchdogMarginMs: 5_000,      // added to the search and diagnostics budgets before the client gives up on a request
} as const satisfies Record<string, number>

/** LIMITS widened to number: overrides typed as Partial<typeof LIMITS> could only repeat the literal values. */
export type Limits = { readonly [K in keyof typeof LIMITS]: number }
