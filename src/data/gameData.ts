// src/test/oracle reimplements these lookups from GAME_DATA instead of importing this module, to stay independent.

import { GAME_DATA } from './gameData.generated.ts'
import type { Edition, EnchantmentDef, EnchantmentId, ItemDef, ItemTypeId } from './types.ts'

/** Kind of the sacrifice (the right slot), which selects the multiplier. */
export type SacrificeKind = 'item' | 'book'

interface EditionIndex {
  readonly enchantments: readonly EnchantmentDef[]
  readonly items: readonly ItemDef[]
  readonly enchantmentIds: ReadonlySet<EnchantmentId>
  readonly itemIds: ReadonlySet<ItemTypeId>
  readonly applicable: ReadonlyMap<ItemTypeId, ReadonlySet<EnchantmentId>>
  readonly exclusive: ReadonlyMap<EnchantmentId, ReadonlySet<EnchantmentId>>
}

const enchantmentById: ReadonlyMap<EnchantmentId, EnchantmentDef> = new Map(GAME_DATA.enchantments.map((e) => [e.id, e]))
const itemById: ReadonlyMap<ItemTypeId, ItemDef> = new Map(GAME_DATA.items.map((i) => [i.id, i]))

function buildEditionIndex(edition: Edition): EditionIndex {
  const enchantments = GAME_DATA.enchantments.filter((e) => e[edition] !== null)
  const items = GAME_DATA.items.filter((i) => i[edition] !== null)
  return {
    enchantments,
    items,
    enchantmentIds: new Set(enchantments.map((e) => e.id)),
    itemIds: new Set(items.map((i) => i.id)),
    applicable: new Map(items.map((i) => [i.id, new Set(i[edition]?.applicable)])),
    exclusive: new Map(enchantments.map((e) => [e.id, new Set(e[edition]?.exclusiveWith)])),
  }
}

const EDITION_INDEX: Readonly<Record<Edition, EditionIndex>> = {
  java: buildEditionIndex('java'),
  bedrock: buildEditionIndex('bedrock'),
}

export function isEnchantmentId(value: unknown): value is EnchantmentId {
  return typeof value === 'string' && enchantmentById.has(value as EnchantmentId)
}

export function isItemTypeId(value: unknown): value is ItemTypeId {
  return typeof value === 'string' && itemById.has(value as ItemTypeId)
}

export function getEnchantment(id: EnchantmentId): EnchantmentDef {
  const def = enchantmentById.get(id)
  if (def === undefined) throw new Error(`unknown enchantment id: ${String(id)}`)
  return def
}

export function getItem(id: ItemTypeId): ItemDef {
  const def = itemById.get(id)
  if (def === undefined) throw new Error(`unknown item type id: ${String(id)}`)
  return def
}

/** In data order. */
export function enchantmentsInEdition(edition: Edition): readonly EnchantmentDef[] {
  return EDITION_INDEX[edition].enchantments
}

/** In data order; the picker orders by ItemDef.group and order instead. */
export function itemsInEdition(edition: Edition): readonly ItemDef[] {
  return EDITION_INDEX[edition].items
}

export function isEnchantmentInEdition(edition: Edition, id: EnchantmentId): boolean {
  return EDITION_INDEX[edition].enchantmentIds.has(id)
}

export function isItemInEdition(edition: Edition, itemType: ItemTypeId): boolean {
  return EDITION_INDEX[edition].itemIds.has(itemType)
}

/** In data order. Empty when the item is not in the edition; every enchantment for the enchanted book. */
export function applicableEnchantments(edition: Edition, itemType: ItemTypeId): readonly EnchantmentId[] {
  return getItem(itemType)[edition]?.applicable ?? []
}

/** False when either is missing from the edition. */
export function isApplicable(edition: Edition, itemType: ItemTypeId, id: EnchantmentId): boolean {
  return EDITION_INDEX[edition].applicable.get(itemType)?.has(id) ?? false
}

/**
 * Whether the two are not mutually exclusive. The same enchantment twice is a level merge, not a conflict, and an
 * enchantment missing from the edition excludes nothing.
 */
export function areCompatible(edition: Edition, a: EnchantmentId, b: EnchantmentId): boolean {
  if (a === b) return true
  return !(EDITION_INDEX[edition].exclusive.get(a)?.has(b) ?? false)
}

/**
 * Only the sacrifice's kind matters, not the target's. Throws for an enchantment missing from the edition; input
 * validation rejects those before this is reached.
 */
export function multiplier(edition: Edition, id: EnchantmentId, sacrificeKind: SacrificeKind): number {
  const data = getEnchantment(id)[edition]
  if (data === null) throw new Error(`enchantment ${id} does not exist in ${edition}`)
  return sacrificeKind === 'book' ? data.bookMultiplier : data.itemMultiplier
}

export function maxLevel(id: EnchantmentId): number {
  return getEnchantment(id).maxLevel
}
