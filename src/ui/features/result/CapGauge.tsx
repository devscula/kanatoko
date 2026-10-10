import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import styles from './CapGauge.module.css'
import { gaugeNote, LEVEL_CAP } from './model.ts'

export interface CapGaugeProps {
  readonly cost: number
  readonly meterOnly?: boolean
  readonly className?: string
}

export function CapGauge({ cost, meterOnly = false, className }: CapGaugeProps) {
  const { t, text, num } = useT()
  const over = cost > LEVEL_CAP
  const filled = Math.min(cost, LEVEL_CAP)
  const note = over ? null : gaugeNote(cost)
  return (
    <div className={[styles.gauge, className ?? ''].filter(Boolean).join(' ')} data-over={over || undefined}>
      <div className={styles.row}>
        <div
          role="meter"
          aria-label={t('gauge.label')}
          aria-valuemin={0}
          aria-valuemax={over ? cost : LEVEL_CAP}
          aria-valuenow={cost}
          aria-valuetext={over ? t('gauge.valueTextOver', { c: cost }) : t('gauge.valueText', { c: cost })}
          className={styles.meter}
        >
          {Array.from({ length: LEVEL_CAP }, (_, i) => (
            <span key={i} className={styles.cell} data-filled={i < filled || undefined} />
          ))}
        </div>
        {!meterOnly && (
          <span className={styles.value} aria-hidden="true">
            {over && <PixelIcon name="warning" size={16} className={styles.warn} />}
            {num(cost)} / {LEVEL_CAP}
          </span>
        )}
      </div>
      {note !== null && <p className={styles.note}>{text(note)}</p>}
    </div>
  )
}
