import { Checkbox } from '../../components/base/Checkbox.tsx'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { useT } from '../../i18n/useT.ts'
import { renameStepOf } from '../../plan/displayPlan.ts'
import { useDisplayPlan } from '../../plan/useDisplayPlan.ts'
import { useSolveView } from '../../solver/useSolveResult.ts'
import { useSolveInput } from '../../state/selectors.ts'
import { useAppStore } from '../../state/store.ts'
import { INPUT_IDS } from './ids.ts'
import styles from './Input.module.css'

export interface RenameToggleProps {
  readonly checked: boolean
  readonly readOnly: boolean
  readonly redirect: () => void
}

/** null until a result for the current input is shown, so a stale step number never appears while solving. */
function useRenameStep(enabled: boolean): number | null {
  const outcome = useSolveView((view) => view.outcome)
  const { plan } = useDisplayPlan(outcome)
  const current = useSolveInput()
  if (!enabled || plan === null || outcome?.kind !== 'result') return null
  if (current.kind !== 'ready' || current.planId !== outcome.planId) return null
  return renameStepOf(plan)
}

export function RenameToggle({ checked, readOnly, redirect }: RenameToggleProps) {
  const { t } = useT()
  const setRename = useAppStore((s) => s.setRename)
  const step = useRenameStep(checked)
  return (
    <Checkbox
      id={INPUT_IDS.rename}
      checked={checked}
      onChange={setRename}
      label={
        <span className={styles.iconLabel}>
          <PixelIcon name="name-tag" size={16} />
          {t('rename.toggle')}
        </span>
      }
      description={step === null ? undefined : t('rename.where', { n: step })}
      readOnly={readOnly}
      onReadOnlyActivate={redirect}
    />
  )
}
