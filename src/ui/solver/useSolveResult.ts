import { useRef, useSyncExternalStore } from 'react'
import type { StoreApi } from 'zustand/vanilla'
import { pickSource, solveInputOf, type SolveSource } from '../state/selectors.ts'
import { type AppState, getAppStore } from '../state/store.ts'
import { SolveController } from './controller.ts'
import { createEngineBackend } from './engineBackend.ts'
import { createPlaceholderBackend, placeholderOptionsFromSearch } from './placeholderBackend.ts'
import type { SolveActions, SolverBackend, SolveView } from './types.ts'

const sameSource = (a: SolveSource, b: SolveSource) => a.input === b.input && a.session === b.session && a.share === b.share

/** Call controller.dispose() to stop. */
export function connectSolver(store: StoreApi<AppState>, backend: SolverBackend): SolveController {
  const controller = new SolveController({ backend, announceAssist: (text) => store.getState().announce(text) })
  let source = pickSource(store.getState())
  controller.setInput(solveInputOf(source))
  const unsubscribe = store.subscribe((state) => {
    const next = pickSource(state)
    if (sameSource(next, source)) return
    source = next
    controller.setInput(solveInputOf(next))
  })
  controller.onDispose(unsubscribe)
  controller.onDispose(() => backend.client.dispose())
  return controller
}

// Tests get the placeholder because jsdom has no Worker. Dev builds switch to it with ?fixture= or ?delay= in the URL.
// The placeholder branches drop out of production builds because import.meta.env is replaced with constants.
export function defaultBackend(): SolverBackend {
  if (import.meta.env.MODE === 'test') return createPlaceholderBackend()
  if (import.meta.env.DEV && typeof location !== 'undefined') {
    const options = placeholderOptionsFromSearch(location.search)
    if (options !== null) return createPlaceholderBackend(options)
  }
  return createEngineBackend()
}

let active: SolveController | null = null

export function startSolver(store: StoreApi<AppState> = getAppStore(), backend: SolverBackend = defaultBackend()): SolveController {
  active?.dispose()
  active = connectSolver(store, backend)
  return active
}

export function getSolveController(): SolveController {
  active ??= connectSolver(getAppStore(), defaultBackend())
  return active
}

/** For tests: the next read starts a new solver. */
export function stopSolver(): void {
  active?.dispose()
  active = null
}

/** Re-renders whenever any field of the view changes. */
export function useSolveResult(): SolveView & SolveActions {
  const controller = getSolveController()
  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView)
  return { ...view, cancel: controller.cancel, retry: controller.retry }
}

/**
 * Re-renders only when one of the given fields changes. A single input change updates the view 5 or 6 times, and most
 * components need only a few fields.
 */
export function useSolveFields<K extends keyof SolveView>(keys: readonly K[]): Pick<SolveView, K> & SolveActions {
  const controller = getSolveController()
  const cache = useRef<{ readonly controller: SolveController; readonly values: readonly unknown[]; readonly view: Pick<SolveView, K> & SolveActions } | null>(null)
  const snapshot = (): Pick<SolveView, K> & SolveActions => {
    const view = controller.getView()
    const values = keys.map((key) => view[key])
    const previous = cache.current
    if (previous !== null && previous.controller === controller && previous.values.length === values.length && previous.values.every((value, i) => Object.is(value, values[i]))) {
      return previous.view
    }
    const picked = Object.fromEntries(keys.map((key) => [key, view[key]])) as Pick<SolveView, K>
    const next = { ...picked, cancel: controller.cancel, retry: controller.retry }
    cache.current = { controller, values, view: next }
    return next
  }
  return useSyncExternalStore(controller.subscribe, snapshot, snapshot)
}

/** select must return a field as is: building a new object on every call re-renders forever. */
export function useSolveView<T>(select: (view: SolveView) => T): T {
  const controller = getSolveController()
  const snapshot = () => select(controller.getView())
  return useSyncExternalStore(controller.subscribe, snapshot, snapshot)
}

/** 0 to 1, or null when unknown or idle */
export function useSolveProgress(): number | null {
  const controller = getSolveController()
  return useSyncExternalStore(controller.subscribeProgress, controller.getProgress, controller.getProgress)
}
