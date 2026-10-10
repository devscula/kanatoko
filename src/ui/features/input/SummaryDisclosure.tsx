import type { ReactNode } from 'react'
import { useT } from '../../i18n/useT.ts'
import type { IconKey } from '../../icons/iconKeys.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import styles from './Input.module.css'

export interface SummaryDisclosureProps {
  readonly id: string
  readonly icon: IconKey | ReactNode
  readonly label: string
  readonly value: string
  readonly actionLabel: string
  readonly expanded: boolean
  onToggle(): void
  readonly warn?: boolean
  /** Shown even when closed. */
  readonly meta?: ReactNode
  readonly children: ReactNode
}

export function SummaryDisclosure({ id, icon, label, value, actionLabel, expanded, onToggle, warn = false, meta, children }: SummaryDisclosureProps) {
  const { t } = useT()
  const panelId = `${id}-panel`
  return (
    <div className={styles.disclosure} data-expanded={expanded || undefined}>
      <div className={styles.disclosureRow}>
        <span className={styles.disclosureIcon} aria-hidden="true">
          {typeof icon === 'string' ? <PixelIcon name={icon as IconKey} size={16} /> : icon}
        </span>
        <span className={styles.disclosureText}>
          <span className={styles.disclosureLabel}>{label}: </span>
          <span className={styles.disclosureValue} data-warn={warn || undefined}>
            {warn && <PixelIcon name="warning" size={16} className={styles.inlineIcon} />}
            {value}
          </span>
        </span>
        {meta}
        <button
          id={id}
          type="button"
          className={styles.textButton}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={t('disclosure.sr', { label, action: actionLabel, value })}
          onClick={onToggle}
        >
          <span>{actionLabel}</span>
          <PixelIcon name="chevron-right" size={16} className={styles.chevron} />
        </button>
      </div>
      <div id={panelId} className={styles.disclosurePanel} hidden={!expanded}>
        {expanded && children}
      </div>
    </div>
  )
}
