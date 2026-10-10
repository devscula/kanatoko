import { areCompatible, maxLevel } from '../../../data/gameData.ts'
import type { Edition, EnchantmentId } from '../../../data/types.ts'
import { reachableLevel } from '../../../engine/index.ts'
import type { EnchantLevels } from '../../../engine/index.ts'
import { canApply, enchantEntries, sortedLevels } from '../../state/convert.ts'
import type { InputState } from '../../state/types.ts'

export interface BlockWarning {
  readonly kind: 'conflict' | 'notApplicable'
  readonly id: EnchantmentId
  /** For a conflict, the enchantment in an earlier block that this one clashes with. */
  readonly with?: EnchantmentId
}

export interface DerivedBlocks {
  readonly wanted: EnchantLevels
  /** Keyed by block uid, or 'target' for the item itself. */
  readonly warnings: Readonly<Record<string, readonly BlockWarning[]>>
}

interface Source {
  readonly key: string
  readonly enchantments: EnchantLevels
  readonly times: number
}

/**
 * Blocks are read in order. An enchantment that conflicts with one accepted from an earlier block, or that cannot go
 * on the item, gets a warning on its block and is ignored. An enchantment is wanted when the level reachable by
 * combining all its copies is above the level already on the item.
 */
export function deriveWanted(input: InputState, edition: Edition): DerivedBlocks {
  const warnings: Record<string, BlockWarning[]> = {}
  if (input.item === null) return { wanted: {}, warnings }
  const sources: Source[] = [
    { key: 'target', enchantments: input.existing, times: 1 },
    ...input.ownedBooks.map((b) => ({ key: b.uid, enchantments: b.enchantments, times: b.count })),
    ...input.extraItems.map((x) => ({ key: x.uid, enchantments: x.enchantments, times: 1 })),
  ]
  const accepted: EnchantmentId[] = []
  const levels = new Map<EnchantmentId, number[]>()
  for (const source of sources) {
    for (const { id, level } of enchantEntries(source.enchantments)) {
      if (source.key !== 'target' && !canApply(edition, input.item, id)) {
        ;(warnings[source.key] ??= []).push({ kind: 'notApplicable', id })
        continue
      }
      const clash = accepted.find((other) => other !== id && !areCompatible(edition, id, other))
      if (clash !== undefined) {
        ;(warnings[source.key] ??= []).push({ kind: 'conflict', id, with: clash })
        continue
      }
      if (!accepted.includes(id)) accepted.push(id)
      const list = levels.get(id) ?? []
      for (let i = 0; i < source.times; i++) list.push(level)
      levels.set(id, list)
    }
  }
  const wanted: Partial<Record<EnchantmentId, number>> = {}
  for (const [id, list] of levels) {
    const reach = reachableLevel(list, maxLevel(id))
    if (reach > (input.existing[id] ?? 0)) wanted[id] = reach
  }
  return { wanted: sortedLevels(wanted), warnings }
}

/** Returns the same object when the wanted enchantments already match the blocks. */
export function syncWanted(input: InputState, edition: Edition): InputState {
  const { wanted } = deriveWanted(input, edition)
  const a = Object.entries(wanted)
  const b = Object.entries(input.wanted)
  if (a.length === b.length && a.every(([id, level]) => input.wanted[id as EnchantmentId] === level)) return input
  return { ...input, wanted }
}

export function bookCount(input: InputState): number {
  return input.ownedBooks.reduce((sum, b) => sum + b.count, 0)
}
