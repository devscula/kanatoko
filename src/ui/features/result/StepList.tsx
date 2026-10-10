import { useState } from 'react'
import type { Edition } from '../../../data/types.ts'
import type { Plan, Problem } from '../../../engine/index.ts'
import type { DisplayPlan, DisplayStep } from '../../plan/displayPlan.ts'
import { MismatchSheet } from './MismatchSheet.tsx'
import { STEP_ID_PREFIX, stepAfter, stepCardId } from './model.ts'
import { StepCard } from './StepCard.tsx'
import styles from './StepList.module.css'

export interface StepListProps {
  readonly plan: DisplayPlan
  /** For the resulting prior work penalty in the breakdown */
  readonly enginePlan: Plan
  readonly mode: Problem['mode']
  readonly edition: Edition
  /** Steps calculated with no level limit, shown for reference */
  readonly reference?: boolean
  readonly stale: boolean
  /** Reference steps need a different prefix so their ids do not collide with the list's */
  readonly idPrefix?: string
}

export function StepList({ plan, enginePlan, mode, edition, reference = false, stale, idPrefix = STEP_ID_PREFIX }: StepListProps) {
  const [mismatch, setMismatch] = useState<DisplayStep | null>(null)
  // Step numbers mean different steps in a new plan, so the mismatch sheet is closed here; the result panel is not
  // remounted per result
  const [shownPlanId, setShownPlanId] = useState(plan.planId)
  if (shownPlanId !== plan.planId) {
    setShownPlanId(plan.planId)
    setMismatch(null)
  }

  return (
    <div className={styles.list}>
      <ol className={styles.steps}>
        {plan.steps.map((step) => (
          <li key={step.no} id={stepCardId(idPrefix, step.no)} className={styles.item}>
            <StepCard
              step={step}
              stale={stale}
              edition={edition}
              after={stepAfter(enginePlan, step)}
              reference={reference}
              slotSize={72}
              idPrefix={idPrefix}
              onOpenMismatch={() => setMismatch(step)}
            />
          </li>
        ))}
      </ol>
      <MismatchSheet step={mismatch} mode={mode} edition={edition} onClose={() => setMismatch(null)} />
    </div>
  )
}
