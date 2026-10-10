import { LIMITS } from '../../../engine/index.ts'
import type { Problem, Settings, SolveTooComplex } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { useT } from '../../i18n/useT.ts'
import { booksToRemove, complexityRatio } from './model.ts'
import { ReferenceSteps } from './ReferenceSteps.tsx'
import { ANCHOR_HEADING_ATTR } from './resultAnchor.ts'
import styles from './TooComplexPanel.module.css'

export interface TooComplexPanelProps {
  readonly result: SolveTooComplex
  readonly problem: Problem
  readonly settings: Settings
  /** Owned books that the books to get already cover (Bedrock Edition) */
  readonly belowCount?: number
  onRemoveBelow?(): void
  readonly anchorRef?: (el: HTMLElement | null) => (() => void) | undefined
}

export function TooComplexPanel({ result, problem, settings, belowCount = 0, onRemoveBelow, anchorRef }: TooComplexPanelProps) {
  const { t } = useT()
  const { effectiveComplexity: effective, hardLimit, fastPathEligible } = result.complexity
  const ratio = complexityRatio(effective, hardLimit)
  const ratioText = t('tooComplex.ratio', { x: ratio })
  // The bar spans the current work; a timeout can stop within the limit, which puts the mark at the right end
  const limitAt = effective > 0 ? Math.min(1, hardLimit / effective) : 1
  const reduce = !fastPathEligible && effective > hardLimit
  // Hitting the complexity limit within the work limit means too many distinct enchantments, which the meter would
  // contradict
  const tooManyKinds = result.cause === 'complexity-limit' && effective <= hardLimit
  return (
    <div className={styles.tooComplex}>
      <section ref={anchorRef} className={styles.panel} aria-labelledby="too-complex-title">
        <h3 id="too-complex-title" className={styles.title} tabIndex={-1} {...{ [ANCHOR_HEADING_ATTR]: '' }}>
          {t(result.cause === 'complexity-limit' ? 'tooComplex.title' : 'tooComplex.titleTimeout')}
        </h3>
        {!tooManyKinds && (
          <div className={styles.meterBlock}>
            <span id="too-complex-meter" className={styles.meterLabel}>
              {t('tooComplex.meter')}
            </span>
            <div className={styles.meterRow}>
              <div
                role="meter"
                aria-labelledby="too-complex-meter"
                aria-valuemin={0}
                aria-valuemax={hardLimit}
                aria-valuenow={effective}
                aria-valuetext={ratioText}
                className={styles.meter}
                style={{ ['--limit-at' as string]: String(limitAt) }}
                data-limit-start={limitAt < 0.5 || undefined}
              >
                <span className={styles.fill} />
                <span className={styles.limit} aria-hidden="true">
                  <span className={styles.limitLabel}>{t('tooComplex.limit')}</span>
                </span>
              </div>
              <span className={styles.ratio} aria-hidden="true">
                {ratioText}
              </span>
            </div>
          </div>
        )}
        <p className={styles.text}>
          {tooManyKinds
            ? t('tooComplex.kinds', { max: LIMITS.exactMaxDistinctEnchantments })
            : reduce
              ? t('tooComplex.reduceN', { n: booksToRemove(effective, hardLimit) })
              : t('tooComplex.reduce')}
        </p>
        {!tooManyKinds && (settings.rename || settings.levelCap === null) && <p className={styles.note}>{t('tooComplex.doubled')}</p>}
        {belowCount > 0 && onRemoveBelow !== undefined && (
          <div className={styles.remedy}>
            <Button icon="trash" onClick={onRemoveBelow}>
              {t('tooComplex.removeBelow', { n: belowCount })}
            </Button>
          </div>
        )}
      </section>
      {result.reference !== null && <ReferenceSteps reference={result.reference} problem={problem} settings={settings} />}
    </div>
  )
}
