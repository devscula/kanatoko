import { useMemo } from 'react'
import type { Problem, ReferencePlan, Settings } from '../../../engine/index.ts'
import { Disclosure } from '../../components/base/Disclosure.tsx'
import { useT } from '../../i18n/useT.ts'
import { displayPlanFromReference } from '../../plan/displayPlan.ts'
import styles from './ReferenceSteps.module.css'
import { StepList } from './StepList.tsx'

export interface ReferenceStepsProps {
  readonly reference: ReferencePlan
  readonly problem: Problem
  readonly settings: Settings
}

export function ReferenceSteps({ reference, problem, settings }: ReferenceStepsProps) {
  const { t } = useT()
  const plan = useMemo(() => displayPlanFromReference(reference, problem, settings), [reference, problem, settings])
  return (
    <Disclosure summary={t('reference.toggle')} className={styles.reference}>
      <div className={styles.body}>
        <p className={styles.note}>{t('reference.note')}</p>
        <StepList
          plan={plan}
          enginePlan={reference.plan}
          mode={problem.mode}
          edition={settings.edition}
          reference
          stale={false}
          idPrefix="ref-step"
        />
      </div>
    </Disclosure>
  )
}
