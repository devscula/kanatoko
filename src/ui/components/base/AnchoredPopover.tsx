// Rendered into body with fixed positioning so that scrolling columns cannot clip it.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import styles from './AnchoredPopover.module.css'

const GAP = 6
const MARGIN = 8
const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

// A dialog opened from inside the popover, such as a confirmation, must not close it.
function inOtherDialog(node: Node | null, self: HTMLElement | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement ?? null
  const dialog = el?.closest('[role="dialog"], [role="alertdialog"]') ?? null
  return dialog !== null && dialog !== self
}

export interface AnchoredPopoverProps {
  readonly anchor: RefObject<HTMLElement | null>
  readonly open: boolean
  onClose(): void
  /** May be empty when labelledBy is given. */
  readonly label: string
  readonly labelledBy?: string
  /** Defaults to the [data-autofocus] element, then the first control. */
  readonly initialFocus?: () => HTMLElement | null
  /** tip looks like the in-game tooltip; menu is a scrolling dropdown on a light surface. */
  readonly variant?: 'tip' | 'menu'
  readonly className?: string
  readonly children: ReactNode
}

export function AnchoredPopover({ anchor, open, onClose, label, labelledBy, initialFocus, variant = 'tip', className, children }: AnchoredPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ readonly left: number; readonly top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const el = ref.current
    if (el === null) return
    const a = anchor.current
    const { width, height } = el.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    if (a === null || !a.isConnected) {
      // Opened without an anchor, e.g. from a keyboard shortcut.
      setPos({ left: Math.max(MARGIN, (vw - width) / 2), top: 64 })
      return
    }
    const r = a.getBoundingClientRect()
    const left = Math.min(Math.max(r.left, MARGIN), vw - width - MARGIN)
    const below = r.bottom + GAP
    const top = below + height <= vh - MARGIN ? below : Math.max(MARGIN, r.top - GAP - height)
    setPos({ left, top })
  }, [open, anchor])

  useEffect(() => {
    if (!open || pos === null) return
    const el = ref.current
    const target =
      initialFocus?.() ??
      el?.querySelector<HTMLElement>('[data-autofocus]') ??
      el?.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()
    // Run once, right after the first position is set, and not again when initialFocus changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos === null])

  useEffect(() => {
    if (!open) return
    const close = (returnFocus: boolean) => {
      onClose()
      if (returnFocus) anchor.current?.focus()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (inOtherDialog(document.activeElement, ref.current)) return
        event.stopPropagation()
        close(true)
      }
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchor.current?.contains(target) || inOtherDialog(target, ref.current)) return
      close(false)
    }
    const onScroll = (event: Event) => {
      if (ref.current?.contains(event.target as Node)) return
      close(false)
    }
    const onResize = () => close(false)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, onClose, anchor])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={labelledBy === undefined ? label : undefined}
      aria-labelledby={labelledBy}
      className={[variant === 'menu' ? styles.menu : styles.popover, className ?? ''].filter(Boolean).join(' ')}
      style={pos === null ? { left: 0, top: 0, visibility: 'hidden' } : { left: pos.left, top: pos.top }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (next !== null && !ref.current?.contains(next) && !anchor.current?.contains(next) && !inOtherDialog(next, ref.current)) onClose()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
