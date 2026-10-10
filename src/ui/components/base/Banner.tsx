import type { ReactNode, Ref } from 'react'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import type { IconKey } from '../../icons/iconKeys.ts'
import styles from './Banner.module.css'

export interface BannerProps {
  readonly label: string
  readonly children: ReactNode
  readonly note?: ReactNode
  readonly actions?: ReactNode
  onClose?(): void
  readonly tone?: 'shared' | 'notice'
  readonly icon?: IconKey
  readonly ref?: Ref<HTMLElement>
}

export function Banner({ label, children, note, actions, onClose, tone = 'notice', icon = 'info', ref }: BannerProps) {
  const { t } = useT()
  return (
    <section ref={ref} role="region" aria-label={label} className={styles.banner} data-tone={tone} tabIndex={-1}>
      <div className={styles.inner}>
        <PixelIcon name={icon} size={16} className={styles.icon} />
        <div className={styles.content}>
          <div className={styles.text}>
            <p className={styles.message}>{children}</p>
            {note !== undefined && note !== null && <p className={styles.note}>{note}</p>}
          </div>
          {actions !== undefined && <div className={styles.actions}>{actions}</div>}
        </div>
        {onClose !== undefined && (
          <button type="button" className={styles.close} onClick={onClose}>
            {t('banner.close')}
          </button>
        )}
      </div>
    </section>
  )
}
