// base.css turns the result bar's cover height into scroll-padding, so that focused elements do not end up hidden under
// the bar (WCAG 2.4.11). The bar's height changes with text size and wrapping, so it is measured.

import { useLayoutEffect } from 'react'

export const RESULT_BAR_COVER_VAR = '--result-bar-cover'

/** Sets `name` on html to how far el reaches into the viewport from `edge`, for as long as el is mounted. */
export function useCoverVariable(el: HTMLElement | null, name: string, edge: 'top' | 'bottom'): void {
  useLayoutEffect(() => {
    const html = document.documentElement
    if (el === null) {
      html.style.removeProperty(name)
      return
    }
    const measure = () => {
      const rect = el.getBoundingClientRect()
      const covered = edge === 'bottom' ? window.innerHeight - rect.top : rect.bottom
      const value = `${Math.max(0, Math.ceil(covered))}px`
      if (html.style.getPropertyValue(name) !== value) html.style.setProperty(name, value)
    }
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resize?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      resize?.disconnect()
      window.removeEventListener('resize', measure)
      html.style.removeProperty(name)
    }
  }, [el, name, edge])
}
