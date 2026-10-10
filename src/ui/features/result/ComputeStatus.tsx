import { Button } from '../../components/base/Button.tsx'
import { useT } from '../../i18n/useT.ts'
import type { SolveActions, SolveView } from '../../solver/types.ts'
import { useSolveProgress } from '../../solver/useSolveResult.ts'
import styles from './ComputeStatus.module.css'

export interface ComputeStatusProps {
  readonly solve: Pick<SolveView, 'stale' | 'slow' | 'slowPredicted' | 'cancelled'> & SolveActions
  /** Progress from 0 to 1, or null when unknown. Read from the solver when omitted. */
  readonly progress?: number | null
}

export function ComputeStatus({ solve, progress }: ComputeStatusProps) {
  const { t } = useT()
  if (solve.cancelled) {
    return (
      <div className={styles.cancelled}>
        <p className={styles.text}>{t('compute.cancelled')}</p>
        <Button onClick={solve.retry}>{t('compute.retry')}</Button>
      </div>
    )
  }
  if (!solve.stale) return null
  if (!solve.slow) {
    if (!solve.slowPredicted) return null
    return (
      <div className={styles.status}>
        <p className={styles.busy}>{t('compute.busy')}</p>
        <p className={styles.text}>{t('compute.slowPredicted')}</p>
      </div>
    )
  }
  return (
    <div className={styles.status}>
      <ProgressHead progress={progress} />
      <div className={styles.foot}>
        <p className={styles.text}>{t('compute.slow')}</p>
        <Button onClick={solve.cancel}>{t('compute.cancel')}</Button>
      </div>
    </div>
  )
}

// The only part that subscribes to progress, so the rest does not re-render on every update
function ProgressHead({ progress }: { readonly progress: number | null | undefined }) {
  const { t } = useT()
  const live = useSolveProgress()
  const value = progress === undefined ? live : progress
  const percent = value === null ? null : Math.round(value * 100)
  return (
    <div className={styles.head}>
      <p className={styles.busy}>{t('compute.busy')}</p>
      <div
        role="progressbar"
        aria-label={t('compute.busy')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className={styles.bar}
        data-indeterminate={percent === null || undefined}
      >
        <span className={styles.fill} style={percent === null ? undefined : { inlineSize: `${percent}%` }} />
      </div>
      {percent !== null && (
        <span className={styles.percent} aria-hidden="true">
          {percent}%
        </span>
      )}
    </div>
  )
}
