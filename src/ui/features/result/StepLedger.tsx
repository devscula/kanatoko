import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Edition } from '../../../data/types.ts'
import { pwp, type ObjectState, type Plan, type Problem } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { MEDIA, useMediaQuery } from '../../components/base/useMediaQuery.ts'
import { listSeparator } from '../../i18n/render.ts'
import { itemText, listText, type Text } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { ItemImage } from '../../icons/ItemImage.tsx'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { Slot } from '../../icons/Slot.tsx'
import type { DisplayPlan, DisplayStep, SlotView } from '../../plan/displayPlan.ts'
import { CapGauge } from './CapGauge.tsx'
import { CostBreakdown } from './CostBreakdown.tsx'
import { MatchLine } from './MatchLine.tsx'
import { MismatchSheet } from './MismatchSheet.tsx'
import { isFinalStep, showsGauge, STEP_ID_PREFIX, stepAfter, stepCardId } from './model.ts'
import { rowContent, rowTitle } from './ledgerText.ts'
import styles from './StepLedger.module.css'

const TOOLTIP_DELAY_MS = 300

interface TipState {
  readonly slot: SlotView
  readonly made: number | null
  readonly used: readonly number[]
  readonly x: number
  readonly y: number
}

/** Display numbers of the steps that make and use what is in the slot */
function slotUsage(plan: DisplayPlan, step: DisplayStep, part: 'left' | 'right' | 'result'): { made: number | null; used: number[] } {
  if (part === 'result') {
    const next = plan.steps.find((s) => s.no > step.no && (s.left.label === step.result.label || s.right?.label === step.result.label))
    return { made: step.no, used: next === undefined ? [] : [next.no] }
  }
  const slot = part === 'left' ? step.left : step.right
  if (slot === null) return { made: null, used: [] }
  if (slot.source !== null) {
    const used = plan.steps.filter((s) => (s.left.source !== null && s.left.fullLabel === slot.fullLabel) || (s.right?.source !== null && s.right?.fullLabel === slot.fullLabel)).map((s) => s.no)
    return { made: null, used: used.length > 0 ? used : [step.no] }
  }
  const maker = plan.steps.find((s) => s.no < step.no && s.result.label === slot.label && s.result.letter === slot.letter)
  return { made: maker?.no ?? null, used: [step.no] }
}

function SlotTooltip({ tip, onLeave, onEnter }: { readonly tip: TipState; onLeave(): void; onEnter(): void }) {
  const { t, text, lang } = useT()
  const { slot } = tip
  const origin =
    slot.source === null ? null : slot.source.kind === 'supplement' ? t('tip.get') : slot.source.kind === 'owned' ? t('tip.owned') : null
  return createPortal(
    <div
      className={styles.tooltip}
      style={{ left: tip.x, top: tip.y }}
      aria-hidden="true"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      data-slot-tooltip=""
    >
      <p className={styles.tipTitle}>
        <ItemImage item={slot.item} size={32} enchanted={slot.enchanted} book={slot.contents} />
        <span>{text(slot.label)}</span>
      </p>
      {slot.detail !== null && <p className={styles.tipText}>{text(slot.detail)}</p>}
      <p className={styles.tipPwp}>{t('tip.uses', { n: slot.anvilUses, p: pwp(slot.anvilUses) })}</p>
      {origin !== null && <p className={styles.tipMuted}>{origin}</p>}
      {(tip.made !== null || tip.used.length > 0) && (
        <p className={styles.tipMuted}>
          {[
            tip.made !== null ? t('tip.made', { n: tip.made }) : null,
            tip.used.length > 0 ? t('tip.used', { list: listText(tip.used), k: tip.used.length }) : null,
          ]
            .filter(Boolean)
            .join(listSeparator(lang, 'dot'))}
        </p>
      )}
    </div>,
    document.body,
  )
}

