import { useStore } from 'zustand'
import { createStore, type StateCreator, type StoreApi } from 'zustand/vanilla'
import { createHistorySlice, type HistorySlice } from './slices/history.ts'
import { createInputSlice, type InputSlice } from './slices/input.ts'
import { createPrefsSlice, type PrefsSlice } from './slices/prefs.ts'
import { createSessionSlice, type SessionSlice } from './slices/session.ts'
import { createShareSlice, type ShareSlice } from './slices/share.ts'
import { createSystemSlice, type SystemSlice } from './slices/system.ts'
import { createToastSlice, type ToastSlice } from './slices/toast.ts'
import { createUiSlice, type UiSlice } from './slices/ui.ts'
import { type SafeStorage, wrapStorage } from './storage.ts'

export type AppState = InputSlice &
  SessionSlice &
  PrefsSlice &
  HistorySlice &
  ShareSlice &
  ToastSlice &
  SystemSlice &
  UiSlice

export type SliceCreator<T> = StateCreator<AppState, [], [], T>

export interface StoreDeps {
  readonly storage: SafeStorage
}

export type InitialState = Partial<Pick<AppState, 'input' | 'session' | 'prefs' | 'system' | 'share' | 'ui'>>

export function createAppStore(deps: StoreDeps = { storage: wrapStorage(null) }, initial: InitialState = {}): StoreApi<AppState> {
  return createStore<AppState>()((...a) => ({
    ...createInputSlice(...a),
    ...createSessionSlice(...a),
    ...createPrefsSlice(...a),
    ...createHistorySlice(...a),
    ...createShareSlice(...a),
    ...createToastSlice(...a),
    ...createSystemSlice(deps)(...a),
    ...createUiSlice(...a),
    ...initial,
  }))
}

let activeStore: StoreApi<AppState> = createAppStore()

/** main.tsx and tests replace it with setAppStore. */
export function getAppStore(): StoreApi<AppState> {
  return activeStore
}

export function setAppStore(store: StoreApi<AppState>): void {
  activeStore = store
}

/** A selector that returns a new object on every call re-renders forever; wrap it in useShallow or read values separately. */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(activeStore, selector)
}
