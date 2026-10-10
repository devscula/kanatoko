import type { EnchantmentId, ItemTypeId } from '../../../data/types.ts'
import type { EnchantLevels } from '../../../engine/index.ts'
import { itemText, msg, type Text } from '../../i18n/text.ts'
import { canHaveSpares, changeItem, createUid, mergeOwnedBook, sortedLevels } from '../../state/convert.ts'
import { getAppStore } from '../../state/store.ts'
import { type AnvilUsesOverride, DEFAULT_INPUT, type InputState } from '../../state/types.ts'
import { syncWanted } from './model.ts'

const store = () => getAppStore().getState()
const edition = () => store().session.edition

function commitBlocks(label: Text, patch: (input: InputState) => InputState | null): boolean {
  return store().commit(label, (s) => {
    const next = patch(s.input)
    if (next === null) return null
    const synced = syncWanted(next, s.session.edition)
    return synced === s.input ? null : { input: synced }
  })
}

/** Brings restored input in line with the blocks without adding a history entry. */
export function syncStoredWanted(): void {
  const { input, session } = store()
  const next = syncWanted(input, session.edition)
  if (next !== input) getAppStore().setState({ input: next })
}

export function chooseItem(item: ItemTypeId): void {
  commitBlocks(msg('history.item', { item: itemText(item) }), (input) => (input.item === item ? null : changeItem(input, edition(), item).next))
}

export function setExisting(existing: EnchantLevels): void {
  commitBlocks(msg('history.existing'), (input) => ({ ...input, existing: sortedLevels(existing) }))
}

export function setExistingLevel(id: EnchantmentId, level: number): void {
  commitBlocks(msg('history.existing'), (input) => (input.existing[id] === level ? null : { ...input, existing: sortedLevels({ ...input.existing, [id]: level }) }))
}

export function removeExisting(id: EnchantmentId, label: Text): void {
  const committed = commitBlocks(msg('history.existing'), (input) => {
    if (input.existing[id] === undefined) return null
    const { [id]: _removed, ...rest } = input.existing
    return { ...input, existing: sortedLevels(rest) }
  })
  if (committed) store().showToast(msg('blocks.removed', { label }), { undo: true, area: 'input' })
}

export function clearExisting(): void {
  const committed = commitBlocks(msg('blocks.clearExisting'), (input) => (Object.keys(input.existing).length === 0 ? null : { ...input, existing: {} }))
  if (committed) store().showToast(msg('blocks.clearedExisting'), { undo: true, area: 'input' })
}

export function setTargetUses(override: AnvilUsesOverride | null): void {
  commitBlocks(msg('history.uses'), (input) => ({ ...input, anvilUsesOverride: override }))
}

export function addBooks(books: readonly EnchantLevels[]): void {
  commitBlocks(msg('blocks.history.add'), (input) => {
    let ownedBooks = input.ownedBooks
    for (const enchantments of books) ownedBooks = mergeOwnedBook(ownedBooks, { enchantments, count: 1, anvilUsesOverride: null }).books
    return { ...input, ownedBooks }
  })
}

/** When the row holds several identical books, only one copy is split off and changed. */
export function updateOneBook(uid: string, enchantments: EnchantLevels): void {
  commitBlocks(msg('blocks.history.edit'), (input) => {
    const book = input.ownedBooks.find((b) => b.uid === uid)
    if (book === undefined) return null
    if (book.count <= 1) {
      return { ...input, ownedBooks: input.ownedBooks.map((b) => (b.uid === uid ? { ...b, enchantments: sortedLevels(enchantments) } : b)) }
    }
    const rest = input.ownedBooks.map((b) => (b.uid === uid ? { ...b, count: b.count - 1 } : b))
    return { ...input, ownedBooks: mergeOwnedBook(rest, { enchantments, count: 1, anvilUsesOverride: book.anvilUsesOverride }).books }
  })
}

export function addExtra(enchantments: EnchantLevels): void {
  commitBlocks(msg('blocks.history.add'), (input) =>
    canHaveSpares(input.item)
      ? { ...input, extraItems: [...input.extraItems, { uid: createUid(), enchantments: sortedLevels(enchantments), anvilUsesOverride: null }] }
      : null,
  )
}

export function updateExtra(uid: string, enchantments: EnchantLevels): void {
  commitBlocks(msg('blocks.history.edit'), (input) => ({
    ...input,
    extraItems: input.extraItems.map((x) => (x.uid === uid ? { ...x, enchantments: sortedLevels(enchantments) } : x)),
  }))
}

export function removeBlock(uid: string, label: Text): void {
  const committed = commitBlocks(msg('blocks.history.remove'), (input) => ({
    ...input,
    // A block stands for one physical item, so a row of identical books loses only one copy.
    ownedBooks: input.ownedBooks.flatMap((b) => (b.uid !== uid ? [b] : b.count > 1 ? [{ ...b, count: b.count - 1 }] : [])),
    extraItems: input.extraItems.filter((x) => x.uid !== uid),
  }))
  if (committed) store().showToast(msg('blocks.removed', { label }), { undo: true, area: 'input' })
}

export function clearMaterials(): void {
  const { item, extraItems } = store().input
  const spares = extraItems.length > 0 && item !== null ? itemText(item) : null
  const committed = commitBlocks(spares === null ? msg('blocks.clearBooks') : msg('blocks.clearMaterials', { item: spares }), (input) =>
    input.ownedBooks.length === 0 && input.extraItems.length === 0 ? null : { ...input, ownedBooks: [], extraItems: [] },
  )
  if (committed) {
    store().showToast(spares === null ? msg('blocks.clearedBooks') : msg('blocks.clearedMaterials', { item: spares }), { undo: true, area: 'input' })
  }
}

export function loadBlocksExample(): void {
  const books: EnchantLevels[] = [
    { protection: 4 },
    { feather_falling: 4 },
    { soul_speed: 3 },
    { depth_strider: 3 },
    { thorns: 3 },
    { unbreaking: 3 },
    { mending: 1 },
  ]
  const committed = commitBlocks(msg('history.example'), (input) => {
    let ownedBooks: InputState['ownedBooks'] = []
    for (const enchantments of books) ownedBooks = mergeOwnedBook(ownedBooks, { enchantments, count: 1, anvilUsesOverride: null }).books
    return { ...DEFAULT_INPUT, item: 'boots', ownedBooks, rename: input.rename }
  })
  if (committed) store().showToast(msg('toast.example'), { undo: true, area: 'input' })
}
