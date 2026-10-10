import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IconButton } from '../../components/base/Button.tsx'
import { Sheet } from '../../components/base/Sheet.tsx'
import { MEDIA, useMediaQuery } from '../../components/base/useMediaQuery.ts'
import styles from './CardMenu.module.css'

export interface CardMenuProps {
  readonly label: string
  readonly open: boolean
  onOpenChange(open: boolean): void
  readonly children: ReactNode
}

export function CardMenu({ label, open, onOpenChange, children }: CardMenuProps) {
  const wide = useMediaQuery(MEDIA.cols2)
  const panelId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  })

  useEffect(() => {
    if (!wide || !open) return
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current !== null && event.target instanceof Node && !wrapRef.current.contains(event.target)) {
        onOpenChangeRef.current(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [wide, open])

  const button = (
    <IconButton
      ref={buttonRef}
      icon="more"
      label={label}
      variant="ghost"
      aria-expanded={wide ? open : undefined}
      aria-controls={wide && open ? panelId : undefined}
      aria-haspopup={wide ? undefined : 'dialog'}
      onClick={() => onOpenChange(!open)}
    />
  )

  if (!wide) {
    return (
      <>
        {button}
        <Sheet open={open} onClose={() => onOpenChange(false)} title={label} width="narrow">
          <div className={styles.content}>{children}</div>
        </Sheet>
      </>
    )
  }

  return (
    <div
      ref={wrapRef}
      className={styles.wrap}
      data-open={open || undefined}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        event.stopPropagation()
        onOpenChange(false)
        buttonRef.current?.focus()
      }}
      onBlur={(event) => {
        if (!open) return
        const next = event.relatedTarget
        if (next instanceof Node && wrapRef.current?.contains(next)) return
        // null when focus went somewhere like a toast under body; stay open then
        if (next === null) return
        onOpenChange(false)
      }}
    >
      {button}
      {open && (
        <div id={panelId} role="group" aria-label={label} className={styles.popover}>
          {children}
        </div>
      )}
    </div>
  )
}
