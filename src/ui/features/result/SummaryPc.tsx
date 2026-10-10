import { useId } from 'react'
import type { EnchantmentId } from '../../../data/types.ts'
import type { Problem, Warning } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { Disclosure } from '../../components/base/Disclosure.tsx'
import { InfoTip } from '../../components/base/InfoTip.tsx'
import { enchText, listText } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import type { IconKey } from '../../icons/iconKeys.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { targetItemOf, type DisplayPlan } from '../../plan/displayPlan.ts'
import { extraEnchantmentTexts, LEVEL_CAP } from './model.ts'
import { summaryNotices, type SummaryActions } from './notices.ts'
import { ANCHOR_HEADING_ATTR } from './resultAnchor.ts'
import styles from './SummaryPc.module.css'

interface FigureProps {
  readonly icon: IconKey
  readonly label: string
  readonly value: string
  readonly unit?: string
  readonly xp: boolean
  readonly over?: boolean
}

function Figure({ icon, label, value, unit, xp, over = false }: FigureProps) {
  return (
    <div className={styles.figure} data-xp={xp || undefined} data-over={over || undefined}>
      <dt className={styles.figureLabel}>
        <PixelIcon name={icon} size={16} />
        <span>{label}</span>
      </dt>
      <dd className={styles.figureValue}>
        <span className={styles.number}>{value}</span>
        {unit !== undefined && <span className={styles.unit}>{unit}</span>}
      </dd>
    </div>
  )
}

export interface SummaryBarProps {
  readonly plan: DisplayPlan
  readonly stale: boolean
  readonly compact: boolean
  readonly trivialRename: boolean
  readonly anchorRef?: (el: HTMLElement | null) => (() => void) | undefined
}

export function SummaryBar({ plan, stale, compact, trivialRename, anchorRef }: SummaryBarProps) {
  const { t, num } = useT()
  const uid = useId()
  const { summary } = plan
  const stepCount = plan.steps.length
  const levels = (n: number) => t('summary.levelUnitFor', { n })
  return (
    <section
      ref={anchorRef}
      className={styles.bar}
      data-stale={stale || undefined}
      data-compact={compact || undefined}
      aria-labelledby={`${uid}-heading`}
    >
      <h3 id={`${uid}-heading`} className="visually-hidden" tabIndex={-1} {...{ [ANCHOR_HEADING_ATTR]: '' }}>
        {t('summary.heading')}
      </h3>
      {stale && <p className={styles.staleBadge}>{t('summary.stale')}</p>}
      {trivialRename && <p className={styles.line}>{t('empty.trivialRename', { c: summary.totalLevels })}</p>}
      <div className={styles.top}>
        <dl className={styles.figures}>
          <Figure icon="xp-orb" label={t('summary.total')} value={num(summary.totalLevels)} unit={levels(summary.totalLevels)} xp />
          <Figure
            icon="limit"
            label={t('summary.max')}
            value={num(summary.maxStepLevels)}
            unit={levels(summary.maxStepLevels)}
            xp
            over={summary.maxStepLevels > LEVEL_CAP}
          />
          <Figure icon="anvil" label={t('summary.steps')} value={num(stepCount)} xp={false} />
        </dl>
      </div>
    </section>
  )
}

export interface DetailsPanelProps {
  readonly plan: DisplayPlan
}

export function DetailsPanel({ plan }: DetailsPanelProps) {
  const { t, num } = useT()
  const uid = useId()
  const { summary } = plan
  const stepCount = plan.steps.length
  return (
    <Disclosure className={styles.details} id={`${uid}-details`} summary={<span className={styles.detailsTitle}>{t('details.title')}</span>}>
      <p className={styles.line}>
        {stepCount > 1
          ? t('summary.maxLine', { max: summary.maxStepLevels, total: summary.totalLevels })
          : t('summary.single', { total: summary.totalLevels })}
      </p>
      <dl className={styles.detailList}>
        <div className={styles.detailRow}>
          <dt>
            <PixelIcon name="xp-orb" size={16} />
            {t('summary.xp')}
          </dt>
          <dd>
            <span className={styles.detailNumber}>{num(summary.xpPoints)}</span>
            <InfoTip label={t('summary.xpInfoButton')}>{t('summary.xpInfo')}</InfoTip>
          </dd>
        </div>
        <div className={styles.detailRow}>
          <dt>
            <PixelIcon name="pwp" size={16} />
            {t('summary.finalPwp')}
          </dt>
          <dd>
            <span className={styles.detailNumber}>{num(summary.finalPriorWorkPenalty)}</span>
            <InfoTip label={t('summary.finalPwpInfoButton')}>{t('summary.finalPwpInfo')}</InfoTip>
          </dd>
          <dd className={styles.sub}>{t('summary.finalUses', { n: summary.finalAnvilUses })}</dd>
        </div>
      </dl>
    </Disclosure>
  )
}

export interface ResultNoticesProps extends Pick<SummaryActions, 'onKeep' | 'onChooseItem'> {
  readonly plan: DisplayPlan
  readonly problem: Problem
  readonly warnings: readonly Warning[]
  /** Enchantments that needed new books because the owned books alone could not make the result */
  readonly newBooks: readonly EnchantmentId[]
}

export function ResultNotices({ plan, problem, warnings, newBooks, onKeep, onChooseItem }: ResultNoticesProps) {
  const { t, text, lang } = useT()
  const gap = lang === 'ja' ? '' : ' '
  const notices = summaryNotices(warnings, { itemType: targetItemOf(problem) }, { onKeep, onChooseItem })
  const apply = plan.summary.applyToFreshItem
  const items: { key: string; warn: boolean; body: string; actions?: { label: string; run: () => void }[] }[] = []
  if (newBooks.length > 0) {
    items.push({ key: 'new-books', warn: false, body: t('notice.newBooks', { list: listText(newBooks.map((id) => enchText(id))) }) })
  }
  if (plan.extraEnchantments.length > 0) {
    items.push({ key: 'extra', warn: false, body: t('summary.extra', { list: listText(extraEnchantmentTexts(plan)) }) })
  }
  if (apply !== null && !apply.tooExpensive) items.push({ key: 'apply', warn: false, body: t('summary.applyToFresh', { c: apply.cost }) })
  if (apply !== null && apply.tooExpensive) {
    items.push({
      key: 'apply-over',
      warn: true,
      body: t('warning.finalBookTooExpensive', { c: apply.cost }),
      actions: [{ label: t('warning.chooseItem'), run: onChooseItem }],
    })
  }
  for (const notice of notices) {
    items.push({
      key: notice.id,
      warn: true,
      body: text(notice.text) + (notice.more !== undefined ? gap + text(notice.more) : ''),
      actions: notice.actions.map((action) => ({ label: text(action.label), run: action.run })),
    })
  }
  if (items.length === 0) return null
  return (
    <ul className={styles.notices}>
      {items.map((item) => (
        <li key={item.key} className={styles.notice} data-warn={item.warn || undefined}>
          <p className={styles.noticeText}>
            <PixelIcon name={item.warn ? 'warning' : 'info'} size={16} className={styles.noticeIcon} />
            <span>{item.body}</span>
          </p>
          {item.actions !== undefined && item.actions.length > 0 && (
            <div className={styles.noticeActions}>
              {item.actions.map((action) => (
                <Button key={action.label} onClick={action.run}>
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
