// Where the first card of the result is relative to the viewport, for the result bar. App renders the bar outside the
// result panel, so the state lives in this module instead of props.

import { useCallback, useSyncExternalStore } from 'react'

export type AnchorPosition = 'none' | 'visible' | 'above' | 'below'

export const ANCHOR_HEADING_ATTR = 'data-result-anchor-heading'

let position: AnchorPosition = 'none'
let element: HTMLElement | null = null
let observer: IntersectionObserver | null = null
const listeners = new Set<() => void>()

function setPosition(next: AnchorPosition): void {
  if (next === position) return
  position = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getPosition = (): AnchorPosition => position

export function positionOf(rect: Pick<DOMRectReadOnly, 'top' | 'bottom'>, viewportHeight: number): AnchorPosition {
  if (rect.bottom <= 0) return 'above'
  if (rect.top >= viewportHeight) return 'below'
  return 'visible'
}

let frame: number | null = null

function measure(): void {
  frame = null
  if (element === null) return
  setPosition(positionOf(element.getBoundingClientRect(), window.innerHeight))
}

// Also runs on every scroll, since IntersectionObserver misses large jumps
function schedule(): void {
  if (frame === null) frame = requestAnimationFrame(measure)
}

function attach(next: HTMLElement | null): void {
  if (next === element) return
  observer?.disconnect()
  observer = null
  element = next
  if (next === null) {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    setPosition('none')
    return
  }
  if (typeof IntersectionObserver === 'undefined') {
    // Without IntersectionObserver (tests, old browsers) the fixed bar never shows
    setPosition('visible')
    return
  }
  // IntersectionObserver covers the card moving because content above it changed height
  observer = new IntersectionObserver(schedule)
  observer.observe(next)
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule, { passive: true })
  measure()
}

/** Only one card is attached at a time */
export function useResultAnchorRef(): (el: HTMLElement | null) => (() => void) | undefined {
  return useCallback((el: HTMLElement | null) => {
    if (el === null) return undefined
    attach(el)
    return () => {
      if (element === el) attach(null)
    }
  }, [])
}

export function useAnchorPosition(): AnchorPosition {
  return useSyncExternalStore(subscribe, getPosition, getPosition)
}

export function focusResultAnchor(): void {
  const target = element
  if (target === null) return
  target.scrollIntoView({ block: 'start' })
  const heading = target.querySelector<HTMLElement>(`[${ANCHOR_HEADING_ATTR}]`) ?? target
  heading.focus({ preventScroll: true })
}

/** For tests */
export function resetResultAnchor(): void {
  if (typeof window !== 'undefined') {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
  }
  observer?.disconnect()
  observer = null
  element = null
  position = 'none'
  for (const listener of listeners) listener()
}
