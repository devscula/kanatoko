import type { Edition } from '../../../data/types.ts'
import type { Problem } from '../../../engine/index.ts'
import { DropdownSheet as Sheet } from '../../components/base/DropdownSheet.tsx'
import { itemText, msg, type Text } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import type { DisplayStep } from '../../plan/displayPlan.ts'
import { usesHowOf } from '../../plan/labels.ts'
import type { SolveOutcome } from '../../solver/types.ts'
import { useSolveView } from '../../solver/useSolveResult.ts'
import { useAppStore } from '../../state/store.ts'
import { RenameCostHelper } from '../input/RenameCostHelper.tsx'
import { useReadOnly } from '../shell/readOnly.ts'
import styles from './MismatchSheet.module.css'
import { mismatchKeys } from './model.ts'

export interface MismatchSheetProps {
  /** Null when closed */
  readonly step: DisplayStep | null
  readonly mode: Problem['mode']
  readonly edition: Edition
  onClose(): void
}

function priorWorkText(outcome: SolveOutcome | null): Text {
  if (outcome?.kind !== 'result') return msg('mismatch.priorWork', { item: itemText('enchanted_book'), n: 0, how: msg('assume.how.fresh') })
  const problem = outcome.problem
  const target = problem.mode === 'advanced' ? problem.target : null
  const item = target?.itemType ?? (problem.mode === 'simple' ? problem.item : 'enchanted_book')
  const n = target?.anvilUses ?? 0
  const fresh = n === 0 && Object.keys(target?.enchantments ?? {}).length === 0
  const how = fresh ? msg('assume.how.fresh') : msg(`assume.how.${usesHowOf(outcome.input)}`)
  return msg('mismatch.priorWork', { item: itemText(item), n, how })
}

export function MismatchSheet({ step, mode, edition, onClose }: MismatchSheetProps) {
  const { t, text } = useT()
  const outcome = useSolveView((view) => view.outcome)
  const item = useAppStore((s) => s.input.item)
  const setOverride = useAppStore((s) => s.setAnvilUsesOverride)
  const { readOnly, redirect } = useReadOnly()
  // Merging books has no anvil uses field for an item, so there is nothing to work out
  const helper =
    item !== null && item !== 'enchanted_book' ? (
      <RenameCostHelper
        edition={edition}
        readOnly={readOnly}
        onReadOnlyActivate={redirect}
        onApply={(uses) => {
          setOverride(uses, { toast: true })
          // The steps are recalculated, so the step this sheet was for is gone
          onClose()
        }}
      />
    ) : null
  return (
    <Sheet open={step !== null} onClose={onClose} width="narrow" title={step === null ? '' : t('mismatch.title', { c: step.cost.total })}>
      {step !== null && (
        <div className={styles.body}>
          <p className={styles.lead}>{t('mismatch.lead')}</p>
          <ol className={styles.items}>
            {mismatchKeys(step, mode, edition).map((key, index) => (
              <li key={key} className={styles.item}>
                <span className={styles.no} aria-hidden="true">
                  {index + 1}
                </span>
                {key === 'mismatch.priorWork' ? (
                  <div>
                    {text(priorWorkText(outcome))}
                    {helper}
                  </div>
                ) : (
                  <span>{t(key)}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Sheet>
  )
}
