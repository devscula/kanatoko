import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Edition } from '../../data/types.ts'
import type { Text } from '../i18n/text.ts'
import { buildProblem, type BuiltProblem, canFallback } from './buildProblem.ts'
import type { ShareState } from './slices/share.ts'
import { type AppState, useAppStore } from './store.ts'
import type { EmptyReason, InputState, SessionState } from './types.ts'

export type SolveInput =
  | { readonly kind: 'empty'; readonly reason: EmptyReason }
  | {
      readonly kind: 'ready'
      readonly built: BuiltProblem
      /** For the retry after an infeasible result; null when it could not help (see canFallback) */
      readonly fallback: BuiltProblem | null
      readonly input: InputState
      /** Shortcuts to fields of built */
      readonly problem: BuiltProblem['problem']
      readonly settings: BuiltProblem['settings']
      readonly planId: string
    }

export interface SolveSource {
  readonly input: InputState
  readonly session: SessionState
  readonly share: ShareState
}

/** The shared plan's input and settings while one is shown */
export function shownInputOf(source: SolveSource): { readonly input: InputState; readonly session: SessionState } {
  const { share } = source
  if (share.active && share.plan !== null) {
    const { input, settings } = share.plan
    return { input, session: { edition: settings.edition, levelCap: settings.levelCap, objective: settings.objective } }
  }
  return { input: source.input, session: source.session }
}

export function solveInputFrom(input: InputState, session: SessionState): SolveInput {
  if (input.item === null) return { kind: 'empty', reason: 'noItem' }
  const built = buildProblem(input, session)
  if (built === null) return { kind: 'empty', reason: 'noEnchantments' }
  const fallback = canFallback(built) ? buildProblem(input, session, { fallback: true }) : null
  return { kind: 'ready', built, fallback, input, problem: built.problem, settings: built.settings, planId: built.planId }
}

export function solveInputOf(source: SolveSource): SolveInput {
  const { input, session } = shownInputOf(source)
  return solveInputFrom(input, session)
}

/** Returns a new object every time, so compare it with useShallow. */
export const pickSource = (s: AppState): SolveSource => ({ input: s.input, session: s.session, share: s.share })

export function useSolveInput(): SolveInput {
  const source = useAppStore(useShallow(pickSource))
  return useMemo(() => solveInputOf(source), [source])
}

export function selectActiveEdition(state: AppState): Edition {
  return state.share.active && state.share.plan ? state.share.plan.settings.edition : state.session.edition
}

export function selectReadOnly(state: AppState): boolean {
  return state.share.active
}

export function selectUndoLabel(state: AppState): Text | null {
  return state.history.past.at(-1)?.label ?? null
}

export function selectRedoLabel(state: AppState): Text | null {
  return state.history.future.at(-1)?.label ?? null
}
