import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Edition } from '../../../data/types.ts'
import { buildProblem, type BuiltProblem } from '../../state/buildProblem.ts'
import { shownInputOf } from '../../state/selectors.ts'
import { useAppStore } from '../../state/store.ts'
import type { InputState, SessionState } from '../../state/types.ts'
import { useReadOnly } from '../shell/readOnly.ts'

export interface InputView {
  readonly input: InputState
  readonly session: SessionState
  /** Edition for names and candidates; the shared plan's edition while one is shown. */
  readonly edition: Edition
  readonly levelCap: 39 | null
  /** null when nothing is wanted. */
  readonly built: BuiltProblem | null
  /** A shared plan is shown. Controls stay enabled; using one should call redirect instead of changing the input. */
  readonly readOnly: boolean
  readonly redirect: () => void
}

export function useInputView(): InputView {
  const source = useAppStore(useShallow((s) => ({ input: s.input, session: s.session, share: s.share })))
  const { readOnly, redirect } = useReadOnly()
  const shown = useMemo(() => shownInputOf(source), [source])
  const built = useMemo(() => buildProblem(shown.input, shown.session), [shown])
  return {
    input: shown.input,
    session: shown.session,
    edition: shown.session.edition,
    levelCap: shown.session.levelCap,
    built,
    readOnly,
    redirect,
  }
}
