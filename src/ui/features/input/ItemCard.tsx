import type { Edition, ItemTypeId } from '../../../data/types.ts'
import { defaultAnvilUses } from '../../../engine/index.ts'
import type { EnchantLevels } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { enchText, itemText, listText } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { ItemImage } from '../../icons/ItemImage.tsx'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { enchantEntries, isBookTarget } from '../../state/convert.ts'
import { useAppStore } from '../../state/store.ts'
import type { AnvilUsesOverride } from '../../state/types.ts'
import { AnvilUsesField } from './AnvilUsesField.tsx'
import { INPUT_IDS } from './ids.ts'
import styles from './Input.module.css'
import { SummaryDisclosure } from './SummaryDisclosure.tsx'

export interface ItemCardProps {
  readonly edition: Edition
  readonly levelCap: 39 | null
  readonly item: ItemTypeId
  readonly existing: EnchantLevels
  readonly override: AnvilUsesOverride | null
  readonly readOnly: boolean
  redirect(): void
  onChangeItem(): void
  onEditExisting(): void
  /** The item's anvil uses help explain an infeasible result. */
  readonly usesWarn?: boolean
  readonly usesNote?: string | null
}

export function ItemCard({ edition, levelCap, item, existing, override, readOnly, redirect, onChangeItem, onEditExisting, usesWarn = false, usesNote = null }: ItemCardProps) {
  const { t, text } = useT()
  const setOverride = useAppStore((s) => s.setAnvilUsesOverride)
  const expanded = useAppStore((s) => s.ui.disclosures[INPUT_IDS.usesDisclosure] ?? false)
  const toggle = useAppStore((s) => s.toggleDisclosure)
  const book = isBookTarget(item)
  const entries = enchantEntries(existing)
  const autoValue = book ? 0 : defaultAnvilUses(edition, item, existing)
  const value = override ?? autoValue
  const fresh = entries.length === 0 && override === null && autoValue === 0
  const summary =
    override !== null
      ? t('uses.summary.entered', { n: override })
      : fresh
        ? t('uses.summary.fresh')
        : t('uses.summary.auto', { n: autoValue })
  const guard = (run: () => void) => () => (readOnly ? redirect() : run())
  const name = book ? t('item.bookTile') : text(itemText(item))

  return (
    <div className={styles.card}>
      <div id={INPUT_IDS.itemCard} tabIndex={-1} className={styles.itemRow}>
        <ItemImage item={item} size={64} enchanted={book || entries.length > 0} />
        <div className={styles.itemText}>
          <span className={styles.itemName}>{name}</span>
          {!book && entries.length === 0 && value === 0 && <span className={styles.itemState}>{t('item.stateNew')}</span>}
        </div>
        <Button icon="edit" className={styles.nowrap} onClick={guard(onChangeItem)}>
          {t('item.change')}
        </Button>
      </div>
      {!book && (
        <>
          <div className={styles.existingRow}>
            <ItemImage item={item} size={32} enchanted />
            <div className={styles.existingText}>
              <span className={styles.existingTitle}>{t('existing.title')}</span>
              <span className={styles.existingValue}>
                {entries.length === 0 ? t('existing.none') : text(listText(entries.map((e) => enchText(e.id, e.level))))}
              </span>
            </div>
            <Button icon={entries.length === 0 ? 'plus' : 'edit'} className={styles.nowrap} onClick={guard(onEditExisting)}>
              {t(entries.length === 0 ? 'existing.add' : 'existing.edit')}
            </Button>
          </div>
          <SummaryDisclosure
            id={INPUT_IDS.usesDisclosure}
            icon="pwp"
            label={t('uses.title')}
            value={summary}
            actionLabel={t('uses.change')}
            expanded={expanded}
            warn={usesWarn || value >= 6}
            onToggle={() => toggle(INPUT_IDS.usesDisclosure)}
          >
            {usesNote !== null && (
              <p className={styles.issue}>
                <PixelIcon name="warning" size={16} className={styles.issueIcon} />
                <span>{usesNote}</span>
              </p>
            )}
            <AnvilUsesField
              context="target"
              edition={edition}
              levelCap={levelCap}
              itemType={item}
              enchantments={existing}
              autoValue={autoValue}
              override={override}
              stepperId={INPUT_IDS.usesStepper}
              readOnly={readOnly}
              onReadOnlyActivate={redirect}
              onChange={(next, how) => setOverride(next, { toast: how !== 'stepper' })}
            />
          </SummaryDisclosure>
        </>
      )}
    </div>
  )
}
