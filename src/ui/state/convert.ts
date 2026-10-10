import { applicableEnchantments, areCompatible, getItem, isEnchantmentInEdition, isItemInEdition } from '../../data/gameData.ts'
import { compareTooltipOrder } from '../../data/tooltipOrder.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../../data/types.ts'
import { LIMITS } from '../../engine/index.ts'
import type { EnchantLevels, Settings } from '../../engine/index.ts'
import type { AnvilUsesOverride, ExtraItem, InputState, OwnedBook, SessionState } from './types.ts'

let uidCounter = 0
const uidPrefix = Math.random().toString(36).slice(2, 8)

/** For UI rows only; never part of a calculation or a share link */
export function createUid(): string {
  uidCounter += 1
  return `${uidPrefix}${uidCounter.toString(36)}`
}

export function enchantEntries(levels: EnchantLevels): { id: EnchantmentId; level: number }[] {
  return (Object.entries(levels) as [EnchantmentId, number | undefined][])
    .filter((entry): entry is [EnchantmentId, number] => typeof entry[1] === 'number')
    .map(([id, level]) => ({ id, level }))
    .sort((a, b) => compareTooltipOrder(a.id, b.id))
}

/** Keys in tooltip order, so storage, plan IDs and comparisons all see the same shape */
export function sortedLevels(levels: EnchantLevels): EnchantLevels {
  const out: EnchantLevels = {}
  for (const { id, level } of enchantEntries(levels)) out[id] = level
  return out
}

export function levelCount(levels: EnchantLevels): number {
  return enchantEntries(levels).length
}

export function sameLevels(a: EnchantLevels, b: EnchantLevels): boolean {
  const ea = enchantEntries(a)
  const eb = enchantEntries(b)
  return ea.length === eb.length && ea.every((e, i) => e.id === eb[i].id && e.level === eb[i].level)
}


export function buildSettings(session: SessionState, rename: boolean): Settings {
  return { edition: session.edition, levelCap: session.levelCap, objective: session.objective, rename }
}

export function isBookTarget(item: ItemTypeId | null): boolean {
  return item !== null && getItem(item).isBook
}

export function canHaveSpares(item: ItemTypeId | null): boolean {
  return item !== null && !getItem(item).isBook && getItem(item).damageable
}

export function canApply(edition: Edition, item: ItemTypeId | null, id: EnchantmentId): boolean {
  if (!isEnchantmentInEdition(edition, id)) return false
  if (item === null || getItem(item).isBook) return true
  return applicableEnchantments(edition, item).includes(id)
}

function filterLevels(levels: EnchantLevels, keep: (id: EnchantmentId, level: number) => boolean, removed?: Set<EnchantmentId>): EnchantLevels {
  const out: EnchantLevels = {}
  for (const { id, level } of enchantEntries(levels)) {
    if (keep(id, level)) out[id] = level
    else removed?.add(id)
  }
  return out
}

export function existingConflicts(edition: Edition, existing: EnchantLevels, id: EnchantmentId): EnchantmentId[] {
  return enchantEntries(existing)
    .map((e) => e.id)
    .filter((other) => other !== id && !areCompatible(edition, id, other))
}

/** Only the entries dropped for a conflict go into removed. */
function reconcileWanted(edition: Edition, wanted: EnchantLevels, existing: EnchantLevels, removed: Set<EnchantmentId>): EnchantLevels {
  return filterLevels(
    wanted,
    (id, level) => {
      if (level <= (existing[id] ?? 0)) return false
      if (existingConflicts(edition, existing, id).length > 0) {
        removed.add(id)
        return false
      }
      return true
    },
  )
}

/** Spares and the anvil uses override belong to the old item, so they are dropped. */
export function changeItem(
  input: InputState,
  edition: Edition,
  item: ItemTypeId,
): { next: InputState; removed: EnchantmentId[]; sparesRemoved: boolean } {
  const removed = new Set<EnchantmentId>()
  const book = isBookTarget(item)
  const keep = (id: EnchantmentId) => canApply(edition, item, id)
  const existing = book ? filterLevels(input.existing, () => false, removed) : filterLevels(input.existing, keep, removed)
  const wanted = filterLevels(input.wanted, keep, removed)
  const sparesRemoved = input.extraItems.length > 0 && input.item !== item
  return {
    next: {
      ...input,
      item,
      existing,
      wanted: reconcileWanted(edition, wanted, existing, new Set()),
      anvilUsesOverride: input.item === item ? input.anvilUsesOverride : null,
      extraItems: input.item === item ? input.extraItems : [],
    },
    removed: [...removed].sort(compareTooltipOrder),
    sparesRemoved,
  }
}

/**
 * Returns the wanted enchantments dropped for conflicting, for the toast. Wanted entries at or below the new levels are
 * dropped without notice.
 */
export function changeExisting(
  input: InputState,
  edition: Edition,
  existing: EnchantLevels,
): { next: InputState; removedByConflict: EnchantmentId[] } {
  if (input.item === null || isBookTarget(input.item)) return { next: input, removedByConflict: [] }
  const removed = new Set<EnchantmentId>()
  const nextExisting = filterLevels(existing, (id, level) => canApply(edition, input.item, id) && level >= 1)
  const wanted = reconcileWanted(edition, input.wanted, nextExisting, removed)
  return { next: { ...input, existing: nextExisting, wanted }, removedByConflict: [...removed].sort(compareTooltipOrder) }
}

/**
 * Drops and returns the wanted enchantments incompatible with id. Null when nothing changes, including when id conflicts
 * with an existing enchantment. A level at or below the existing one removes the entry.
 */
