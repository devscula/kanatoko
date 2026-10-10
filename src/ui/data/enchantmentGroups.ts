// A conflict group is a connected component of two or more non-curse candidates in the exclusiveWith graph. It is listed
// as one block where its first member would be.

import { areCompatible, getEnchantment, getItem, isEnchantmentInEdition, maxLevel } from '../../data/gameData.ts'
import { GAME_DATA } from '../../data/gameData.generated.ts'
import { compareTooltipOrder } from '../../data/tooltipOrder.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../../data/types.ts'
import { sortedLevels } from '../state/convert.ts'
import type { InputState } from '../state/types.ts'
import { MAX_ALL_DEFAULTS } from './maxAllDefaults.ts'

export type ConflictHeading =
  /** Every pair of members conflicts. */
  | { readonly kind: 'pickOne'; readonly count: number }
  /** The member with the most conflicts is the center, as riptide is against channeling and loyalty. */
  | { readonly kind: 'star'; readonly center: EnchantmentId; readonly others: readonly EnchantmentId[] }

export interface ConflictGroup {
  /** First member; used for element ids. */
  readonly key: EnchantmentId
  /** In tooltip order. */
  readonly members: readonly EnchantmentId[]
  /** exclusive_set tag of the first member that has one, for MAX_ALL_DEFAULTS. */
  readonly tag: string | null
  readonly heading: ConflictHeading
}

export type ListBlock = { readonly kind: 'single'; readonly id: EnchantmentId } | { readonly kind: 'group'; readonly group: ConflictGroup }

export interface EnchantmentLayout {
  /** Curses included, in tooltip order. */
  readonly candidates: readonly EnchantmentId[]
  /** Curses excluded. */
  readonly blocks: readonly ListBlock[]
  readonly curses: readonly EnchantmentId[]
  readonly curseOnly: boolean
}

/** null (no item chosen) counts as a book too. */
export function isBookItem(item: ItemTypeId | null): boolean {
  return item === null || getItem(item).isBook
}

/** In tooltip order. Empty for an item that is not in the edition. */
export function listCandidates(edition: Edition, item: ItemTypeId | null): EnchantmentId[] {
  const ids = item === null || getItem(item).isBook ? GAME_DATA.enchantments.map((e) => e.id) : (getItem(item)[edition]?.applicable ?? [])
  return ids.filter((id) => isEnchantmentInEdition(edition, id)).sort(compareTooltipOrder)
}

function headingOf(edition: Edition, members: readonly EnchantmentId[]): ConflictHeading {
  const conflicts = (id: EnchantmentId) => members.filter((other) => other !== id && !areCompatible(edition, id, other))
  const clique = members.every((id) => conflicts(id).length === members.length - 1)
  if (clique) return { kind: 'pickOne', count: members.length }
  // Ties go to the earliest in tooltip order.
  let center = members[0]
  for (const id of members) if (conflicts(id).length > conflicts(center).length) center = id
  return { kind: 'star', center, others: members.filter((id) => id !== center) }
}

function tagOf(edition: Edition, members: readonly EnchantmentId[]): string | null {
  for (const id of members) {
    const tag = getEnchantment(id)[edition]?.exclusiveSetTag ?? null
    if (tag !== null) return tag
  }
  return null
}