// Stays open while the pointer is on the slot or the tooltip and closes on Esc, as WCAG 1.4.13 asks
function useSlotTooltip(enabled: boolean) {
  const [tip, setTip] = useState<TipState | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => {
    if (showTimer.current !== null) clearTimeout(showTimer.current)
    if (hideTimer.current !== null) clearTimeout(hideTimer.current)
    showTimer.current = null
    hideTimer.current = null
  }
  useEffect(() => {
    if (tip === null) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setTip(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tip])
  useEffect(() => clear, [])
  const enter = (event: ReactPointerEvent<HTMLElement>, make: () => Omit<TipState, 'x' | 'y'>) => {
    if (!enabled || event.pointerType === 'touch') return
    clear()
    const rect = event.currentTarget.getBoundingClientRect()
    showTimer.current = setTimeout(() => {
      const width = 280
      const x = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      const y = rect.bottom + 6
      setTip({ ...make(), x, y })
    }, TOOLTIP_DELAY_MS)
  }
  const leave = () => {
    if (showTimer.current !== null) clearTimeout(showTimer.current)
    showTimer.current = null
    hideTimer.current = setTimeout(() => setTip(null), 120)
  }
  const keep = () => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }
  return { tip, enter, leave, keep }
}

// Input books (no letter) go by their contents alone, merged books by their letter plus contents
function operandText(
  plan: DisplayPlan,
  step: DisplayStep,
  slot: SlotView,
  part: 'left' | 'right' | 'result',
  text: (value: Text) => string,
): { main: string; sub: string | null } {
  if (slot.item === 'enchanted_book') {
    if (slot.letter === null) return { main: text(slot.detail ?? slot.label), sub: null }
    return { main: text(slot.label), sub: slot.detail === null ? null : text(slot.detail) }
  }
  if (part === 'result' && isFinalStep(plan, step)) return { main: text(slot.label), sub: null }
  return { main: text(itemText(slot.item)), sub: slot.letter === null ? null : text(slot.label) }
}

interface StepChecksProps {
  readonly step: DisplayStep
  readonly edition: Edition
  readonly after: ObjectState | null
  onOpenMismatch(): void
}

// The same checks a step card shows below its slots
function StepChecks({ step, edition, after, onOpenMismatch }: StepChecksProps) {
  const { t } = useT()
  return (
    <>
      {step.renameHere && (
        <p className={styles.note}>
          <PixelIcon name="name-tag" size={16} className={styles.noteIcon} />
          <span>{t('step.renameHere')}</span>
        </p>
      )}
      {step.tooExpensive && (
        <p className={`${styles.note} ${styles.overCap}`}>
          <PixelIcon name="warning" size={16} className={styles.noteIcon} />
          <span>{t('step.overCap')}</span>
        </p>
      )}
      {step.warnings.includes('bedrock-unverified-value') && (
        <p className={styles.note}>
          <PixelIcon name="info" size={16} className={styles.noteIcon} />
          <span>{t('warning.loyaltyBedrock')}</span>
        </p>
      )}
      <MatchLine edition={edition} cost={step.cost.total} className={styles.match} />
      <CostBreakdown step={step} edition={edition} after={after} />
      <div className={styles.checkActions}>
        <Button variant="ghost" onClick={onOpenMismatch}>
          {t('step.mismatch')}
        </Button>
      </div>
    </>
  )
}

export interface StepLedgerProps {
  readonly plan: DisplayPlan
  /** For the resulting prior work penalty in the breakdown */
  readonly enginePlan: Plan
  readonly mode: Problem['mode']
  readonly edition: Edition
  readonly stale: boolean
}

