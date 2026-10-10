import type { ClientResult, ComplexityEstimate, Problem, Settings, SolverClient, Suggestion } from '../../engine/index.ts'
import type { Text } from '../i18n/text.ts'
import type { BuiltProblem } from '../state/buildProblem.ts'
import type { EmptyReason, InputState } from '../state/types.ts'

/** See defaultBackend in useSolveResult.ts for when the placeholder backend is used. */
export interface SolverBackend {
  readonly client: SolverClient
  /** Runs on the main thread */
  estimateComplexity(problem: Problem, settings: Settings): ComplexityEstimate
}

export type SolveOutcome =
  | { readonly kind: 'empty'; readonly reason: EmptyReason }
  | {
      readonly kind: 'result'
      readonly result: Exclude<ClientResult, { readonly status: 'cancelled' }>
      /**
       * The problem that produced result. After a successful fallback solve this is the fallback problem, and
       * built.fallback lists the enchantments that got new books.
       */
      readonly built: BuiltProblem
      /** The first problem, when the fallback solve produced this result */
      readonly firstBuilt: BuiltProblem | null
      readonly input: InputState
      /** Copied from built */
      readonly problem: Problem
      readonly settings: Settings
      readonly planId: string
    }

/**
 * Progress changes often, so it is not part of this view and is read with useSolveProgress(), which keeps components
 * that read SolveView from re-rendering on every progress event.
 */
export interface SolveView {
  /** Null until the first calculation finishes, then keeps the previous result while a new one is calculating */
  readonly outcome: SolveOutcome | null
  /** Includes the debounce */
  readonly pending: boolean
  /** The request has run for STALE_MS, so the shown result is outdated */
  readonly stale: boolean
  /** The request has run for SLOW_MS */
  readonly slow: boolean
  readonly slowPredicted: boolean
  readonly cancelled: boolean
  /** Consecutive failures for the same input */
  readonly failures: number
  readonly estimate: ComplexityEstimate | null
  /**
   * Lower-a-level suggestions found by re-solving an infeasible advanced problem; null for other results. complete is
   * false when some candidates were skipped, like the engine's suggestionsComplete.
   */
  readonly extraSuggestions?: ExtraSuggestions | null
  /** Announce text again whenever seq changes, even if it is the same text */
  readonly announcement: { readonly text: Text; readonly seq: number } | null
}

export interface SolveActions {
  cancel(): void
  retry(): void
}

export interface ExtraSuggestions {
  /** Only used while it matches the current result's planId */
  readonly planId: string
  readonly checking: boolean
  readonly complete: boolean
  readonly items: readonly Extract<Suggestion, { readonly code: 'lower-goal-level' }>[]
}
