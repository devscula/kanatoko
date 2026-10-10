import type { Text } from '../../i18n/text.ts'
import type { AppState, SliceCreator } from '../store.ts'
import type { InputDoc } from '../types.ts'

export const HISTORY_LIMIT = 50

export interface HistoryEntry {
  readonly label: Text
  readonly before: InputDoc
  readonly after: InputDoc
}

export interface HistorySlice {
  readonly history: { readonly past: readonly HistoryEntry[]; readonly future: readonly HistoryEntry[] }
  /**
   * change returns the parts to replace, or null to do nothing. Returns false without recording while a shared plan
   * is shown or when nothing changed.
   */
  commit(label: Text, change: (state: AppState) => Partial<InputDoc> | null): boolean
  undo(): boolean
  redo(): boolean
}

export function selectDoc(state: AppState): InputDoc {
  return { input: state.input, session: state.session }
}

function sameDoc(a: InputDoc, b: InputDoc): boolean {
  return a.input === b.input && a.session === b.session
}

export const createHistorySlice: SliceCreator<HistorySlice> = (set, get) => ({
  history: { past: [], future: [] },

  commit(label, change) {
    const state = get()
    if (state.share.active) return false
    const patch = change(state)
    if (patch === null) return false
    const before = selectDoc(state)
    const after: InputDoc = {
      input: patch.input ?? before.input,
      session: patch.session ?? before.session,
    }
    if (sameDoc(before, after)) return false
    const past = [...state.history.past, { label, before, after }].slice(-HISTORY_LIMIT)
    set({ ...after, history: { past, future: [] } })
    return true
  },

  undo() {
    const state = get()
    const entry = state.history.past.at(-1)
    if (entry === undefined || state.share.active) return false
    set({
      input: entry.before.input,
      session: entry.before.session,
      history: { past: state.history.past.slice(0, -1), future: [...state.history.future, entry] },
    })
    return true
  },

  redo() {
    const state = get()
    const entry = state.history.future.at(-1)
    if (entry === undefined || state.share.active) return false
    set({
      input: entry.after.input,
      session: entry.after.session,
      history: { past: [...state.history.past, entry], future: state.history.future.slice(0, -1) },
    })
    return true
  },
})