export function StepLedger({ plan, enginePlan, mode, edition, stale }: StepLedgerProps) {
  const { t, text, num, lang } = useT()
  const fine = useMediaQuery(MEDIA.finePointer)
  const { tip, enter, leave, keep } = useSlotTooltip(fine)
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set())
  const [mismatch, setMismatch] = useState<DisplayStep | null>(null)
  // Step numbers mean different steps in a new plan, so the open checks and the mismatch sheet are reset here; the
  // result panel is not remounted per result
  const [shownPlanId, setShownPlanId] = useState(plan.planId)
  if (shownPlanId !== plan.planId) {
    setShownPlanId(plan.planId)
    setOpen(new Set())
    setMismatch(null)
  }
  const toggle = (no: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(no)) next.delete(no)
      else next.add(no)
      return next
    })
  // The step number button handles its own presses, and selecting text in a row must not toggle it
  const onRowClick = (event: ReactMouseEvent<HTMLElement>, no: number) => {
    if (event.target instanceof Element && event.target.closest('button, a') !== null) return
    if (window.getSelection()?.isCollapsed === false) return
    toggle(no)
  }

  const operand = (step: DisplayStep, part: 'left' | 'right' | 'result') => {
    const slot = part === 'left' ? step.left : part === 'right' ? step.right : step.result
    if (slot === null) return null
    const { main, sub } = operandText(plan, step, slot, part, text)
    return (
      <span className={styles.operand} data-part={part}>
        <span
          className={styles.slotCell}
          aria-hidden="true"
          onPointerEnter={(event) => enter(event, () => ({ slot, ...slotUsage(plan, step, part) }))}
          onPointerLeave={leave}
        >
          <Slot size={36} item={slot.item} enchanted={slot.enchanted} book={slot.contents} letter={slot.letter} />
        </span>
        <span className={styles.opText}>
          <span className={styles.opMain}>{main}</span>
          {sub !== null && <span className={styles.opSub}>{sub}</span>}
        </span>
      </span>
    )
  }

  return (
    <div className={styles.ledger}>
      <ol className={styles.rows}>
        {plan.steps.map((step) => {
          const title = text(rowTitle(plan, step))
          const content = rowContent(step, lang, text)
          // e.g. "Step 1 Apply a book to the Boots: Boots + Thorns III = Boots"
          const spokenPart = (part: 'left' | 'right' | 'result') => {
            const slot = part === 'left' ? step.left : part === 'right' ? step.right : step.result
            if (slot === null) return null
            const { main, sub } = operandText(plan, step, slot, part, text)
            return sub === null ? main : t('label.withDetail', { label: main, detail: sub })
          }
          const formulaName = [
            `${t('ledger.stepLabel', { n: step.no })} ${title}:`,
            spokenPart('left'),
            ...(step.right === null ? [] : [lang === 'ja' ? '＋' : '+', spokenPart('right')]),
            lang === 'ja' ? '＝' : '=',
            spokenPart('result'),
          ]
            .filter((part) => part !== null)
            .join(' ')
          const expanded = open.has(step.no)
          const checksId = `${stepCardId(STEP_ID_PREFIX, step.no)}-checks`
          return (
            <li
              key={step.no}
              id={stepCardId(STEP_ID_PREFIX, step.no)}
              className={styles.item}
              data-stale={stale || undefined}
              data-over={step.tooExpensive || undefined}
              data-open={expanded || undefined}
            >
              <div className={styles.row} title={`${title}\n${content}`} onClick={(event) => onRowClick(event, step.no)}>
                <button
                  type="button"
                  className={styles.no}
                  aria-expanded={expanded}
                  aria-controls={checksId}
                  aria-label={t('ledger.checks', { n: step.no })}
                  onClick={() => toggle(step.no)}
                >
                  <span className={styles.noValue}>{step.no}</span>
                  <PixelIcon name="chevron-right" size={16} className={styles.chevron} />
                </button>
                <div className={styles.formula} role="group" aria-label={formulaName} tabIndex={-1} data-step-title="">
                  {/* Always five cells, so the icons line up across rows */}
                  {operand(step, 'left')}
                  <span className={styles.op} aria-hidden="true">
                    {step.right !== null ? '＋' : ''}
                  </span>
                  {step.right !== null ? operand(step, 'right') : <span className={styles.operand} data-part="right" />}
                  <span className={`${styles.op} ${styles.opEq}`} aria-hidden="true">＝</span>
                  {operand(step, 'result')}
                </div>
                <span className={styles.cost}>
                  {step.tooExpensive && <PixelIcon name="warning" size={16} className={styles.costWarn} />}
                  <span className={styles.costValue}>{num(step.cost.total)}</span>
                  <span className={styles.unit}>{t('summary.levelUnitFor', { n: step.cost.total })}</span>
                  {showsGauge(step) && <CapGauge cost={step.cost.total} meterOnly className={styles.gauge} />}
                </span>
              </div>
              <div id={checksId} className={styles.checks} hidden={!expanded}>
                {expanded && (
                  <StepChecks step={step} edition={edition} after={stepAfter(enginePlan, step)} onOpenMismatch={() => setMismatch(step)} />
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {tip !== null && <SlotTooltip tip={tip} onLeave={leave} onEnter={keep} />}
      <MismatchSheet step={mismatch} mode={mode} edition={edition} onClose={() => setMismatch(null)} />
    </div>
  )
}
