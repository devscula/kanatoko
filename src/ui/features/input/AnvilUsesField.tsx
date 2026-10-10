import { getEnchantment, isApplicable } from '../../../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../../../data/types.ts'
import { LIMITS, pwp } from '../../../engine/index.ts'
import type { EnchantLevels } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { Stepper } from '../../components/base/Stepper.tsx'
import { enchText } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { enchantEntries, isBookTarget } from '../../state/convert.ts'
import type { AnvilUsesOverride } from '../../state/types.ts'
import styles from './AnvilUsesField.module.css'

export interface AnvilUsesFieldProps {
  readonly context: 'target' | 'book' | 'extra'
  readonly edition: Edition
  readonly levelCap: 39 | null
  /** null for a book. */
  readonly itemType: ItemTypeId | null
  readonly enchantments: EnchantLevels
  readonly autoValue: number
  readonly override: AnvilUsesOverride | null
  onChange(next: AnvilUsesOverride | null, how: 'stepper' | 'zero' | 'auto'): void
  readonly readOnly?: boolean
  onReadOnlyActivate?(): void
  readonly stepperId?: string
}

/** At 6 uses the prior work penalty (63) is past the Survival cap, so the anvil can at most rename the item; Survival never goes past 6. */
const TARGET_MAX_USES = 6
const SURVIVAL_MAX_USES = 6

function countedFor(edition: Edition, itemType: ItemTypeId | null, enchantments: EnchantLevels) {
  const entries = enchantEntries(enchantments)
  const counted: EnchantmentId[] = []
  let curses = false
  for (const { id } of entries) {
    if (getEnchantment(id).curse) {
      curses = true
      continue
    }
    if (itemType !== null && !isBookTarget(itemType) && !isApplicable(edition, itemType, id)) continue
    counted.push(id)
  }
  return { counted, curses, levels: enchantments }
}

export function AnvilUsesField({
  context,
  edition,
  levelCap,
  itemType,
  enchantments,
  autoValue,
  override,
  onChange,
  readOnly = false,
  onReadOnlyActivate,
  stepperId,
}: AnvilUsesFieldProps) {
  const { t, num } = useT()
  const value = override ?? autoValue
  const book = context === 'book'
  const { counted, curses, levels } = countedFor(edition, book ? null : itemType, enchantments)

  let meaning: string
  if (override !== null) meaning = t('uses.entered')
  else if (book) meaning = t(counted.length <= 1 ? 'uses.auto.bookOne' : 'uses.auto.bookMany')
  else if (counted.length === 0) meaning = t('uses.auto.none')
  else if (counted.length === 1) meaning = t('uses.auto.one', { name: enchText(counted[0], levels[counted[0]]) })
  else meaning = t('uses.auto.many', { n: counted.length })
  if (override === null && curses) meaning = `${meaning}${t('uses.auto.curses')}`

  const warnings: string[] = []
  if (levelCap !== null && context === 'target' && value >= TARGET_MAX_USES) {
    warnings.push(t(edition === 'java' ? 'uses.targetMax.java' : 'uses.targetMax.bedrock'))
  }
  if (value > SURVIVAL_MAX_USES) warnings.push(t('uses.over6'))
  const guard = (run: () => void) => () => (readOnly ? onReadOnlyActivate?.() : run())

  return (
    <div className={styles.uses}>
      <div className={styles.stepperRow}>
        <Stepper
          id={stepperId}
          value={value}
          min={0}
          max={LIMITS.maxAnvilUses}
          onChange={(next) => onChange(next, 'stepper')}
          label={t('uses.title')}
          valueText={t('uses.valueText', { n: value, p: pwp(value) })}
          decrementLabel={t('uses.dec')}
          incrementLabel={t('uses.inc')}
          readOnly={readOnly}
          onReadOnlyActivate={onReadOnlyActivate}
        />
        <span className={styles.unit}>{t('uses.unit')}</span>
        <span className={styles.pwp}>{t('uses.penalty', { p: num(pwp(value)) })}</span>
      </div>
      <p className={styles.meaning}>{meaning}</p>
      {value !== 0 && (
        <div className={styles.zero}>
          <p className={styles.meaning}>{t('uses.zeroLead')}</p>
          <Button icon="enchanting-table" onClick={guard(() => onChange(0, 'zero'))}>
            {t('uses.setZero')}
          </Button>
        </div>
      )}
      {override !== null && (
        <Button icon="auto-reset" onClick={guard(() => onChange(null, 'auto'))}>
          {t('uses.backToAuto', { n: autoValue })}
        </Button>
      )}
      {warnings.length > 0 && (
        <ul className={styles.warnings}>
          {warnings.map((warning) => (
            <li key={warning} className={styles.warning}>
              <PixelIcon name="warning" size={16} className={styles.mark} />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
