import { useMemo, useState, type RefObject } from 'react'
import { areCompatible, maxLevel } from '../../../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../../../data/types.ts'
import type { EnchantLevels } from '../../../engine/index.ts'
import { AnchoredPopover } from '../../components/base/AnchoredPopover.tsx'
import { Button, IconButton } from '../../components/base/Button.tsx'
import { LevelChips } from '../../components/base/LevelChips.tsx'
import { enchantmentLayout, planMaxAll } from '../../data/enchantmentGroups.ts'
import { enchText, itemText } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { ItemImage } from '../../icons/ItemImage.tsx'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { DEFAULT_INPUT } from '../../state/types.ts'
import styles from './EnchantSheet.module.css'

/**
 * book: the contents of one book. bulk: one new book per picked enchantment. existing: what is already on the item.
 * extra: the contents of a spare item, which may be empty.
 */
export type EnchantSheetMode = 'book' | 'bulk' | 'existing' | 'extra'

export interface EnchantSheetProps {
  readonly anchor: RefObject<HTMLElement | null>
  readonly mode: EnchantSheetMode
  readonly editing?: boolean
  readonly edition: Edition
  readonly item: ItemTypeId
  readonly initial: EnchantLevels
  /** Enchantments already on a book block; bulk mode marks them. */
  readonly present?: ReadonlySet<EnchantmentId>
  onSubmit(levels: EnchantLevels): void
  onClose(): void
}

type Picked = Partial<Record<EnchantmentId, number>>

export function EnchantSheet({ anchor, mode, editing = false, edition, item, initial, present, onSubmit, onClose }: EnchantSheetProps) {
  const { t, text } = useT()
  const [picked, setPicked] = useState<Picked>(() => ({ ...initial }))
  const layout = useMemo(() => enchantmentLayout(edition, item), [edition, item])
  const count = Object.keys(picked).length

  const toggle = (id: EnchantmentId, level?: number) => {
    setPicked((prev) => {
      if (prev[id] !== undefined && level === undefined) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      const next: Picked = {}
      for (const [other, l] of Object.entries(prev) as [EnchantmentId, number][]) {
        if (other === id || areCompatible(edition, id, other)) next[other] = l
      }
      next[id] = level ?? maxLevel(id)
      return next
    })
  }

  const maxAll = () => {
    const plan = planMaxAll({ ...DEFAULT_INPUT, item }, edition)
    setPicked({ ...plan.next.wanted })
  }

  const title =
    mode === 'book'
      ? t('blocks.sheet.book')
      : mode === 'bulk'
        ? t('blocks.sheet.bulk')
        : mode === 'existing'
          ? t('blocks.sheet.existing')
          : t('blocks.sheet.extra', { item: itemText(item) })
  const submitLabel = editing
    ? t('blocks.submit.edit')
    : mode === 'book'
      ? t('blocks.submit.book')
      : mode === 'bulk'
        ? t('blocks.submit.bulk', { n: count })
        : mode === 'existing'
          ? t('blocks.submit.existing')
          : t('blocks.submit.extra', { item: itemText(item) })
  const needsOne = mode === 'book' || mode === 'bulk'

  const row = (id: EnchantmentId) => {
    const selected = picked[id] !== undefined
    const blocked = !selected && Object.keys(picked).some((other) => !areCompatible(edition, id, other as EnchantmentId))
    return (
      <li key={id} className={styles.row} data-selected={selected || undefined} data-blocked={blocked || undefined}>
        <button type="button" className={styles.toggle} aria-pressed={selected} onClick={() => toggle(id)}>
          <span className={styles.check} aria-hidden="true">
            {selected && <PixelIcon name="check" size={16} />}
          </span>
          {/* Shows the max level until one is picked */}
          <ItemImage item="enchanted_book" size={32} book={{ [id]: picked[id] ?? maxLevel(id) }} />
          <span className={styles.name}>{text(enchText(id))}</span>
          {mode === 'bulk' && present?.has(id) && <span className={styles.present}>{t('blocks.sheet.present')}</span>}
        </button>
        {maxLevel(id) > 1 && (
          <LevelChips id={id} value={picked[id] ?? null} onChange={(level) => toggle(id, level)} className={styles.chips} />
        )}
      </li>
    )
  }

  return (
    <AnchoredPopover anchor={anchor} open onClose={onClose} label={title} variant="menu">
      <div className={styles.dropHead}>
        <span className={styles.title}>
          <ItemImage item={mode === 'book' || mode === 'bulk' ? 'enchanted_book' : item} size={32} />
          {title}
        </span>
        <IconButton icon="close" variant="ghost" label={t('blocks.close')} onClick={onClose} />
      </div>
      <div className={styles.dropBody}>
        {mode === 'bulk' && (
          <div className={styles.toolbar}>
            <Button icon="max-all" onClick={maxAll}>
              {t('blocks.sheet.maxAll')}
            </Button>
          </div>
        )}
        <ul className={styles.list}>
          {layout.blocks.map((block) =>
            block.kind === 'single' ? (
              row(block.id)
            ) : (
              <li key={block.group.key} className={styles.group}>
                <span className={styles.groupLabel}>
                  <PixelIcon name="blocked" size={16} />
                  {t('blocks.sheet.pickOne')}
                </span>
                <ul className={styles.list}>{block.group.members.map(row)}</ul>
              </li>
            ),
          )}
        </ul>
        {layout.curses.length > 0 && (
          <details className={styles.curses} open={layout.curseOnly}>
            <summary>
              <PixelIcon name="curse" size={16} />
              {t('blocks.sheet.curses')}
            </summary>
            <ul className={styles.list}>{layout.curses.map(row)}</ul>
          </details>
        )}
      </div>
      <div className={styles.dropFoot}>
        <span className={styles.selected}>{t('blocks.sheet.selected', { n: count })}</span>
        <Button variant="ghost" onClick={() => setPicked({})} disabled={count === 0}>
          {t('blocks.sheet.clear')}
        </Button>
        <Button variant="primary" disabled={needsOne && count === 0} onClick={() => onSubmit(picked as EnchantLevels)}>
          {submitLabel}
        </Button>
      </div>
    </AnchoredPopover>
  )
}
