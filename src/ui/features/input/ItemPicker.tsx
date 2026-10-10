import { Fragment, useId, useState, type JSX, type KeyboardEvent } from 'react'
import { itemsInEdition } from '../../../data/gameData.ts'
import type { Edition, ItemGroupId, ItemTypeId } from '../../../data/types.ts'
import { Disclosure } from '../../components/base/Disclosure.tsx'
import type { MessageKey } from '../../i18n/messages/index.ts'
import { useT } from '../../i18n/useT.ts'
import { ItemImage } from '../../icons/ItemImage.tsx'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import styles from './ItemPicker.module.css'
import { bookTileAdvancedParts, itemNameParts, itemSearchNames } from './names.ts'
import { rankByQuery } from './search.ts'
import { SearchField } from './SearchField.tsx'
import { useSlashFocus } from './slashFocus.ts'

/** 'first' is the start screen, shown before any item is chosen. */
export type ItemPickerPurpose = 'first' | 'dialog' | 'dropdown'

export interface ItemPickerProps {
  edition: Edition
  selected: ItemTypeId | null
  onSelect: (id: ItemTypeId) => void
  purpose: ItemPickerPurpose
  labelledBy?: string
  showSearch?: boolean
}

const GROUP_ORDER: readonly ItemGroupId[] = ['armor', 'weapon', 'tool', 'book', 'other']

const GROUP_LABEL = {
  armor: 'item.group.armor',
  weapon: 'item.group.weapon',
  tool: 'item.group.tool',
  book: 'item.group.book',
  other: 'item.group.other',
} as const satisfies Record<ItemGroupId, MessageKey>

function itemsByGroup(edition: Edition): ReadonlyMap<ItemGroupId, readonly ItemTypeId[]> {
  const out = new Map<ItemGroupId, ItemTypeId[]>(GROUP_ORDER.map((g) => [g, []]))
  const items = [...itemsInEdition(edition)].sort((a, b) => a.order - b.order)
  for (const item of items) out.get(item.group)?.push(item.id)
  return out
}

export function ItemPicker({ edition, selected, onSelect, purpose, labelledBy, showSearch = true }: ItemPickerProps): JSX.Element {
  const { t } = useT()
  const baseId = useId()
  const searchId = `${baseId}-search`
  const [query, setQuery] = useState('')
  const groups = itemsByGroup(edition)
  const searching = showSearch && query.trim() !== ''
  const matches = searching ? rankByQuery(query, GROUP_ORDER.flatMap((g) => groups.get(g) ?? []), itemSearchNames) : []

  useSlashFocus(searchId, showSearch)

  const otherItems = groups.get('other') ?? []
  const otherButtonId = `${baseId}-other`

  return (
    <div
      className={[styles.picker, purpose === 'first' ? styles.first : '', purpose === 'dropdown' ? styles.dropdown : ''].filter(Boolean).join(' ')}
      role={labelledBy === undefined ? undefined : 'group'}
      aria-labelledby={labelledBy}
    >
      {showSearch && (
        <SearchField id={searchId} label={t('item.search')} value={query} onChange={setQuery} resultCount={searching ? matches.length : null} />
      )}
      {searching ? (
        matches.length === 0 ? (
          <p className={styles.none}>{t('search.none')}</p>
        ) : (
          <TileGrid items={matches} label={t('search.count', { n: matches.length })} selected={selected} onSelect={onSelect} purpose={purpose} />
        )
      ) : (
        GROUP_ORDER.map((group) => {
          const items = groups.get(group) ?? []
          if (items.length === 0 || group === 'other') return null
          const labelId = `${baseId}-${group}`
          return (
            <div key={group} className={styles.group}>
              <p id={labelId} className={styles.groupLabel}>
                {t(GROUP_LABEL[group])}
              </p>
              <TileGrid items={items} labelledBy={labelId} selected={selected} onSelect={onSelect} purpose={purpose}>
                {group === 'book' && purpose === 'first' && <p className={styles.bookHint}>{t('item.bookHint')}</p>}
              </TileGrid>
            </div>
          )
        })
      )}
      {!searching && otherItems.length > 0 && (
        <Disclosure
          id={otherButtonId}
          className={styles.other}
          summary={
            <span className={styles.otherSummary}>
              <PixelIcon name="curse" size={16} className={styles.curseIcon} />
              {t(GROUP_LABEL.other)}
            </span>
          }
          defaultOpen={selected !== null && otherItems.includes(selected)}
        >
          <div className={styles.otherBody}>
            <p className={styles.otherHint}>{t('item.otherHint')}</p>
            <TileGrid items={otherItems} labelledBy={otherButtonId} selected={selected} onSelect={onSelect} purpose={purpose} />
          </div>
        </Disclosure>
      )}
    </div>
  )
}

interface TileGridProps {
  readonly items: readonly ItemTypeId[]
  readonly labelledBy?: string
  readonly label?: string
  readonly selected: ItemTypeId | null
  onSelect(id: ItemTypeId): void
  readonly purpose: ItemPickerPurpose
  readonly children?: JSX.Element | false
}

/** Without layout (as in tests) every offsetTop is 0, so all tiles count as one row. */
function columnCount(buttons: readonly HTMLElement[]): number {
  if (buttons.length === 0) return 1
  const top = buttons[0].offsetTop
  const count = buttons.filter((b) => b.offsetTop === top).length
  return Math.max(1, count)
}

function TileGrid({ items, labelledBy, label, selected, onSelect, purpose, children }: TileGridProps) {
  const { t, lang } = useT()
  const nameParts = (id: ItemTypeId): readonly string[] =>
    (purpose === 'dialog' || purpose === 'dropdown') && id === 'enchanted_book' ? bookTileAdvancedParts(t('item.bookTile'), lang) : itemNameParts(id, lang)
  const [active, setActive] = useState<ItemTypeId | null>(null)
  const tabbable =
    active !== null && items.includes(active) ? active : selected !== null && items.includes(selected) ? selected : items[0]

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-item]'))
    const index = buttons.findIndex((b) => b === event.target)
    if (index < 0) return
    const columns = columnCount(buttons)
    const last = buttons.length - 1
    const moves: Record<string, number> = {
      ArrowRight: Math.min(index + 1, last),
      ArrowLeft: Math.max(index - 1, 0),
      ArrowDown: index + columns <= last ? index + columns : index,
      ArrowUp: index - columns >= 0 ? index - columns : index,
      Home: 0,
      End: last,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    buttons[next].focus()
  }

  return (
    <div className={styles.grid} role="group" aria-labelledby={labelledBy} aria-label={label} onKeyDown={onKeyDown}>
      {items.map((id) => {
        const pressed = id === selected
        return (
          <button
            key={id}
            type="button"
            className={styles.tile}
            aria-pressed={pressed}
            tabIndex={id === tabbable ? 0 : -1}
            data-item={id}
            onFocus={() => setActive(id)}
            onClick={() => onSelect(id)}
          >
            {pressed && <PixelIcon name="check" size={16} className={styles.check} />}
            <ItemImage item={id} size={purpose === 'first' ? 64 : 32} className={styles.tileIcon} />
            <span className={styles.tileName}>
              {nameParts(id).map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && <wbr />}
                  {part}
                </Fragment>
              ))}
            </span>
          </button>
        )
      })}
      {children}
    </div>
  )
}
