import { useRef, useState, type ReactNode } from 'react'
import type { Edition } from '../../../data/types.ts'
import type { Objective, Settings } from '../../../engine/index.ts'
import { useShallow } from 'zustand/react/shallow'
import { AnchoredPopover } from '../../components/base/AnchoredPopover.tsx'
import { InfoTip } from '../../components/base/InfoTip.tsx'
import { DropdownSheet as Sheet } from '../../components/base/DropdownSheet.tsx'
import type { MessageKey } from '../../i18n/messages/index.ts'
import { editionVersionName, gameModeName, objectiveName } from '../../i18n/settingNames.ts'
import { useT } from '../../i18n/useT.ts'
import type { Text } from '../../i18n/text.ts'
import type { IconKey } from '../../icons/iconKeys.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { useAppStore } from '../../state/store.ts'
import { INPUT_IDS } from '../input/ids.ts'
import { inputColumn } from '../shell/inputColumn.ts'
import styles from './ConditionChips.module.css'

const BEDROCK_RULE_KEYS = [
  'bedrockRules.cost',
  'bedrockRules.conflict',
  'bedrockRules.partial',
  'bedrockRules.data',
  'bedrockRules.cap',
  'bedrockRules.noEffect',
  'bedrockRules.loyalty',
  'bedrockRules.ui',
] as const satisfies readonly MessageKey[]

function focusRenameToggle(): void {
  const column = inputColumn()
  const toggle =
    document.getElementById(INPUT_IDS.rename) ??
    (column === null ? null : Array.from(column.querySelectorAll<HTMLElement>('input[type="checkbox"]')).pop() ?? null)
  if (toggle === null || toggle === undefined) return
  toggle.scrollIntoView({ block: 'center' })
  toggle.focus({ preventScroll: true })
}

export interface ConditionChipsProps {
  readonly settings: Settings
  readonly children?: ReactNode
}

interface ChoiceChipProps<V extends string | number | null> {
  readonly locked: boolean
  readonly label: string
  readonly icon: IconKey
  readonly title: string
  readonly value: V
  readonly options: readonly { readonly value: V; readonly label: string; readonly icon: IconKey; readonly note?: string }[]
  onChange(value: V): void
}

function ChoiceChip<V extends string | number | null>({ locked, label, icon, title, value, options, onChange }: ChoiceChipProps<V>) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)
  return (
    <li>
      <button
        ref={ref}
        type="button"
        className={styles.chip}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('chip.sr', { label })}
        onClick={() => setOpen((v) => !v)}
      >
        <PixelIcon name={icon} size={16} />
        {label}
        <PixelIcon name="chevron-right" size={16} className={styles.caret} />
      </button>
      <AnchoredPopover anchor={ref} open={open} onClose={close} label={title} variant="menu" className={styles.choiceMenu}>
        <p className={styles.choiceTitle}>{title}</p>
        {locked && <p className={styles.choiceLocked}>{t('banner.shared.locked')}</p>}
        <ul className={styles.choices} role="radiogroup" aria-label={title}>
          {options.map((option) => (
            <li key={String(option.value)}>
              <button
                type="button"
                role="radio"
                aria-checked={option.value === value}
                className={styles.choice}
                disabled={locked}
                data-autofocus={option.value === value || undefined}
                onClick={() => {
                  close()
                  ref.current?.focus()
                  if (option.value !== value) onChange(option.value)
                }}
              >
                <span className={styles.choiceMark} aria-hidden="true">
                  {option.value === value && <PixelIcon name="check" size={16} />}
                </span>
                <PixelIcon name={option.icon} size={16} />
                <span className={styles.choiceText}>
                  <span>{option.label}</span>
                  {option.note !== undefined && <span className={styles.choiceNote}>{option.note}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </AnchoredPopover>
    </li>
  )
}

export function ConditionChips({ settings, children }: ConditionChipsProps) {
  const { t, text } = useT()
  const actions = useAppStore(
    useShallow((s) => ({ setLevelCap: s.setLevelCap, setEdition: s.setEdition, setObjective: s.setObjective })),
  )
  const readOnly = useAppStore((s) => s.share.active)
  // Labels show what the displayed result was calculated with, but the check follows the saved settings, so a choice
  // made before the calculation finishes already shows as picked
  const current = useAppStore(useShallow((s) => ({ levelCap: s.session.levelCap, edition: s.session.edition, objective: s.session.objective })))
  return (
    <ul className={styles.chips}>
      <ChoiceChip<39 | null>
        label={text(gameModeName(settings.levelCap))}
        icon={settings.levelCap === null ? 'infinity' : 'limit'}
        title={t('settings.gameMode')}
        locked={readOnly}
        value={current.levelCap}
        options={[
          { value: 39, label: t('settings.survival'), icon: 'limit' },
          { value: null, label: t('settings.creative'), icon: 'infinity' },
        ]}
        onChange={(v) => actions.setLevelCap(v, { toast: true })}
      />
      <ChoiceChip<Edition>
        label={text(editionVersionName(settings.edition))}
        icon="edition"
        title={t('settings.edition')}
        locked={readOnly}
        value={current.edition}
        options={[
          { value: 'java', label: text(editionVersionName('java')), icon: 'edition' },
          { value: 'bedrock', label: text(editionVersionName('bedrock')), icon: 'edition' },
        ]}
        onChange={(v) => actions.setEdition(v)}
      />
      <ChoiceChip<Objective>
        label={text(objectiveName(settings.objective))}
        icon={settings.objective === 'finalPwp' ? 'pwp' : 'xp-orb'}
        title={t('settings.objective')}
        locked={readOnly}
        value={current.objective}
        options={[
          { value: 'levels', label: t('settings.objective.levels'), icon: 'xp-orb' },
          { value: 'xp', label: t('settings.objective.xp'), icon: 'xp-orb', note: t('settings.objective.xpNote') },
          { value: 'finalPwp', label: t('settings.objective.finalPwp'), icon: 'pwp', note: t('settings.objective.finalPwpNote') },
        ]}
        onChange={(v) => actions.setObjective(v, { toast: true })}
      />
      {settings.rename && (
        <li>
          <button type="button" className={styles.chip} onClick={focusRenameToggle}>
            <PixelIcon name="name-tag" size={16} />
            {t('chip.rename')}
          </button>
        </li>
      )}
      {children !== undefined && <li className={styles.after}>{children}</li>}
    </ul>
  )
}

export interface AssumptionLineProps {
  readonly parts: readonly Text[]
  readonly settings: Settings
}

export function AssumptionLine({ parts, settings }: AssumptionLineProps) {
  const { t, text, lang } = useT()
  const [rulesOpen, setRulesOpen] = useState(false)
  // The assumptions sit behind the info button rather than in running text, to keep the column short
  const sentence = [...parts.map((part) => text(part)), ...(settings.edition === 'bedrock' ? [t('assume.bedrock')] : [])].join(lang === 'ja' ? '' : ' ')
  return (
    <>
      <p className={styles.assumption}>
        <InfoTip label={t('assume.info')}>{sentence}</InfoTip>
        {settings.edition === 'bedrock' && (
          <button type="button" className={styles.more} onClick={() => setRulesOpen(true)}>
            {t('assume.more')}
          </button>
        )}
      </p>
      <Sheet open={rulesOpen} onClose={() => setRulesOpen(false)} title={t('bedrockRules.title')} width="narrow">
        <ul className={styles.rules}>
          {BEDROCK_RULE_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </Sheet>
    </>
  )
}
