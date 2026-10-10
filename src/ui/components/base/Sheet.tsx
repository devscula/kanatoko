// A control inside that handles Esc itself (clearing a search field, say) calls event.preventDefault() to keep the
// sheet open.

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n/useT.ts'
import { IconButton } from './Button.tsx'
import { focusableWithin, isTopModal, pushModal, trapTab } from './modalStack.ts'
import styles from './Sheet.module.css'

export interface SheetProps {
  readonly open: boolean
  onClose(): void
  readonly title: ReactNode
  readonly children: ReactNode
  readonly footer?: ReactNode
  readonly variant?: 'dialog' | 'side'
  readonly width?: 'normal' | 'narrow'
  readonly role?: 'dialog' | 'alertdialog'
  /** Defaults to the first control in the body, then the heading */
  readonly initialFocus?: () => HTMLElement | null
  readonly describedBy?: string
  /** Hides the heading visually only; it still names the dialog */
  readonly hideTitle?: boolean
  readonly hideClose?: boolean
  readonly className?: string
}

// A little longer than the close transitions, so that the sheet unmounts once they end.
const EXIT_MS = 220

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  variant = 'dialog',
  width = 'normal',
  role = 'dialog',
  initialFocus,
  describedBy,
  hideTitle = false,
  hideClose = false,
  className,
}: SheetProps) {
  const { t } = useT()
  const titleId = useId()
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  // A body that overflows but has no controls must itself be focusable, or it cannot be scrolled from the keyboard
  // (WCAG 2.1.1).
  const [scrollOnly, setScrollOnly] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const openerRef = useRef<Element | null>(null)
  const onCloseRef = useRef(onClose)
  const initialFocusRef = useRef(initialFocus)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
    initialFocusRef.current = initialFocus
  })

  // Mount during render when opening; the effect below records the opener before focus moves.
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open) return
    const timer = setTimeout(() => {
      setMounted(false)
      setShown(false)
    }, EXIT_MS)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    const root = rootRef.current
    if (!mounted || !open || root === null) return
    openerRef.current = document.activeElement
    const release = pushModal(root)
    const target = initialFocusRef.current?.() ?? (bodyRef.current ? focusableWithin(bodyRef.current)[0] : undefined) ?? headingRef.current
    target?.focus({ preventScroll: true })
    const frame = requestAnimationFrame(() => setShown(true))
    return () => {
      cancelAnimationFrame(frame)
      release()
      const opener = openerRef.current
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [mounted, open])

  useEffect(() => {
    const body = bodyRef.current
    if (!mounted || body === null) return
    const measure = () => setScrollOnly(body.scrollHeight > body.clientHeight + 1 && focusableWithin(body).length === 0)
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    const observeSizes = () => {
      if (resize === null) return
      resize.disconnect()
      resize.observe(body)
      for (const child of Array.from(body.children)) resize.observe(child)
    }
    const mutation = new MutationObserver(() => {
      observeSizes()
      measure()
    })
    mutation.observe(body, { childList: true, subtree: true })
    observeSizes()
    measure()
    return () => {
      resize?.disconnect()
      mutation.disconnect()
    }
  }, [mounted])

  // Keep Tab cycling with the sheet while focus is on a toast, which lives outside the sheet and is never inert.
  useEffect(() => {
    if (!mounted || !open) return
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      const root = rootRef.current
      if (event.key !== 'Tab' || event.defaultPrevented || root === null || !isTopModal(root)) return
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || active.closest('[data-modal-exempt]') === null) return
      trapTab(root, event)
    }
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  }, [mounted, open])

  if (!mounted) return null

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = rootRef.current
    if (root === null || !isTopModal(root)) return
    if (event.key === 'Escape') {
      if (!event.defaultPrevented) {
        event.preventDefault()
        onCloseRef.current()
      }
      event.stopPropagation()
      return
    }
    trapTab(root, event)
  }

  return createPortal(
    <div
      ref={rootRef}
      className={styles.root}
      data-variant={variant}
      data-width={width}
      data-state={shown && open ? 'open' : 'closed'}
      onKeyDown={onKeyDown}
    >
      <div className={styles.scrim} aria-hidden="true" onMouseDown={() => onCloseRef.current()} />
      <div
        className={[styles.panel, className ?? ''].filter(Boolean).join(' ')}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
      >
        <div className={styles.grip} aria-hidden="true" />
        <div className={styles.header} data-hidden-title={hideTitle || undefined}>
          <h2 ref={headingRef} id={titleId} className={hideTitle ? 'visually-hidden' : styles.title} tabIndex={-1}>
            {title}
          </h2>
          {!hideClose && <IconButton icon="close" label={t('sheet.close')} variant="ghost" onClick={() => onCloseRef.current()} />}
        </div>
        <div
          ref={bodyRef}
          className={styles.body}
          tabIndex={scrollOnly ? 0 : undefined}
          role={scrollOnly ? 'region' : undefined}
          aria-labelledby={scrollOnly ? titleId : undefined}
        >
          {children}
        </div>
        {footer !== undefined && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
