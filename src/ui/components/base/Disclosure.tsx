import { useId, useState, type ReactNode } from 'react'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import styles from './Disclosure.module.css'

export interface DisclosureProps {
  readonly summary: ReactNode
  readonly children: ReactNode
  readonly open?: boolean
  readonly defaultOpen?: boolean
  onOpenChange?(open: boolean): void
  readonly id?: string
  readonly className?: string
  readonly meta?: ReactNode
}

export function Disclosure({ summary, children, open, defaultOpen = false, onOpenChange, id, className, meta }: DisclosureProps) {
  const autoId = useId()
  const panelId = `${id ?? autoId}-panel`
  const [ownOpen, setOwnOpen] = useState(defaultOpen)
  const isOpen = open ?? ownOpen
  const toggle = () => {
    const next = !isOpen
    if (open === undefined) setOwnOpen(next)
    onOpenChange?.(next)
  }
  return (
    <div className={[styles.disclosure, className ?? ''].filter(Boolean).join(' ')} data-open={isOpen || undefined}>
      <button id={id} type="button" className={styles.trigger} aria-expanded={isOpen} aria-controls={panelId} onClick={toggle}>
        <span className={styles.summary}>{summary}</span>
        {meta !== undefined && <span className={styles.meta}>{meta}</span>}
        <PixelIcon name="chevron-right" size={16} className={styles.chevron} />
      </button>
      <div id={panelId} className={styles.panel} inert={!isOpen}>
        <div className={styles.inner}>{children}</div>
      </div>
    </div>
  )
}
