import type { StoreApi } from 'zustand/vanilla'
import { parseInputState, parseJson, parsePrefs, parseSession } from './parse.ts'
import { hasBackup, STORAGE_KEYS, storedInput, writeJson } from './persistIo.ts'
import { DEFAULT_SYSTEM } from './slices/system.ts'
import { probeStorage, type SafeStorage } from './storage.ts'
import type { AppState, InitialState } from './store.ts'

export interface LoadedState {
  readonly initial: InitialState
  readonly corrupt: boolean
  /** IDs not in the current data */
  readonly dropped: readonly string[]
  readonly available: boolean
}

type ReadResult<T> = { readonly kind: 'absent' } | { readonly kind: 'corrupt' } | { readonly kind: 'ok'; readonly value: T }

// An unreadable value is deleted, or its banner would come back on every visit.
function readInput<T>(storage: SafeStorage, key: string, parse: (raw: unknown) => T | null): ReadResult<T> {
  const text = storage.read(key)
  if (text === null) return { kind: 'absent' }
  const value = parse(parseJson(text))
  if (value !== null) return { kind: 'ok', value }
  storage.remove(key)
  return { kind: 'corrupt' }
}

function readSettings<T>(storage: SafeStorage, key: string, parse: (raw: unknown) => T): T | undefined {
  const text = storage.read(key)
  if (text === null) return undefined
  const value = parse(parseJson(text))
  if (JSON.stringify(value) !== text) writeJson(storage, key, value)
  return value
}

/** A share link in the URL hash is handled separately, by url/hashSync.ts. */
export function loadInitialState(storage: SafeStorage): LoadedState {
  const available = probeStorage(storage)
  const dropped: string[] = []
  const input = readInput(storage, STORAGE_KEYS.input, (raw) => parseInputState(raw, dropped))
  const session = readSettings(storage, STORAGE_KEYS.session, parseSession)
  const prefs = readSettings(storage, STORAGE_KEYS.prefs, parsePrefs)
  const corrupt = input.kind === 'corrupt'
  const uniqueDropped = [...new Set(dropped)]

  const initial: InitialState = {
    ...(input.kind === 'ok' ? { input: input.value } : {}),
    ...(session !== undefined ? { session } : {}),
    ...(prefs !== undefined ? { prefs } : {}),
    system: {
      ...DEFAULT_SYSTEM,
      storageAvailable: available,
      storageBannerShown: !available,
      hasBackup: available && hasBackup(storage),
      banners: {
        ...DEFAULT_SYSTEM.banners,
        linkUnreadable: false,
        dataDropped: uniqueDropped.length > 0 ? uniqueDropped : null,
        storageUnavailable: !available,
        storageCorrupt: corrupt,
      },
    },
  }
  return { initial, corrupt, dropped: uniqueDropped, available }
}

export interface PersistenceOptions {
  readonly debounceMs?: number
}

export const INPUT_DEBOUNCE_MS = 300

/** Returns a function that flushes pending writes and stops. */
export function startPersistence(store: StoreApi<AppState>, storage: SafeStorage, options: PersistenceOptions = {}): () => void {
  const debounceMs = options.debounceMs ?? INPUT_DEBOUNCE_MS
  const pending = new Map<string, ReturnType<typeof setTimeout>>()

  const write = (key: string, value: unknown) => {
    if (!writeJson(storage, key, value)) store.getState().reportStorageFailure()
  }

  const writers: Record<'input', () => void> = {
    input: () => write(STORAGE_KEYS.input, storedInput(store.getState().input)),
  }

  const schedule = (name: 'input') => {
    const existing = pending.get(name)
    if (existing !== undefined) clearTimeout(existing)
    pending.set(
      name,
      setTimeout(() => {
        pending.delete(name)
        writers[name]()
      }, debounceMs),
    )
  }

  const flush = () => {
    for (const [name, timer] of pending) {
      clearTimeout(timer)
      writers[name as 'input']()
    }
    pending.clear()
  }

  const unsubscribe = store.subscribe((state, prev) => {
    if (state.input !== prev.input) schedule('input')
    if (state.session !== prev.session) write(STORAGE_KEYS.session, state.session)
    if (state.prefs !== prev.prefs) write(STORAGE_KEYS.prefs, state.prefs)
  })

  const onHide = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  const hasWindow = typeof window !== 'undefined'
  if (hasWindow) {
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
  }

  return () => {
    flush()
    unsubscribe()
    if (hasWindow) {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }
}
