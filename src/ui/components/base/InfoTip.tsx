// Every info mark in the app uses this, so that the mark never means hover in one place and click in another.

import { useRef, useState, type ReactNode } from 'react'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { AnchoredPopover } from './AnchoredPopover.tsx'
import styles from './InfoTip.module.css'

export interface InfoTipProps {
  readonly label: string
  readonly children: ReactNode
  readonly className?: string
}

export function InfoTip({ label, children, className }: InfoTipProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={[styles.info, className ?? ''].filter(Boolean).join(' ')}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <PixelIcon name="info" size={16} />
      </button>
      <AnchoredPopover anchor={ref} open={open} onClose={() => setOpen(false)} label={label}>
        <p className={styles.text}>{children}</p>
      </AnchoredPopover>
    </>
  )
}
