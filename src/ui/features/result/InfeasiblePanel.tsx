import { pwp } from '../../../engine/index.ts'
import type { FailureReason, Problem, Settings, SolveInfeasible } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { describeFailureReason } from '../../i18n/engineCodes.ts'
import { fillSlots, SLOT_MARK } from '../../i18n/fillSlots.tsx'
import { itemText } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { problemInputLabel, targetItemOf } from '../../plan/displayPlan.ts'
import { infeasibleTitleKey } from '../../solver/infeasibleTitle.ts'
import styles from './InfeasiblePanel.module.css'
import { LEVEL_CAP } from './model.ts'
import { ReferenceSteps } from './ReferenceSteps.tsx'
import { ANCHOR_HEADING_ATTR } from './resultAnchor.ts'
import type { UsesHow } from '../../plan/labels.ts'
import type { ExtraSuggestions } from '../../solver/types.ts'
import { sortSuggestions, suggestionButton, suggestionTitle, type ShownSuggestion } from './suggestions.ts'

type TooExpensiveReason = Extract<FailureReason, { readonly code: 'too-expensive' }>

const TARGET_PENALTY_NOTE_FROM = 15

export interface InfeasiblePanelProps {
  readonly result: SolveInfeasible
  readonly problem: Problem
  readonly settings: Settings
  readonly stale: boolean
  onApply(suggestion: ShownSuggestion): void
  onCreative(): void
  /** Null when only merging books */
  readonly uses?: { readonly n: number; readonly how: UsesHow } | null
  onCheckUses?(): void
  /** Suggestions found by solving again in the UI, for advanced problems only */
  readonly extra?: ExtraSuggestions | null
  readonly anchorRef?: (el: HTMLElement | null) => (() => void) | undefined
}

// The warning icon keeps color from being the only cue for a step over the limit
function SuggestionCost({ total, max }: { readonly total: number; readonly max: number }) {
  const { t, num } = useT()
  const over = max > LEVEL_CAP
  return (
    <p className={styles.cost}>
      {fillSlots(t('infeasible.suggestionCost', { t: SLOT_MARK, m: SLOT_MARK }), [
        <span key="t">{num(total)}</span>,
        <span key="m" className={styles.costMax} data-over={over || undefined}>
          {over && <PixelIcon name="warning" size={16} className={styles.costWarn} />}
          {num(max)}
        </span>,
      ])}
    </p>
  )
}

export function InfeasiblePanel({ result, problem, settings, stale, onApply, onCreative, anchorRef, uses = null, onCheckUses, extra = null }: InfeasiblePanelProps) {
  const { t, text } = useT()
  const itemType = targetItemOf(problem)
  const reasonContext = { edition: settings.edition, itemType, inputLabel: (input: number) => problemInputLabel(problem, input) }
  const target = problem.mode === 'advanced' ? problem.target : null
  const targetPenalty = target === null ? 0 : pwp(target.anvilUses)
  const tooExpensive = result.reasons.find((r): r is TooExpensiveReason => r.code === 'too-expensive')
  const suggestions = sortSuggestions([...result.suggestions, ...(extra?.items ?? [])])
  const checking = extra?.checking ?? false
  const complete = result.suggestionsComplete && (extra?.complete ?? true)
  const noEffect = result.warnings.some((w) => w.code === 'bedrock-unverified-value' && w.detail === 'no-effect-refused')

  return (
    <div className={styles.infeasible}>
      <section ref={anchorRef} className={styles.panel} aria-labelledby="infeasible-title">
        <h3 id="infeasible-title" className={styles.title} tabIndex={-1} {...{ [ANCHOR_HEADING_ATTR]: '' }}>
          <PixelIcon name="warning" size={16} className={styles.icon} />
          <span>{t(infeasibleTitleKey(result))}</span>
        </h3>
        <div className={styles.reasons}>
          {result.reasons.map((reason, index) => (
            <p key={`${reason.code}-${index}`}>{text(describeFailureReason(reason, reasonContext))}</p>
          ))}
          {target !== null && settings.levelCap !== null && targetPenalty >= TARGET_PENALTY_NOTE_FROM && (
            <p>
              {t('infeasible.targetPenalty', { item: itemText(target.itemType), p: targetPenalty, x: Math.max(0, LEVEL_CAP - targetPenalty) })}
            </p>
          )}
          {noEffect && <p>{t('warning.noEffectBedrock')}</p>}
          {uses !== null && (
            <p>
              {uses.how === 'entered' ? t('infeasible.usesEntered', { n: uses.n }) : t('infeasible.usesAuto', { n: uses.n })}
            </p>
          )}
        </div>
        {uses !== null && onCheckUses !== undefined && (
          <div className={styles.checkUses}>
            <Button icon="pwp" onClick={onCheckUses}>
              {t('infeasible.checkUses')}
            </Button>
          </div>
        )}
      </section>

      <section className={styles.suggestions} aria-labelledby="infeasible-suggestions">
        <h3 id="infeasible-suggestions" className={styles.subTitle}>
          <PixelIcon name="route" size={16} />
          <span>{t('infeasible.suggestions')}</span>
        </h3>
        {suggestions.length === 0 && !checking && (
          // Claim that removing one is not enough only when every candidate was checked
          <p className={styles.none}>{t(complete ? 'infeasible.noSuggestion' : 'infeasible.suggestionsUnchecked')}</p>
        )}
        {(suggestions.length > 0 || tooExpensive !== undefined) && (
          <ul className={styles.list}>
            {suggestions.map((suggestion, index) => (
              <li key={`${suggestion.code}-${index}`} className={styles.suggestion}>
                <div className={styles.suggestionText}>
                  <p className={styles.suggestionTitle}>{text(suggestionTitle(suggestion, problem))}</p>
                  <SuggestionCost total={suggestion.totalLevels} max={suggestion.maxStepLevels} />
                </div>
                <Button icon="minus" softDisabled={stale} onClick={() => onApply(suggestion)}>
                  {text(suggestionButton(suggestion))}
                </Button>
              </li>
            ))}
            {tooExpensive !== undefined && (
              <li className={styles.suggestion}>
                <div className={styles.suggestionText}>
                  <p className={styles.suggestionTitle}>{t('sug.creative')}</p>
                  <SuggestionCost total={tooExpensive.uncappedTotal} max={tooExpensive.uncappedMaxStep} />
                </div>
                <Button icon="infinity" softDisabled={stale} onClick={onCreative}>
                  {t('sug.creative.button')}
                </Button>
              </li>
            )}
          </ul>
        )}
        {checking && <p className={styles.none}>{t('sug.checking')}</p>}
      </section>

      {result.reference !== null && <ReferenceSteps reference={result.reference} problem={problem} settings={settings} />}
    </div>
  )
}
