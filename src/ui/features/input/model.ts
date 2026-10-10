import { areCompatible, enchantmentsInEdition, getEnchantment, maxLevel } from '../../../data/gameData.ts'
import { enchantmentName } from '../../../data/format.ts'
import { compareTooltipOrder } from '../../../data/tooltipOrder.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../../../data/types.ts'
import type { ComplexityEstimate, EnchantLevels } from '../../../engine/index.ts'
import { enchantmentLayout, type ListBlock } from '../../data/enchantmentGroups.ts'
import { enchantEntries } from '../../state/convert.ts'
import { matchesQuery, normalizeQuery } from './search.ts'

/**
 * How many more distinct books fit under the exact-search limit, each one roughly tripling the work. null when more than
 * three fit or the tree-table method applies; 'over' when the current input is already past the limit.
 */
export function capacityLeft(estimate: ComplexityEstimate | null): number | 'over' | null {
  if (estimate === null || estimate.fastPathEligible || estimate.effectiveComplexity <= 0) return null
  if (estimate.effectiveComplexity > estimate.hardLimit) return 'over'
  let n = 0
  let scaled = estimate.effectiveComplexity * 3
  while (scaled <= estimate.hardLimit && n <= 3) {
    n += 1
    scaled *= 3
  }
  return n <= 3 ? n : null
}

export type RenameCostVerdict =
  | { readonly kind: 'empty' }
  /** A rename costs the prior work penalty + 1, which is 2^uses. */
  | { readonly kind: 'uses'; readonly uses: number }
  /** Java Edition caps a rename-only cost at 39, so 39 means 6 or more uses. */
  | { readonly kind: 'sixOrMore' }
  | { readonly kind: 'invalid' }

const RENAME_COSTS: readonly number[] = [1, 2, 4, 8, 16, 32]

export function judgeRenameCost(raw: string, edition: Edition): RenameCostVerdict {
  const text = raw.normalize('NFKC').trim()
  if (text === '') return { kind: 'empty' }
  if (!/^\d+$/.test(text)) return { kind: 'invalid' }
  const cost = Number(text)
  const uses = RENAME_COSTS.indexOf(cost)
  if (uses >= 0) return { kind: 'uses', uses }
  if (cost === 39 && edition === 'java') return { kind: 'sixOrMore' }
  return { kind: 'invalid' }
}

export type PickerPurpose = 'book' | 'targetEnchantments' | 'extraEnchantments' | 'goal'

export interface PickerCandidates {
  /** Curses excluded; each conflict group is one block. */
  readonly blocks: readonly ListBlock[]
  readonly curses: readonly EnchantmentId[]
  /** Empty unless picking a book's contents for a chosen item. */
  readonly inapplicable: readonly EnchantmentId[]
  readonly curseOnly: boolean
  readonly all: readonly EnchantmentId[]
}

/** With a null item (merging books only), everything in the edition counts as applicable. */
export function pickerCandidates(purpose: PickerPurpose, edition: Edition, itemType: ItemTypeId | null): PickerCandidates {
  const layout = enchantmentLayout(edition, itemType)
  const applicable = new Set(layout.candidates)
  const inapplicable =
    purpose === 'book' && itemType !== null
      ? enchantmentsInEdition(edition)
          .map((e) => e.id)
          .filter((id) => !applicable.has(id))
          .sort(compareTooltipOrder)
      : []
  return {
    blocks: layout.blocks,
    curses: layout.curses,
    inapplicable,
    curseOnly: layout.curseOnly,
    all: [...layout.candidates, ...inapplicable],
  }
}

function searchNames(id: EnchantmentId): string[] {
  return [enchantmentName(id, 'java', 'ja'), enchantmentName(id, 'bedrock', 'ja'), enchantmentName(id, 'java', 'en')]
}

export function searchEnchantments(query: string, ids: readonly EnchantmentId[]): EnchantmentId[] {
  const q = normalizeQuery(query)
  if (q === '') return [...ids]
  const hits = ids.filter((id) => matchesQuery(query, searchNames(id)))
  const prefix = (id: EnchantmentId) => searchNames(id).some((name) => normalizeQuery(name).startsWith(q))
  return hits.sort((a, b) => Number(prefix(b)) - Number(prefix(a)) || compareTooltipOrder(a, b))
}

/** Drops and returns whatever conflicts with id. If id is already selected, only its level changes. */
export function selectEnchantment(
  draft: EnchantLevels,
  id: EnchantmentId,
  level: number,
  edition: Edition,
): { readonly next: EnchantLevels; readonly replaced: EnchantmentId[] } {
  const clamped = Math.max(1, Math.min(level, maxLevel(id)))
  if (draft[id] !== undefined) return { next: { ...draft, [id]: clamped }, replaced: [] }
  const next: EnchantLevels = {}
  const replaced: EnchantmentId[] = []
  for (const { id: other, level: otherLevel } of enchantEntries(draft)) {
    if (areCompatible(edition, id, other)) next[other] = otherLevel
    else replaced.push(other)
  }
  next[id] = clamped
  return { next, replaced }
}

export function deselectEnchantment(draft: EnchantLevels, id: EnchantmentId): EnchantLevels {
  const next: EnchantLevels = {}
  for (const { id: other, level } of enchantEntries(draft)) if (other !== id) next[other] = level
  return next
}

export function selectedRival(draft: EnchantLevels, id: EnchantmentId, edition: Edition): EnchantmentId | null {
  if (draft[id] !== undefined) return null
  return enchantEntries(draft).find((e) => !areCompatible(edition, id, e.id))?.id ?? null
}

export const isSingleLevel = (id: EnchantmentId): boolean => getEnchantment(id).maxLevel === 1
