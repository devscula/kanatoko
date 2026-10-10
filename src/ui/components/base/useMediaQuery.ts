import { useCallback, useSyncExternalStore } from 'react'

export const MEDIA = {
  medium: '(min-width: 600px)',
  cols2: '(min-width: 880px)',
  compactHeight: '(max-height: 719px)',
  /** The whole page scrolls instead of each column */
  pageScroll: '(max-height: 559px)',
  finePointer: '(pointer: fine)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
} as const

// Keyed by the matchMedia function, so that the cache starts over when a test replaces window.matchMedia.
const lists = new WeakMap<typeof window.matchMedia, Map<string, MediaQueryList>>()

function mediaList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  const matchMedia = window.matchMedia
  let byQuery = lists.get(matchMedia)
  if (byQuery === undefined) {
    byQuery = new Map()
    lists.set(matchMedia, byQuery)
  }
  let list = byQuery.get(query)
  if (list === undefined) {
    list = matchMedia.call(window, query)
    byQuery.set(query, list)
  }
  return list
}

function getMatch(query: string): boolean {
  return mediaList(query)?.matches ?? false
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaList(query)
      if (list === null) return () => {}
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => getMatch(query),
    () => false,
  )
}

export function prefersReducedMotion(): boolean {
  const chosen = typeof document === 'undefined' ? undefined : document.documentElement.dataset.motion
  if (chosen === 'reduce') return true
  if (chosen === 'full') return false
  return getMatch(MEDIA.reducedMotion)
}

export function useColumns(): 1 | 2 {
  return useMediaQuery(MEDIA.cols2) ? 2 : 1
}

export function useHeightMode(): { readonly compact: boolean; readonly pageScroll: boolean } {
  const compact = useMediaQuery(MEDIA.compactHeight)
  const pageScroll = useMediaQuery(MEDIA.pageScroll)
  return { compact, pageScroll }
}
