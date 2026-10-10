import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { enchantmentName } from '../../../data/format.ts'
import { getEnchantment, maxLevel } from '../../../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../../../data/types.ts'
import type { EnchantLevels } from '../../../engine/index.ts'
import { Checkbox } from '../../components/base/Checkbox.tsx'
import { Disclosure } from '../../components/base/Disclosure.tsx'
import { LevelChips } from '../../components/base/LevelChips.tsx'
import type { ConflictGroup, ListBlock } from '../../data/enchantmentGroups.ts'
import { enchText, itemText, listText } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { announceLevel } from './levelAnnounce.ts'
import { isSingleKeyAllowed } from '../shell/shortcuts.ts'
import { isSingleLevel, selectedRival, type PickerCandidates } from './model.ts'
import styles from './PickerList.module.css'

export interface PickerListProps {
  readonly edition: Edition
  readonly itemType: ItemTypeId | null
  readonly candidates: PickerCandidates
  /** null when not searching. */
  readonly matches: readonly EnchantmentId[] | null
  readonly value: EnchantLevels
  /** Given when adding a book: the wanted enchantments are listed first and the rest start collapsed. */
  readonly wanted?: EnchantLevels
  onSelect(id: EnchantmentId, level: number): void
  onDeselect(id: EnchantmentId): void
}

export const ROW_ATTRIBUTE = 'data-enchantment'