function buildLayout(edition: Edition, item: ItemTypeId | null): EnchantmentLayout {
  const candidates = listCandidates(edition, item)
  const curses = candidates.filter((id) => getEnchantment(id).curse)
  const plain = candidates.filter((id) => !getEnchantment(id).curse)

  // There are at most 43 candidates, so a plain BFS is fine.
  const componentOf = new Map<EnchantmentId, EnchantmentId[]>()
  for (const start of plain) {
    if (componentOf.has(start)) continue
    const component: EnchantmentId[] = []
    const queue = [start]
    componentOf.set(start, component)
    while (queue.length > 0) {
      const id = queue.shift() as EnchantmentId
      component.push(id)
      for (const other of plain) {
        if (!componentOf.has(other) && !areCompatible(edition, id, other)) {
          componentOf.set(other, component)
          queue.push(other)
        }
      }
    }
    component.sort(compareTooltipOrder)
  }

  const blocks: ListBlock[] = []
  const placed = new Set<EnchantmentId[]>()
  for (const id of plain) {
    const component = componentOf.get(id) as EnchantmentId[]
    if (component.length < 2) {
      blocks.push({ kind: 'single', id })
      continue
    }
    if (placed.has(component)) continue
    placed.add(component)
    blocks.push({
      kind: 'group',
      group: { key: component[0], members: component, tag: tagOf(edition, component), heading: headingOf(edition, component) },
    })
  }
  return { candidates, blocks, curses, curseOnly: candidates.length > 0 && plain.length === 0 }
}

const layoutCache = new Map<string, EnchantmentLayout>()

export function enchantmentLayout(edition: Edition, item: ItemTypeId | null): EnchantmentLayout {
  const key = `${edition}:${isBookItem(item) ? 'book' : item}`
  let layout = layoutCache.get(key)
  if (layout === undefined) {
    layout = buildLayout(edition, item)
    layoutCache.set(key, layout)
  }
  return layout
}

export function groupOf(layout: EnchantmentLayout, id: EnchantmentId): ConflictGroup | null {
  for (const block of layout.blocks) if (block.kind === 'group' && block.group.members.includes(id)) return block.group
  return null
}

// Max all

export interface MaxAllPlan {
  readonly next: InputState
  /** Picked automatically from conflict groups, in tooltip order. */
  readonly picked: readonly EnchantmentId[]
  readonly changed: boolean
}

export function canMaxAll(edition: Edition, item: ItemTypeId | null): boolean {
  if (item === null || isBookItem(item)) return false
  const layout = enchantmentLayout(edition, item)
  return layout.blocks.length > 0
}

/**
 * Raises every non-curse candidate that fits to its max level. Wanted and existing enchantments stay, and whatever
 * conflicts with them is skipped. Within a conflict group, members are tried in MAX_ALL_DEFAULTS order, then in tooltip
 * order.
 */
export function planMaxAll(input: InputState, edition: Edition): MaxAllPlan {
  if (!canMaxAll(edition, input.item)) return { next: input, picked: [], changed: false }
  const layout = enchantmentLayout(edition, input.item)
  const chosen: EnchantmentId[] = [
    ...(Object.keys(input.existing) as EnchantmentId[]),
    ...(Object.keys(input.wanted) as EnchantmentId[]).filter((id) => input.existing[id] === undefined),
  ]
  const fits = (id: EnchantmentId) => !chosen.includes(id) && chosen.every((c) => areCompatible(edition, id, c))
  const picked: EnchantmentId[] = []
  for (const block of layout.blocks) {
    if (block.kind === 'single') {
      if (fits(block.id)) chosen.push(block.id)
      continue
    }
    const { members, tag } = block.group
    const preferred = (tag === null ? [] : (MAX_ALL_DEFAULTS[tag] ?? [])).filter((id) => members.includes(id))
    for (const id of [...preferred, ...members]) {
      if (!fits(id)) continue
      chosen.push(id)
      picked.push(id)
    }
  }
  const plain = new Set(layout.blocks.flatMap((b) => (b.kind === 'single' ? [b.id] : b.group.members)))
  const wanted: Partial<Record<EnchantmentId, number>> = { ...input.wanted }
  for (const id of chosen) {
    if (!plain.has(id)) continue
    const max = maxLevel(id)
    if ((input.existing[id] ?? 0) < max) wanted[id] = max
  }
  const next = sortedLevels(wanted)
  const same = Object.keys(next).length === Object.keys(input.wanted).length && Object.entries(next).every(([id, level]) => input.wanted[id as EnchantmentId] === level)
  if (same) return { next: input, picked: [], changed: false }
  return { next: { ...input, wanted: next }, picked: picked.sort(compareTooltipOrder), changed: true }
}
