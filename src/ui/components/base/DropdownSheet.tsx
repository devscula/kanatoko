// Takes the same props as Sheet, so that a caller can switch between a modal and a dropdown.

import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react'
import { useT } from '../../i18n/useT.ts'
import { AnchoredPopover } from './AnchoredPopover.tsx'
import { IconButton } from './Button.tsx'
import styles from './DropdownSheet.module.css'

export interface DropdownSheetProps {
  readonly open: boolean
  onClose(): void
  readonly title: ReactNode
  readonly footer?: ReactNode
  readonly children: ReactNode
  readonly initialFocus?: () => HTMLElement | null
  readonly width?: 'narrow' | 'normal' | 'wide'
  /** Ignored; only there to match Sheet's props */
  readonly variant?: string
}

// Safari and Firefox on macOS do not focus a button on click, so the focused element cannot tell which button opened
// the dropdown.
let lastPressed: HTMLElement | null = null
if (typeof document !== 'undefined') {
  const remember = (target: EventTarget | null) => {
    const el = target instanceof Element ? target.closest<HTMLElement>('button, [role="button"], a, input, select, summary') : null
    if (el !== null) lastPressed = el
  }
  document.addEventListener('pointerdown', (event) => remember(event.target), true)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') remember(document.activeElement)
  }, true)
}

function pressedElement(): HTMLElement | null {
  if (lastPressed !== null && lastPressed.isConnected) return lastPressed
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

export function DropdownSheet({ open, onClose, title, footer, children, initialFocus, width = 'normal' }: DropdownSheetProps) {
  const { t } = useT()
  const titleId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  // Captured on the popover's first read of current, so that the anchor stays put while open.
  const capturedRef = useRef<HTMLElement | null>(null)
  const anchorRef = useMemo(
    () => ({
      get current() {
        capturedRef.current ??= pressedElement()
        return capturedRef.current
      },
    }),
    [],
  )
  useEffect(() => {
    if (!open) capturedRef.current = null
  }, [open])
  // As in Sheet, initial focus skips the close button in the header.
  const firstInBody = () =>
    bodyRef.current?.querySelector<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? null

  return (
    <AnchoredPopover
      anchor={anchorRef}
      open={open}
      onClose={onClose}
      label=""
      labelledBy={titleId}
      initialFocus={() => initialFocus?.() ?? firstInBody()}
      variant="menu"
      className={styles[width]}
    >
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <IconButton icon="close" variant="ghost" label={t('sheet.close')} onClick={onClose} />
      </div>
      <div ref={bodyRef} className={styles.body}>
        {children}
      </div>
      {footer !== undefined && <div className={styles.foot}>{footer}</div>}
    </AnchoredPopover>
  )
}