export function selectWanted(
  input: InputState,
  edition: Edition,
  id: EnchantmentId,
  level: number,
): { next: InputState; replaced: EnchantmentId[] } | null {
  if (input.item === null || !canApply(edition, input.item, id)) return null
  if (existingConflicts(edition, input.existing, id).length > 0) return null
  const on = input.existing[id] ?? 0
  if (level <= on) {
    if (input.wanted[id] === undefined) return null
    return { next: { ...input, wanted: filterLevels(input.wanted, (other) => other !== id) }, replaced: [] }
  }
  if (input.wanted[id] !== undefined) {
    if (input.wanted[id] === level) return null
    return { next: { ...input, wanted: sortedLevels({ ...input.wanted, [id]: level }) }, replaced: [] }
  }
  const replaced = new Set<EnchantmentId>()
  const kept = filterLevels(input.wanted, (other) => areCompatible(edition, id, other), replaced)
  return { next: { ...input, wanted: sortedLevels({ ...kept, [id]: level }) }, replaced: [...replaced].sort(compareTooltipOrder) }
}

export function deselectWanted(input: InputState, id: EnchantmentId): InputState | null {
  if (input.wanted[id] === undefined) return null
  return { ...input, wanted: filterLevels(input.wanted, (other) => other !== id) }
}

export interface EditionRemoval {
  readonly next: InputState
  readonly removed: { readonly enchantments: EnchantmentId[]; readonly items: ItemTypeId[] }
}

/** Also drops owned books left empty. */
export function removeNotInEdition(input: InputState, edition: Edition): EditionRemoval {
  const removed = new Set<EnchantmentId>()
  const inEdition = (id: EnchantmentId) => isEnchantmentInEdition(edition, id)
  const items: ItemTypeId[] = []
  let item = input.item
  if (item !== null && !isItemInEdition(edition, item)) {
    items.push(item)
    item = null
  }
  const ownedBooks: OwnedBook[] = []
  for (const book of input.ownedBooks) {
    const enchantments = filterLevels(book.enchantments, inEdition, removed)
    if (levelCount(enchantments) > 0) ownedBooks.push(levelCount(enchantments) === levelCount(book.enchantments) ? book : { ...book, enchantments })
  }
  const extraItems: ExtraItem[] =
    item === null ? [] : input.extraItems.map((x) => ({ ...x, enchantments: filterLevels(x.enchantments, inEdition, removed) }))
  const next: InputState = {
    ...input,
    item,
    existing: filterLevels(input.existing, inEdition, removed),
    wanted: filterLevels(input.wanted, inEdition, removed),
    ownedBooks,
    extraItems,
    anvilUsesOverride: item === null ? null : input.anvilUsesOverride,
  }
  return { next, removed: { enchantments: [...removed].sort(compareTooltipOrder), items } }
}

export interface OwnedBookDraft {
  readonly enchantments: EnchantLevels
  readonly count: number
  readonly anvilUsesOverride: AnvilUsesOverride | null
}

function sameBook(a: OwnedBookDraft, b: OwnedBookDraft): boolean {
  return sameLevels(a.enchantments, b.enchantments) && a.anvilUsesOverride === b.anvilUsesOverride
}

/**
 * A row with the same enchantments and anvil uses gets its count raised instead, unless that would exceed the stack
 * limit. Returns the uid of the row added or updated.
 */
export function mergeOwnedBook(books: readonly OwnedBook[], draft: OwnedBookDraft, uid: string = createUid()): { books: OwnedBook[]; uid: string } {
  const book: OwnedBook = {
    uid,
    enchantments: sortedLevels(draft.enchantments),
    count: draft.count,
    anvilUsesOverride: draft.anvilUsesOverride,
  }
  const index = books.findIndex((b) => b.uid !== uid && sameBook(b, book) && b.count + book.count <= LIMITS.maxStackCount)
  if (index < 0) return { books: [...books, book], uid }
  const merged = { ...books[index], count: books[index].count + book.count }
  return { books: books.map((b, i) => (i === index ? merged : b)), uid: merged.uid }
}

/**
 * Silently fixes input read from storage or a share link. Conflicts are left in place for validateProblem to report as
 * input problems.
 */
export function repairInput(input: InputState): InputState {
  let next = input
  if (next.item === null || isBookTarget(next.item)) {
    if (levelCount(next.existing) > 0 || next.anvilUsesOverride !== null || next.extraItems.length > 0) {
      next = { ...next, existing: {}, anvilUsesOverride: null, extraItems: [] }
    }
  } else if (!canHaveSpares(next.item) && next.extraItems.length > 0) {
    // Spares of an item without durability cannot be combined, but stay so they are reported as an input problem
  }
  const existing = next.existing
  const wanted = filterLevels(next.wanted, (id, level) => level > (existing[id] ?? 0))
  if (levelCount(wanted) !== levelCount(next.wanted)) next = { ...next, wanted }
  return next
}

/** An opened share link replaces an empty input without asking. */
export function isInputEmpty(input: InputState): boolean {
  return (
    input.item === null &&
    levelCount(input.existing) === 0 &&
    levelCount(input.wanted) === 0 &&
    input.ownedBooks.length === 0 &&
    input.extraItems.length === 0
  )
}

export const EXAMPLE_INPUT: InputState = {
  item: 'boots',
  existing: {},
  anvilUsesOverride: null,
  wanted: sortedLevels({
    protection: 4,
    feather_falling: 4,
    soul_speed: 3,
    depth_strider: 3,
    thorns: 3,
    unbreaking: 3,
    mending: 1,
  }),
  ownedBooks: [],
  extraItems: [],
  rename: false,
}
