import { useId } from 'react'
import type { Problem, Warning } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { InfoTip } from '../../components/base/InfoTip.tsx'
import { listText } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { targetItemOf, type DisplayPlan } from '../../plan/displayPlan.ts'
import { extraEnchantmentTexts, LEVEL_CAP } from './model.ts'
import { summaryNotices, type SummaryActions } from './notices.ts'
import { ANCHOR_HEADING_ATTR } from './resultAnchor.ts'
import styles from './SummaryPanel.module.css'

export interface SummaryPanelProps extends SummaryActions {
  readonly plan: DisplayPlan
  readonly problem: Problem
  readonly warnings: readonly Warning[]
  readonly stale: boolean
  readonly trivialRename: boolean
  readonly anchorRef?: (el: HTMLElement | null) => (() => void) | undefined
}

interface FigureProps {
  readonly label: string
  readonly value: string
  readonly unit?: string
  readonly xp: boolean
  readonly over?: boolean
}

function Figure({ label, value, unit, xp, over = false }: FigureProps) {
  return (
    <div className={styles.figure} data-xp={xp || undefined} data-over={over || undefined}>
      <dt className={styles.figureLabel}>{label}</dt>
      <dd className={styles.figureValue}>
        <span className={styles.pixel48}>
          {over && <PixelIcon name="warning" size={32} className={styles.overIcon} />}
          {value}
        </span>
        {unit !== undefined && <span className={styles.unit}>{unit}</span>}
      </dd>
    </div>
  )
}

export function SummaryPanel(props: SummaryPanelProps) {
  const { plan, problem, warnings, stale, trivialRename, anchorRef } = props
  const { t, text, num, lang } = useT()
  const uid = useId()
  const gap = lang === 'ja' ? '' : ' '
  const { summary } = plan
  const stepCount = plan.steps.length
  const notices = summaryNotices(warnings, { itemType: targetItemOf(problem) }, props)
  const apply = summary.applyToFreshItem
  const levels = (n: number) => t('summary.levelUnitFor', { n })

  return (
    <section ref={anchorRef} className={styles.card} data-stale={stale || undefined} aria-labelledby={`${uid}-heading`}>
      <h3 id={`${uid}-heading`} className="visually-hidden" tabIndex={-1} {...{ [ANCHOR_HEADING_ATTR]: '' }}>
        {t('summary.heading')}
      </h3>
      {stale && <p className={styles.staleBadge}>{t('summary.stale')}</p>}
      {trivialRename && <p className={styles.line}>{t('empty.trivialRename', { c: summary.totalLevels })}</p>}

      <div className={styles.top}>
        <dl className={styles.figures}>
          <Figure label={t('summary.total')} value={num(summary.totalLevels)} unit={levels(summary.totalLevels)} xp />
          <Figure label={t('summary.max')} value={num(summary.maxStepLevels)} unit={levels(summary.maxStepLevels)} xp over={summary.maxStepLevels > LEVEL_CAP} />
          <Figure label={t('summary.steps')} value={num(stepCount)} xp={false} />
        </dl>
        <p className={styles.maxLine}>
          {stepCount > 1
            ? t('summary.maxLine', { max: summary.maxStepLevels, total: summary.totalLevels })
            : t('summary.single', { total: summary.totalLevels })}
        </p>
      </div>

      <dl className={styles.details}>
        <div className={styles.detail}>
          <dt>{t('summary.xp')}</dt>
          <dd>
            <span className={styles.detailValue}>
              <span className={styles.number}>{num(summary.xpPoints)}</span>
              <InfoTip label={t('summary.xpInfoButton')}>{t('summary.xpInfo')}</InfoTip>
            </span>
          </dd>
        </div>
        <div className={styles.detail}>
          <dt>{t('summary.finalPwp')}</dt>
          <dd>
            <span className={styles.detailValue}>
              <span className={[styles.number, styles.pwp].join(' ')}>{num(summary.finalPriorWorkPenalty)}</span>
              <InfoTip label={t('summary.finalPwpInfoButton')}>{t('summary.finalPwpInfo')}</InfoTip>
            </span>
            <span className={styles.sub}>{t('summary.finalUses', { n: summary.finalAnvilUses })}</span>
          </dd>
        </div>
      </dl>

      {plan.extraEnchantments.length > 0 && (
        <p className={styles.line}>{t('summary.extra', { list: listText(extraEnchantmentTexts(plan)) })}</p>
      )}
      {apply !== null && !apply.tooExpensive && <p className={styles.line}>{t('summary.applyToFresh', { c: apply.cost })}</p>}
      {apply !== null && apply.tooExpensive && (
        <div className={styles.danger}>
          <p className={styles.noticeText}>
            <PixelIcon name="warning" size={16} className={styles.noticeIcon} />
            <span>{t('warning.finalBookTooExpensive', { c: apply.cost })}</span>
          </p>
          <Button onClick={props.onChooseItem}>{t('warning.chooseItem')}</Button>
        </div>
      )}
      {notices.length > 0 && (
        <ul className={styles.notices}>
          {notices.map((notice) => (
            <li key={notice.id} className={styles.notice}>
              <p className={styles.noticeText}>
                <PixelIcon name="warning" size={16} className={styles.noticeIcon} />
                <span>
                  {text(notice.text)}
                  {notice.more !== undefined && gap + text(notice.more)}
                </span>
              </p>
              {notice.actions.length > 0 && (
                <div className={styles.noticeActions}>
                  {notice.actions.map((action, index) => (
                    <Button key={index} onClick={action.run}>
                      {text(action.label)}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
