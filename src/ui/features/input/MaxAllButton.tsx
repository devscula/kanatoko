import { useMemo } from 'react'
import type { Edition } from '../../../data/types.ts'
import { Button } from '../../components/base/Button.tsx'
import { canMaxAll, planMaxAll } from '../../data/enchantmentGroups.ts'
import { useT } from '../../i18n/useT.ts'
import { useAppStore } from '../../state/store.ts'
import type { InputState } from '../../state/types.ts'
import { focusFirstPickedGroup } from './focus.ts'
import { INPUT_IDS } from './ids.ts'

export interface MaxAllButtonProps {
  readonly input: InputState
  readonly edition: Edition
  readonly readOnly: boolean
  readonly redirect: () => void
  readonly className?: string
}

export function MaxAllButton({ input, edition, readOnly, redirect, className }: MaxAllButtonProps) {
  const { t } = useT()
  const selectAllMax = useAppStore((s) => s.selectAllMax)
  const done = useMemo(() => !planMaxAll(input, edition).changed, [input, edition])
  if (!canMaxAll(edition, input.item)) return null

  return (
    <div className={className}>
      <Button
        variant="secondary"
        icon="max-all"
        block
        // aria-disabled rather than disabled while read-only, so a click still reaches redirect()
        softDisabled={done && !readOnly}
        {...(readOnly ? { 'aria-disabled': true } : {})}
        aria-describedby={done ? INPUT_IDS.maxAllDone : undefined}
        onClick={() => (readOnly ? redirect() : selectAllMax({ onChange: focusFirstPickedGroup }))}
      >
        {t('maxAll')}
      </Button>
      {done && (
        <span id={INPUT_IDS.maxAllDone} className="visually-hidden">
          {t('maxAll.done')}
        </span>
      )}
    </div>
  )
}
