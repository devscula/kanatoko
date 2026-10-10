import { useId, useState } from 'react'
import type { Edition } from '../../../data/types.ts'
import { pwp } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { Disclosure } from '../../components/base/Disclosure.tsx'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { judgeRenameCost } from './model.ts'
import styles from './RenameCostHelper.module.css'

/** Uses past 6 cannot be told apart (a capped rename cost only says "6 or more"), so 6 is applied. */
const SIX_OR_MORE = 6

export interface RenameCostHelperProps {
  readonly edition: Edition
  onApply(uses: number): void
  readonly readOnly?: boolean
  onReadOnlyActivate?(): void
}

export function RenameCostHelper({ edition, onApply, readOnly = false, onReadOnlyActivate }: RenameCostHelperProps) {
  const { t } = useT()
  const inputId = useId()
  const [raw, setRaw] = useState('')
  const [bedrockTooExpensive, setBedrockTooExpensive] = useState(false)
  const verdict = judgeRenameCost(raw, edition)

  const apply = (uses: number) => {
    if (readOnly) {
      onReadOnlyActivate?.()
      return
    }
    onApply(uses)
  }

  let result = null
  if (bedrockTooExpensive && edition === 'bedrock' && verdict.kind === 'empty') {
    result = (
      <>
        <p>{t('uses.help.six')}</p>
        <Button onClick={() => apply(SIX_OR_MORE)}>{t('uses.help.apply6')}</Button>
      </>
    )
  } else if (verdict.kind === 'uses') {
    result = (
      <>
        <p>{t('uses.label', { n: verdict.uses, p: pwp(verdict.uses) })}</p>
        <Button onClick={() => apply(verdict.uses)}>{t('uses.help.apply')}</Button>
      </>
    )
  } else if (verdict.kind === 'sixOrMore') {
    result = (
      <>
        <p>{t('uses.help.java39')}</p>
        <Button onClick={() => apply(SIX_OR_MORE)}>{t('uses.help.apply6')}</Button>
      </>
    )
  } else if (verdict.kind === 'invalid') {
    result = (
      <p className={styles.invalid}>
        <PixelIcon name="warning" size={16} className={styles.mark} />
        <span>{t('uses.help.invalid')}</span>
      </p>
    )
  }

  return (
    <Disclosure
      summary={
        <span className={styles.summary}>
          <PixelIcon name="name-tag" size={16} />
          {t('uses.help.open')}
        </span>
      }
      className={styles.helper}
    >
      <div className={styles.body}>
        <ul className={styles.notes}>
          <li>{t('uses.help.zero')}</li>
          <li>{t('uses.help.rename')}</li>
          {edition === 'java' && <li>{t('uses.help.netherite')}</li>}
          {edition === 'java' && <li>{t('uses.help.grindstone')}</li>}
        </ul>
        <div className={styles.field}>
          <label htmlFor={inputId} className={styles.label}>
            {t('uses.help.input')}
          </label>
          <span className={styles.inputRow}>
            <input
              id={inputId}
              className={styles.input}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={3}
              value={raw}
              onChange={(event) => {
                setRaw(event.target.value)
                setBedrockTooExpensive(false)
              }}
            />
            <span className={styles.unit} aria-hidden="true">
              {/* 0 gives the English plural while the field holds no number */}
              {t('summary.levelUnitFor', { n: /^\d+$/.test(raw) ? Number(raw) : 0 })}
            </span>
          </span>
        </div>
        {edition === 'bedrock' && (
          <Button
            variant="ghost"
            className={styles.bedrockButton}
            onClick={() => {
              setRaw('')
              setBedrockTooExpensive(true)
            }}
          >
            {t('uses.help.bedrockTooExpensive')}
          </Button>
        )}
        <div className={styles.result} aria-live="polite">
          {result}
        </div>
        {edition === 'bedrock' && <p className={styles.bedrockNote}>{t('uses.help.bedrock')}</p>}
      </div>
    </Disclosure>
  )
}