export function PickerList({ edition, itemType, candidates, matches, value, wanted, onSelect, onDeselect }: PickerListProps) {
  const { t, lang } = useT()
  const listId = useId()
  const inapplicable = new Set(candidates.inapplicable)

  const row = (id: EnchantmentId): ReactNode => {
    const level = value[id]
    const selected = level !== undefined
    const rival = selectedRival(value, id, edition)
    const note =
      selected && inapplicable.has(id) && itemType !== null
        ? t('book.inapplicable', { name: enchText(id), item: itemText(itemType) })
        : rival !== null
          ? t('conflict.with', { name: enchText(rival) })
          : undefined

    const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
      if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'checkbox') return
      const max = maxLevel(id)
      const chooseByKey = (n: number) => {
        onSelect(id, n)
        if (n !== level && max > 1) announceLevel(id, n)
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (!selected || max === 1) return
        event.preventDefault()
        const next = Math.max(1, Math.min(max, level + (event.key === 'ArrowRight' ? 1 : -1)))
        if (next !== level) chooseByKey(next)
        return
      }
      if (/^[1-5]$/.test(event.key) && isSingleKeyAllowed(event.nativeEvent)) {
        const n = Number(event.key)
        if (n > max) return
        event.preventDefault()
        chooseByKey(n)
      }
    }

    // Each enchantment appears once in the list, so its id keeps the name id unique
    const nameId = `${listId}-${id}`
    return (
      <li key={id} className={styles.row} data-selected={selected || undefined} {...{ [ROW_ATTRIBUTE]: id }} onKeyDown={onKeyDown}>
        <Checkbox
          checked={selected}
          onChange={(checked) => (checked ? onSelect(id, maxLevel(id)) : onDeselect(id))}
          labelledBy={nameId}
          label={
            <span className={styles.names}>
              <span id={nameId} className={styles.name}>
                {enchantmentName(id, edition, lang)}
                {getEnchantment(id).curse && <PixelIcon name="curse" size={16} className={styles.curse} />}
              </span>
              {lang === 'ja' && (
                <span className={styles.english} lang="en">
                  {enchantmentName(id, edition, 'en')}
                </span>
              )}
            </span>
          }
          description={note}
          className={styles.check}
        />
        {!isSingleLevel(id) && (
          <LevelChips id={id} value={level ?? null} onChange={(next) => onSelect(id, next)} className={styles.chips} />
        )}
      </li>
    )
  }

  if (matches !== null) {
    return matches.length === 0 ? (
      <p className={styles.none}>{t('search.none')}</p>
    ) : (
      <ul className={styles.list}>{matches.map(row)}</ul>
    )
  }

  const curseCount = candidates.curses.length
  if (wanted !== undefined && itemType !== null) {
    const wantedIds = new Set(Object.keys(wanted) as EnchantmentId[])
    const first = [...candidates.blocks.flatMap((b) => (b.kind === 'single' ? [b.id] : b.group.members)), ...candidates.curses].filter((id) =>
      wantedIds.has(id),
    )
    const otherBlocks = candidates.blocks.flatMap((block): ListBlock[] => {
      if (block.kind === 'single') return wantedIds.has(block.id) ? [] : [block]
      const members = block.group.members.filter((id) => !wantedIds.has(id))
      return members.length === 0 ? [] : [{ ...block, group: { ...block.group, members } }]
    })
    const otherCurses = candidates.curses.filter((id) => !wantedIds.has(id))
    const otherCount = otherBlocks.reduce((n, b) => n + (b.kind === 'single' ? 1 : b.group.members.length), 0) + otherCurses.length
    const openOther = [...otherBlocks.flatMap((b) => (b.kind === 'single' ? [b.id] : b.group.members)), ...otherCurses].some(
      (id) => value[id] !== undefined,
    )
    return (
      <div className={styles.sections}>
        {first.length > 0 && (
          <>
            <h3 className={styles.heading}>
              <PixelIcon name="star" size={16} /> {t('composer.groupWanted', { n: first.length })}
            </h3>
            <ul className={styles.list}>{first.map(row)}</ul>
          </>
        )}
        {otherCount > 0 && (
          <Disclosure
            summary={t('composer.groupOther', { item: itemText(itemType), n: otherCount })}
            defaultOpen={first.length === 0 || openOther}
            className={styles.fold}
          >
            <ul className={styles.list}>
              {otherBlocks.map((block) =>
                block.kind === 'single' ? row(block.id) : <ConflictGroupBlock key={block.group.key} group={block.group} renderRow={row} />,
              )}
              {otherCurses.map(row)}
            </ul>
          </Disclosure>
        )}
        {candidates.inapplicable.length > 0 && (
          <Disclosure
            summary={t('picker.inapplicable', { item: itemText(itemType), n: candidates.inapplicable.length })}
            defaultOpen={candidates.inapplicable.some((id) => value[id] !== undefined)}
            className={styles.fold}
          >
            <ul className={styles.list}>{candidates.inapplicable.map(row)}</ul>
          </Disclosure>
        )}
      </div>
    )
  }
  return (
    <div className={styles.sections}>
      {itemType !== null && candidates.blocks.length > 0 && (
        <h3 className={styles.heading}>{t('picker.applicable', { item: itemText(itemType) })}</h3>
      )}
      <ul className={styles.list}>
        {candidates.blocks.map((block) =>
          block.kind === 'single' ? row(block.id) : <ConflictGroupBlock key={block.group.key} group={block.group} renderRow={row} />,
        )}
      </ul>
      {curseCount > 0 && (
        <Disclosure summary={t('enchant.curses', { n: curseCount })} defaultOpen={candidates.curseOnly} className={styles.fold}>
          <ul className={styles.list}>{candidates.curses.map(row)}</ul>
        </Disclosure>
      )}
      {candidates.inapplicable.length > 0 && itemType !== null && (
        <Disclosure
          summary={t('picker.inapplicable', { item: itemText(itemType), n: candidates.inapplicable.length })}
          defaultOpen={candidates.inapplicable.some((id) => value[id] !== undefined)}
          className={styles.fold}
        >
          <ul className={styles.list}>{candidates.inapplicable.map(row)}</ul>
        </Disclosure>
      )}
    </div>
  )
}

function ConflictGroupBlock({ group, renderRow }: { readonly group: ConflictGroup; readonly renderRow: (id: EnchantmentId) => ReactNode }) {
  const { t } = useT()
  const headingId = useId()
  const srId = useId()
  const { heading } = group
  const title =
    heading.kind === 'pickOne'
      ? t('conflict.pickOne', { n: heading.count })
      : t('conflict.star', { center: enchText(heading.center), list: listText(heading.others.map((id) => enchText(id)), 'or') })
  return (
    // role="group" goes on an inner element: on the li it would replace the listitem role and throw off the item count
    <li className={styles.group}>
      <div role="group" aria-labelledby={headingId} aria-describedby={srId}>
        <p id={headingId} className={styles.groupHeading}>
          {title}
        </p>
        <span id={srId} className="visually-hidden">
          {t('conflict.groupSr')}
        </span>
        <ul className={styles.groupList}>{group.members.map(renderRow)}</ul>
      </div>
    </li>
  )
}
