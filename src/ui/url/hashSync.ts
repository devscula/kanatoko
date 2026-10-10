import type { StoreApi } from 'zustand/vanilla'
import type { AppState } from '../state/store.ts'
import { supportsDeflateRaw } from './compression.ts'
import { isOwnInputEmpty, matchesOwnInput, ownLinkOf } from './links.ts'
import { canonicalHash, encodeShareHash, isShareHash, readShareHash } from './shareHash.ts'

export const HASH_DEBOUNCE_MS = 300

// Marks history entries written for the user's input; the value is the canonical hash. Only Back or Forward to a marked
// entry counts as returning to the user's input. A link the user pastes or clicks creates a new, unmarked entry and is
// read as a shared link, even if this page once wrote the same hash.
const OWN_ENTRY_MARK = 'kanatokoOwnHash'

/** Replaced in tests */
export interface HashEnv {
  /** Includes the leading #, or is '' */
  read(): string
  /** Replaces the hash without adding a history entry ('' clears it). own sets or removes the mark on the entry. */
  replace(hash: string, own: boolean): void
  /** Whether the current history entry carries the mark for this canonical hash */
  isOwnEntry(hash: string): boolean
  listen(listener: () => void): () => void
  /** Whether d=z. (compressed) can be written */
  readonly compress: boolean
}

function stateWithOwnMark(current: unknown, own: string | null): unknown {
  const isObject = typeof current === 'object' && current !== null
  if (!isObject && own === null) return current ?? null
  const next: Record<string, unknown> = isObject ? { ...(current as Record<string, unknown>) } : {}
  delete next[OWN_ENTRY_MARK]
  if (own !== null) next[OWN_ENTRY_MARK] = own
  return next
}

export function browserHashEnv(): HashEnv {
  return {
    read: () => window.location.hash,
    replace: (hash, own) => {
      const { pathname, search } = window.location
      try {
        window.history.replaceState(stateWithOwnMark(window.history.state, own ? canonicalHash(hash) : null), '', `${pathname}${search}${hash}`)
      } catch {
        // Some embedding frames forbid rewriting the URL. The hash just goes stale and the page keeps working
      }
    },
    isOwnEntry: (hash) => {
      const state: unknown = window.history.state
      return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[OWN_ENTRY_MARK] === hash
    },
    listen: (listener) => {
      window.addEventListener('hashchange', listener)
      return () => window.removeEventListener('hashchange', listener)
    },
    compress: supportsDeflateRaw(),
  }
}

export interface HashSyncOptions {
  readonly env?: HashEnv
  readonly debounceMs?: number
}

/** The user's input is written with replaceState, so editing adds no history entries. */
export function startHashSync(store: StoreApi<AppState>, options: HashSyncOptions = {}): () => void {
  const env = options.env ?? browserHashEnv()
  const debounceMs = options.debounceMs ?? HASH_DEBOUNCE_MS
  // The canonical hash we last wrote or read, to tell user changes apart from our own writes
  let known = canonicalHash(env.read())
  let timer: ReturnType<typeof setTimeout> | null = null
  // Drops writes whose input changed while compression was pending
  let writeSeq = 0
  let stopped = false

  const cancelPending = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    writeSeq++
  }

  const put = (hash: string, own: boolean) => {
    known = hash
    if (hash !== env.read() || env.isOwnEntry(hash) !== own) env.replace(hash, own)
  }

  // Compression is async, so the write is skipped if a shared plan is shown by then
  const writeOwn = async () => {
    cancelPending()
    const seq = writeSeq
    const link = ownLinkOf(store.getState())
    const hash = link === null ? '' : await encodeShareHash(link, { compress: env.compress })
    if (stopped || seq !== writeSeq || store.getState().share.active) return
    put(hash, hash !== '')
  }

  const schedule = () => {
    cancelPending()
    timer = setTimeout(() => {
      timer = null
      void writeOwn()
    }, debounceMs)
  }

  // Puts back the hash of what is shown, after an unreadable link or an in-page anchor
  const restore = () => {
    const { share } = store.getState()
    if (share.active && share.plan !== null) put(canonicalHash(share.plan.hash), false)
    else void writeOwn()
  }

  const open = (hash: string, via: 'startup' | 'navigation') => {
    const read = readShareHash(hash)
    const state = store.getState()
    if (read.kind === 'none') {
      restore()
      return
    }
    if (read.kind === 'unreadable') {
      state.showLinkUnreadable()
      restore()
      return
    }
    if (via === 'navigation') state.dismissBanner('linkUnreadable')
    if (read.dropped.length > 0) state.showDataDropped(read.dropped)
    const { link } = read
    known = read.hash
    if (matchesOwnInput(link, state)) {
      state.exitSharedPlan()
    } else if (isOwnInputEmpty(state)) {
      state.adoptSharedPlan(link, { record: via === 'navigation' })
    } else if (via === 'startup' && env.isOwnEntry(read.hash)) {
      // Our own hash gone stale: the page was reloaded before the debounced rewrite, or the input changed in another
      // tab. The mark survives reloads and session restore, and the saved input wins.
      restore()
    } else {
      state.showSharedPlan({ input: link.input, settings: link.settings, hash: read.hash })
    }
  }

  const unsubscribe = store.subscribe((state, prev) => {
    if (state.share.active) {
      // While a shared plan is shown, never write the user's input; keep the address bar on the shown plan's hash
      cancelPending()
      if (state.share.plan !== null && state.share.plan !== prev.share.plan) put(canonicalHash(state.share.plan.hash), false)
      return
    }
    if (prev.share.active) {
      void writeOwn()
      return
    }
    if (state.input !== prev.input || state.session !== prev.session) schedule()
  })

  const onHashChange = () => {
    const current = env.read()
    const canonical = canonicalHash(current)
    // Our own write
    if (canonical === known) return
    // In-page anchor (#step-3 and so on): put the share-link hash back
    if (!isShareHash(current)) {
      restore()
      return
    }
    // Back or Forward reached an entry written for the user's input
    if (env.isOwnEntry(canonical)) {
      const state = store.getState()
      if (state.share.active) state.exitSharedPlan()
      else restore()
      return
    }
    open(current, 'navigation')
  }

  open(env.read(), 'startup')
  const unlisten = env.listen(onHashChange)

  return () => {
    stopped = true
    cancelPending()
    unsubscribe()
    unlisten()
  }
}
