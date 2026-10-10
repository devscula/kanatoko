import { useId } from 'react'
import type { Edition } from '../../../data/types.ts'
import { SegmentedControl } from '../../components/base/SegmentedControl.tsx'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { selectActiveEdition } from '../../state/selectors.ts'
import { useAppStore } from '../../state/store.ts'
import styles from './EditionSwitch.module.css'
import { useReadOnly } from './readOnly.ts'

export interface EditionSwitchProps {
  /** select uses the short names, since "Java Edition" in English leaves the narrow header's app name too little room */
  readonly form: 'select' | 'segmented'
  readonly labelledBy?: string
  readonly block?: boolean
  readonly id?: string
}

export function EditionSwitch({ form, labelledBy, block = false, id }: EditionSwitchProps) {
  const { t } = useT()
  const edition = useAppStore(selectActiveEdition)
  const setEdition = useAppStore((s) => s.setEdition)
  const { readOnly, redirect } = useReadOnly()
  const selectId = useId()

  if (form === 'segmented') {
    return (
      <SegmentedControl<Edition>
        id={id}
        options={[
          { value: 'java', label: t('edition.java') },
          { value: 'bedrock', label: t('edition.bedrock') },
        ]}
        value={edition}
        onChange={setEdition}
        label={labelledBy === undefined ? t('header.edition') : undefined}
        labelledBy={labelledBy}
        readOnly={readOnly}
        onReadOnlyActivate={redirect}
        block={block}
      />
    )
  }

  return (
    <div className={styles.selectWrap}>
      <label htmlFor={selectId} className="visually-hidden">
        {t('header.edition')}
      </label>
      <select
        id={selectId}
        className={styles.select}
        value={edition}
        aria-disabled={readOnly || undefined}
        onMouseDown={(event) => {
          if (!readOnly) return
          event.preventDefault()
          redirect()
        }}
        onKeyDown={(event) => {
          if (!readOnly || event.key === 'Tab') return
          event.preventDefault()
          redirect()
        }}
        onChange={(event) => {
          if (!readOnly) setEdition(event.target.value as Edition)
        }}
      >
        <option value="java">{t('edition.javaShort')}</option>
        <option value="bedrock">{t('edition.bedrockShort')}</option>
      </select>
      <PixelIcon name="chevron-right" size={16} className={styles.chevron} />
    </div>
  )
}
