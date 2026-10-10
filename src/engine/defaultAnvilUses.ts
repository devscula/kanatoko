import { getEnchantment, isApplicable, isEnchantmentInEdition } from '../data/gameData.ts'
import { compareTooltipOrder } from '../data/tooltipOrder.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../data/types.ts'
import { checkAdditive, solveTreeTable } from './fastPath.ts'
import { normalizeProblem } from './normalize.ts'
import type { EnchantLevels, Settings, SimpleProblem } from './types.ts'

function countedEnchantments(edition: Edition, itemType: ItemTypeId | null, enchantments: EnchantLevels): { id: EnchantmentId; level: number }[] {
  const out: { id: EnchantmentId; level: number }[] = []
  for (const [id, level] of Object.entries(enchantments) as [EnchantmentId, number | undefined][]) {
    if (typeof level !== 'number' || level < 1) continue
    if (!isEnchantmentInEdition(edition, id)) continue
    if (getEnchantment(id).curse) continue
    if (itemType !== null && itemType !== 'enchanted_book' && !isApplicable(edition, itemType, id)) continue
    out.push({ id, level })
  }
  return out.sort((a, b) => compareTooltipOrder(a.id, b.id))
}

/**
 * For when the tree-table method cannot solve the problem. A step's result has one more anvil use than the larger of
 * its two inputs, so merging k leaves takes at least ceil(log2(k)) uses.
 */
export function lowerBoundAnvilUses(isBook: boolean, n: number): number {
  const leaves = isBook ? n : n + 1
  return leaves <= 1 ? 0 : Math.ceil(Math.log2(leaves))
}

const memo = new Map<string, number>()
const MEMO_LIMIT = 512

/**
 * The anvil uses an already enchanted input would have if each enchantment came from its own book and the books were
 * applied to a fresh item in the order the tree-table method finds. itemType null or 'enchanted_book' means a book made
 * by combining single-enchantment books. Depends only on the edition, never on the user's settings.
 */
export function defaultAnvilUses(edition: Edition, itemType: ItemTypeId | null, enchantments: EnchantLevels): number {
  const isBook = itemType === null || itemType === 'enchanted_book'
  const counted = countedEnchantments(edition, isBook ? null : itemType, enchantments)
  const n = counted.length
  if (isBook ? n <= 1 : n === 0) return 0

  const key = `${edition}|${isBook ? 'book' : itemType}|${counted.map((e) => `${e.id}:${e.level}`).join(',')}`
  const cached = memo.get(key)
  if (cached !== undefined) return cached

  const problem: SimpleProblem = {
    mode: 'simple',
    item: isBook ? 'enchanted_book' : itemType,
    enchantments: counted.map(({ id, level }) => ({ id, level })),
  }
  const settings: Settings = { edition, levelCap: 39, objective: 'levels', rename: false }
  let value: number
  const np = normalizeProblem(problem, settings)
  const check = checkAdditive(np, settings)
  if (!check.eligible) {
    value = lowerBoundAnvilUses(isBook, n)
  } else {
    const outcome = solveTreeTable(np, settings, { check })
    value = outcome.status === 'solved' ? outcome.plan.finalAnvilUses : (outcome.bestWithinCap ?? outcome.best).finalAnvilUses
  }
  if (memo.size >= MEMO_LIMIT) memo.clear()
  memo.set(key, value)
  return value
}
