import { useId, useState } from 'react'
import type { Edition } from '../../../data/types.ts'
import type { ObjectState } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { MOTION_VARS } from '../../components/base/motion.ts'
import { fillSlot, SLOT_MARK } from '../../i18n/fillSlots.tsx'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { Slot } from '../../icons/Slot.tsx'
import type { SlotSize } from '../../icons/sizes.ts'
import type { DisplayStep, SlotView } from '../../plan/displayPlan.ts'
import { CapGauge } from './CapGauge.tsx'
import { CostBreakdown } from './CostBreakdown.tsx'
import { MatchLine } from './MatchLine.tsx'
import { SpokenText } from '../../i18n/SpokenText.tsx'
import { showsGauge, stepHeadingId } from './model.ts'
import styles from './StepCard.module.css'

export interface StepCardProps {
  readonly step: DisplayStep
  readonly stale: boolean
  readonly edition: Edition
  readonly after: ObjectState | null
  /** A step of the reference plan with no level limit */
  readonly reference?: boolean
  readonly slotSize: Extract<SlotSize, 72>
  readonly idPrefix: string
  onOpenMismatch(): void
}

interface SlotCellProps {
  readonly slot: SlotView | null
  readonly size: SlotSize
  readonly part: 'left' | 'right' | 'result'
  readonly caption: string
}

function SlotCell({ slot, size, part, caption }: SlotCellProps) {
  return (
    <span className={styles.slotCell} data-part={part}>
      <span className={styles.slotBox}>
        <Slot size={size} item={slot?.item ?? null} enchanted={slot?.enchanted ?? false} book={slot?.contents} letter={slot?.letter ?? null} />
      </span>
      <span className={styles.caption}>{caption}</span>
    </span>
  )
}

export function StepCard({ step, stale, edition, after, reference = false, slotSize, idPrefix, onOpenMismatch }: StepCardProps) {
  const { t, num, spoken } = useT()
  const uid = useId()
  const headingId = stepHeadingId(idPrefix, step.no)
  const breakdownId = `${uid}-breakdown`
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const over = step.tooExpensive

  const costNumber = (
    <p className={styles.cost}>
      {over && <PixelIcon name="warning" size={16} className={styles.costWarn} />}
      <span className={styles.costValue}>{num(step.cost.total)}</span>
      <span className={styles.unit}>{t('summary.levelUnitFor', { n: step.cost.total })}</span>
    </p>
  )

  const body = (
    <>
      <div className={styles.slots} aria-hidden="true">
        <SlotCell slot={step.left} size={slotSize} part="left" caption={t('slot.left')} />
        <PixelIcon name="combine" size={24} className={styles.joiner} />
        <SlotCell slot={step.right} size={slotSize} part="right" caption={t('slot.right')} />
        <PixelIcon name="arrow-right" size={24} className={styles.joiner} />
        <SlotCell slot={step.result} size={slotSize} part="result" caption={t('slot.take')} />
      </div>
      <div className={styles.details}>
        <dl className={styles.labels}>
          <div className={styles.labelRow}>
            <dt>{t('row.left')}</dt>
            <dd>
              <SpokenText value={step.left.fullLabel} />
            </dd>
          </div>
          {step.right !== null && (
            <div className={styles.labelRow}>
              <dt>{t('row.right')}</dt>
              <dd>
                <SpokenText value={step.right.fullLabel} />
              </dd>
            </div>
          )}
          <div className={styles.labelRow}>
            <dt>{t('row.result')}</dt>
            <dd>
              <SpokenText value={step.result.label} />
            </dd>
          </div>
        </dl>
        {step.renameHere && (
          <p className={styles.note}>
            <PixelIcon name="name-tag" size={16} className={styles.noteIcon} />
            <span>{t('step.renameHere')}</span>
          </p>
        )}
        {over && (
          <p className={styles.overCap}>
            <PixelIcon name="warning" size={16} className={styles.noteIcon} />
            <span>{t('step.overCap')}</span>
          </p>
        )}
        {showsGauge(step) && <CapGauge cost={step.cost.total} />}
        {step.warnings.includes('bedrock-unverified-value') && (
          <p className={styles.note}>
            <PixelIcon name="info" size={16} className={styles.noteIcon} />
            <span>{t('warning.loyaltyBedrock')}</span>
          </p>
        )}
        {/* A Survival anvil shows "Too Expensive!" for these, as the overCap note above already says */}
        {(!reference || !step.tooExpensive) && <MatchLine edition={edition} cost={step.cost.total} className={styles.match} />}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={breakdownOpen}
          aria-controls={breakdownId}
          onClick={() => setBreakdownOpen((open) => !open)}
        >
          {t('step.breakdown')}
          <PixelIcon name="chevron-right" size={16} className={styles.chevron} />
        </button>
        <div id={breakdownId} className={styles.breakdown} hidden={!breakdownOpen}>
          {breakdownOpen && <CostBreakdown step={step} edition={edition} after={after} />}
        </div>
        <Button variant="ghost" onClick={onOpenMismatch}>
          {t('step.mismatch')}
        </Button>
      </div>
    </>
  )

  return (
    <article className={styles.card} data-over={over || undefined} data-stale={stale || undefined} aria-labelledby={headingId} style={MOTION_VARS}>
      <div className={styles.grid}>
        <div className={styles.head}>
          <h4 id={headingId} tabIndex={-1} className={styles.heading}>
            {fillSlot(t('step.no', { n: SLOT_MARK }), <span className={styles.stepNo}>{step.no}</span>)}{' '}
            <span className="visually-hidden">{spoken(step.title)}</span>
          </h4>
        </div>
        <div className={styles.costArea}>{costNumber}</div>
        {body}
      </div>
    </article>
  )
}
