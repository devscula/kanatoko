import type { StoreApi } from 'zustand/vanilla'
import type { AppState } from '../../state/store.ts'
import { startHashSync, type HashSyncOptions } from '../../url/hashSync.ts'
import { ShareSheet } from './ShareSheet.tsx'

export { ShareActions } from './ShareActions.tsx'
// oxlint-disable-next-line react/only-export-components
export { formatPlanAsText } from './sharing.ts'

export function ShareRoot() {
  return <ShareSheet />
}

// Not a component, but it lives here so the feature has a single entry file
// oxlint-disable-next-line react/only-export-components
export function initShare(store: StoreApi<AppState>, options?: HashSyncOptions): () => void {
  return startHashSync(store, options)
}
