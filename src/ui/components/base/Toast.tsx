// Only the message is announced, through a separate live region: a status role on the visible toast would read out the
// button names too. The dock is data-modal-exempt so that an undo toast stays usable above a sheet.

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n/useT.ts'
import type { ToastItem } from '../../state/slices/toast.ts'
import { useAppStore } from '../../state/store.ts'
import { IconButton } from './Button.tsx'
import { LiveRegion } from './LiveRegion.tsx'
import { focusableWithin, topModal } from './modalStack.ts'
import styles from './Toast.module.css'

export const TOAST_DURATION_MS = 10_000
// Length of the --dur-toast-out fade
const LEAVE_MS = 120
export const TOAST_BOTTOM_VAR = '--toast-bottom'

// Publishes how much of the viewport bottom the toast covers, which sheets keep clear.
function useToastBottom(dock: HTMLElement | null, visible: boolean): void {
  useLayoutEffect(() => {
    const html = document.documentElement
    if (!visible || dock === null) {
      html.style.removeProperty(TOAST_BOTTOM_VAR)
      return
    }
    const measure = () => {
      const value = `${Math.max(0, Math.ceil(window.innerHeight - dock.getBoundingClientRect().top))}px`
      // Skip unchanged values: the observer below watches html's style, so each write would trigger another measurement.
      if (html.style.getPropertyValue(TOAST_BOTTOM_VAR) !== value) html.style.setProperty(TOAST_BOTTOM_VAR, value)
    }
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resize?.observe(dock)
    // The toast's position depends on data-result-bar and --result-bar-cover on html.
    const attributes = new MutationObserver(measure)
    attributes.observe(html, { attributes: true, attributeFilter: ['data-result-bar', 'style'] })
    window.addEventListener('resize', measure)
    return () => {
      resize?.disconnect()
      attributes.disconnect()
      window.removeEventListener('resize', measure)
      html.style.removeProperty(TOAST_BOTTOM_VAR)
    }
  }, [dock, visible])
}

function canFocus(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && el !== document.body && el.closest('[inert], [hidden]') === null
}

// Keeps focus from dropping to body when a focused toast goes away. Without a previous element (the toast was clicked,
// say) the page must not jump to the fallback target.
function focusAfterToast(returnTo: Element | null): void {
  const modal = topModal()
  let target: HTMLElement | null = canFocus(returnTo) && (modal === null || modal.contains(returnTo)) ? returnTo : null
  if (target === null && modal !== null) target = focusableWithin(modal)[0] ?? modal
  target ??= document.getElementById('results')
  target?.focus({ preventScroll: returnTo === null })
}

export function ToastRegion() {
  const { t, text } = useT()
  const toast = useAppStore((s) => s.toast)
  const dismiss = useAppStore((s) => s.dismissToast)
  const [previous, setPrevious] = useState<ToastItem | null>(toast)
  const [leaving, setLeaving] = useState<ToastItem | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dock, setDock] = useState<HTMLDivElement | null>(null)
  const remaining = useRef(TOAST_DURATION_MS)
  const startedAt = useRef(0)
  const timedId = useRef<number | undefined>(undefined)
  const returnTo = useRef<Element | null>(null)
  const focusInside = useRef(false)

  // A dismissed toast stays mounted for its fade-out; a replaced one goes at once.
  if (toast !== previous) {
    setPrevious(toast)
    setLeaving(toast === null ? previous : null)
    setHovered(false)
    setFocused(false)
  }
  // New toasts never take focus, so focus inside means the toast that just went away had it.
  const shownId = toast?.id ?? null
  useLayoutEffect(() => {
    if (!focusInside.current) return
    focusInside.current = false
    focusAfterToast(returnTo.current)
    returnTo.current = null
  }, [shownId])
  useEffect(() => {
    if (leaving === null) return
    const timer = setTimeout(() => setLeaving(null), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  const paused = hovered || focused
  const id = toast?.id
  useEffect(() => {
    if (id === undefined || paused) return
    if (timedId.current !== id) {
      timedId.current = id
      remaining.current = TOAST_DURATION_MS
    }
    startedAt.current = Date.now()
    const timer = setTimeout(() => dismiss(id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
    }
  }, [id, paused, dismiss])

  const item = toast ?? leaving ?? undefined
  // Stop reserving space during the fade-out, when the toast can no longer be pressed.
  useToastBottom(dock, toast !== null)
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) returnTo.current = event.relatedTarget
    focusInside.current = true
    setFocused(true)
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setFocused(false)
    // A blur with no target means the focused button was removed, and focus still needs restoring.
    if (event.relatedTarget !== null) focusInside.current = false
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only from inside the toast; elsewhere Esc clears search fields, closes sheets and so on.
    if (event.key !== 'Escape' || toast === null) return
    event.preventDefault()
    event.stopPropagation()
    dismiss(toast.id)
  }
  return createPortal(
    <div ref={setDock} className={styles.dock} data-modal-exempt="" data-area={item?.area ?? 'global'}>
      <LiveRegion id="toast-announcer" text={toast === null ? null : text(toast.message)} seq={toast?.id ?? 0} />
      <div className={styles.region}>
        {item !== undefined && (
          <div
            key={item.id}
            className={styles.toast}
            data-leaving={(toast === null && leaving !== null) || undefined}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
          >
            <p className={styles.message}>{text(item.message)}</p>
            {item.actions.length > 0 && (
              <div className={styles.actions}>
                {item.actions.map((action, index) => (
                  <button key={index} type="button" className={styles.action} onClick={action.run}>
                    {text(action.label)}
                  </button>
                ))}
              </div>
            )}
            <IconButton icon="close" label={t('toast.close')} variant="inverse" className={styles.close} onClick={() => dismiss(item.id)} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
