// Anvil rules for the brute-force oracle (Java Edition 26.3 and Bedrock Edition), written from the game rules and kept
// independent of the engine's rules.ts, compile.ts and xp.ts.
//
// Enchantments are a level vector with one entry per RuleTable position (0 when absent), so the search can build one table
// per problem and run millions of combinations against it. oracleCombine and oracleRenameOnly take EnchantLevels instead.

import type { Edition, EnchantmentId, ItemTypeId } from '../../data/types.ts'
import type { EnchantLevels } from '../../engine/types.ts'
import {
  areExclusive,
  canApply,
  dataPosition,
  enchantmentIn,
  isDamageable,
  maxLevelOf,
  sacrificeMultiplier,
} from './gameFacts.ts'

/** The strings match the engine's RefusalReason. */
export type OracleRefusal =
  | 'item-onto-book'
  | 'different-item-type'
  | 'not-damageable'        // two items of a type without durability
  | 'nothing-transfers'     // the right has enchantments but none of them transfers
  | 'no-effect'             // Java: the right has no enchantments. Bedrock: no level changes
  | 'too-expensive'

export const JAVA_RENAME_ONLY_CLAMP = 39

export function priorWorkPenalty(uses: number): number {
  return 2 ** uses - 1
}

// XP_TOTALS[L] sums the points from level 0 to L, one level at a time as in the game's Player.getXpNeededForNextLevel.
// Using the sum rather than the closed form lets the cross-check catch a mistake in the engine's formula.
const XP_TOTALS: number[] = [0]

function pointsToNextLevel(level: number): number {
  if (level >= 30) return 9 * level - 158
  if (level >= 15) return 5 * level - 38
  return 2 * level + 7
}

/** The fewest points a step costing `levels` can take: paying from exactly `levels` down to 0. */
export function xpForLevels(levels: number): number {
  if (!Number.isInteger(levels) || levels < 0) throw new Error(`oracle: bad level count ${levels}`)
  while (XP_TOTALS.length <= levels) {
    const level = XP_TOTALS.length - 1
    XP_TOTALS.push(XP_TOTALS[level] + pointsToNextLevel(level))
  }
  return XP_TOTALS[levels]
}

export interface RuleTable {
  readonly edition: Edition
  readonly ids: readonly EnchantmentId[]    // in data order
  readonly position: ReadonlyMap<EnchantmentId, number>
  readonly maxLevel: readonly number[]
  readonly bookMultiplier: readonly number[]
  readonly itemMultiplier: readonly number[]
  readonly exclusive: readonly (readonly number[])[]
  /** Filled in per item type on first use. */
  readonly applicable: Map<ItemTypeId, readonly boolean[]>
}

export function createRuleTable(edition: Edition, ids: Iterable<EnchantmentId>): RuleTable {
  const sorted = [...new Set(ids)].sort((a, b) => dataPosition(a) - dataPosition(b))
  for (const id of sorted) {
    if (enchantmentIn(edition, id) === null) throw new Error(`oracle: ${id} does not exist in ${edition}`)
  }
  return {
    edition,
    ids: sorted,
    position: new Map(sorted.map((id, index) => [id, index])),
    maxLevel: sorted.map((id) => maxLevelOf(id)),
    bookMultiplier: sorted.map((id) => sacrificeMultiplier(edition, id, 'book')),
    itemMultiplier: sorted.map((id) => sacrificeMultiplier(edition, id, 'item')),
    exclusive: sorted.map((a) => sorted.flatMap((b, index) => (areExclusive(edition, a, b) ? [index] : []))),
    applicable: new Map(),
  }
}

function applicableTo(table: RuleTable, itemType: ItemTypeId): readonly boolean[] {
  let mask = table.applicable.get(itemType)
  if (mask === undefined) {
    mask = table.ids.map((id) => canApply(table.edition, itemType, id))
    table.applicable.set(itemType, mask)
  }
  return mask
}

export interface SimObject {
  readonly kind: 'item' | 'book'
  readonly itemType: ItemTypeId | null      // null for books
  readonly levels: readonly number[]
  readonly uses: number                     // anvil uses
  readonly named: boolean                   // renamed by this plan
}

export type SimOutcome =
  | { readonly ok: true; readonly cost: number; readonly result: SimObject }
  /** cost is set only for 'too-expensive': what the step would have cost. */
  | { readonly ok: false; readonly reason: OracleRefusal; readonly cost: number | null }

const refuse = (reason: OracleRefusal, cost: number | null = null): SimOutcome => ({ ok: false, reason, cost })

/** left is kept and right consumed. rename renames the result in the same step (+1 level). A null levelCap means no cap. */
export function simCombine(table: RuleTable, left: SimObject, right: SimObject, levelCap: number | null, rename: boolean): SimOutcome {
  // The same in both editions
  if (left.kind === 'book' && right.kind === 'item') return refuse('item-onto-book')
  if (left.kind === 'item' && right.kind === 'item') {
    if (left.itemType !== right.itemType) return refuse('different-item-type')
    if (!isDamageable(requireItemType(left))) return refuse('not-damageable')
  }
  return table.edition === 'java'
    ? combineJava(table, left, right, levelCap, rename)
    : combineBedrock(table, left, right, levelCap, rename)
}

/**
 * Like the game's AnvilMenu.createResult, applies the right's enchantments one at a time to the result being built. The
 * order does not matter because the right never conflicts with itself: only objects built by the rules from validated
 * input get here.
 */
function combineJava(table: RuleTable, left: SimObject, right: SimObject, levelCap: number | null, rename: boolean): SimOutcome {
  const levels = left.levels.slice()
  const multiplier = right.kind === 'book' ? table.bookMultiplier : table.itemMultiplier
  const applicable = left.kind === 'book' ? null : applicableTo(table, requireItemType(left))
  let price = 0
  let anyApplied = false
  let anyRejected = false
  for (let position = 0; position < levels.length; position++) {
    const rightLevel = right.levels[position]
    if (rightLevel === 0) continue
    let accepted = applicable === null || applicable[position]
    // +1 for each exclusive enchantment already on the result, even when this one cannot be applied: the game checks
    // applicability and exclusivity separately
    for (const other of table.exclusive[position]) {
      if (levels[other] > 0) {
        accepted = false
        price += 1
      }
    }
    if (!accepted) {
      anyRejected = true
      continue
    }
    const leftLevel = levels[position]
    const merged = Math.min(leftLevel === rightLevel ? rightLevel + 1 : Math.max(leftLevel, rightLevel), table.maxLevel[position])
    levels[position] = merged
    // Charged for the merged level even when the level does not change
    price += multiplier[position] * merged
    anyApplied = true
  }
  if (anyRejected && !anyApplied) return refuse('nothing-transfers')
  // The right has no enchantments, and nothing is damaged so there is no repair. Checked before the rename cost is added
  if (price === 0) return refuse('no-effect')
  const cost = priorWorkPenalty(left.uses) + priorWorkPenalty(right.uses) + price + (rename ? 1 : 0)
  return finish(left, right, levels, cost, levelCap, rename)
}

/** Unlike Java, charges only for the levels gained, adds nothing for conflicts, and refuses a step that changes no level. */
function combineBedrock(table: RuleTable, left: SimObject, right: SimObject, levelCap: number | null, rename: boolean): SimOutcome {
  const levels = left.levels.slice()
  const multiplier = right.kind === 'book' ? table.bookMultiplier : table.itemMultiplier
  const applicable = left.kind === 'book' ? null : applicableTo(table, requireItemType(left))
  let enchantCost = 0
  let anyApplied = false
  let anyRejected = false
  let anyChanged = false
  for (let position = 0; position < levels.length; position++) {
    const rightLevel = right.levels[position]
    if (rightLevel === 0) continue
    const conflicting = table.exclusive[position].some((other) => levels[other] > 0)
    if (conflicting || (applicable !== null && !applicable[position])) {
      anyRejected = true   // not transferred and no penalty; the other enchantments still transfer
      continue
    }
    const leftLevel = levels[position]
    const merged = Math.min(leftLevel === rightLevel ? rightLevel + 1 : Math.max(leftLevel, rightLevel), table.maxLevel[position])
    levels[position] = merged
    enchantCost += multiplier[position] * (merged - leftLevel)
    if (merged > leftLevel) anyChanged = true
    anyApplied = true
  }
  if (anyRejected && !anyApplied) return refuse('nothing-transfers')
  if (!anyChanged) return refuse('no-effect')   // assumed; not verified in the game
  const cost = priorWorkPenalty(left.uses) + priorWorkPenalty(right.uses) + enchantCost + (rename ? 1 : 0)
  return finish(left, right, levels, cost, levelCap, rename)
}

function finish(left: SimObject, right: SimObject, levels: number[], cost: number, levelCap: number | null, rename: boolean): SimOutcome {
  if (levelCap !== null && cost > levelCap) return refuse('too-expensive', cost)
  return {
    ok: true,
    cost,
    result: {
      kind: left.kind,
      itemType: left.itemType,
      levels,
      // The new prior work penalty is 2 * max(left, right) + 1, which is max + 1 in anvil uses
      uses: Math.max(left.uses, right.uses) + 1,
      named: left.named || rename,
    },
  }
}

/**
 * Costs the prior work penalty + 1, at most 39 in Java and uncapped in Bedrock. Anvil uses do not increase, and Java never
 * refuses under a cap of 39.
 */
export function simRenameOnly(table: RuleTable, obj: SimObject, levelCap: number | null): SimOutcome {
  const unclamped = priorWorkPenalty(obj.uses) + 1
  const cost = table.edition === 'java' ? Math.min(unclamped, JAVA_RENAME_ONLY_CLAMP) : unclamped
  if (levelCap !== null && cost > levelCap) return refuse('too-expensive', cost)
  return { ok: true, cost, result: { ...obj, named: true } }
}

function requireItemType(obj: SimObject): ItemTypeId {
  if (obj.itemType === null) throw new Error('oracle: an item object needs an itemType')
  return obj.itemType
}

export interface OracleObject {
  readonly kind: 'item' | 'book'
  readonly itemType: ItemTypeId | null
  readonly enchantments: EnchantLevels
  readonly anvilUses: number
  readonly named: boolean
}

export type OracleOutcome =
  | { readonly ok: true; readonly cost: number; readonly result: OracleObject }
  | { readonly ok: false; readonly reason: OracleRefusal; readonly cost: number | null }

export interface OracleStepOptions {
  readonly levelCap: number | null
  readonly rename: boolean
}

export function oracleCombine(edition: Edition, left: OracleObject, right: OracleObject, options: OracleStepOptions): OracleOutcome {
  const table = createRuleTable(edition, [...presentIds(left.enchantments), ...presentIds(right.enchantments)])
  return fromSimOutcome(table, simCombine(table, toSimObject(table, left), toSimObject(table, right), options.levelCap, options.rename))
}

export function oracleRenameOnly(edition: Edition, obj: OracleObject, levelCap: number | null): OracleOutcome {
  const table = createRuleTable(edition, presentIds(obj.enchantments))
  return fromSimOutcome(table, simRenameOnly(table, toSimObject(table, obj), levelCap))
}

export function presentIds(levels: EnchantLevels): EnchantmentId[] {
  return (Object.keys(levels) as EnchantmentId[])
    .filter((id) => (levels[id] ?? 0) > 0)
    .sort((a, b) => dataPosition(a) - dataPosition(b))
}

export function levelsToVector(table: RuleTable, levels: EnchantLevels): number[] {
  const vector = new Array<number>(table.ids.length).fill(0)
  for (const id of presentIds(levels)) {
    const position = table.position.get(id)
    if (position === undefined) throw new Error(`oracle: ${id} is not in the rule table`)
    vector[position] = levels[id] ?? 0
  }
  return vector
}

export function vectorToLevels(table: RuleTable, vector: readonly number[]): EnchantLevels {
  const levels: EnchantLevels = {}
  vector.forEach((level, position) => {
    if (level > 0) levels[table.ids[position]] = level
  })
  return levels
}

export function toSimObject(table: RuleTable, obj: OracleObject): SimObject {
  return { kind: obj.kind, itemType: obj.itemType, levels: levelsToVector(table, obj.enchantments), uses: obj.anvilUses, named: obj.named }
}

export function fromSimObject(table: RuleTable, obj: SimObject): OracleObject {
  return { kind: obj.kind, itemType: obj.itemType, enchantments: vectorToLevels(table, obj.levels), anvilUses: obj.uses, named: obj.named }
}

function fromSimOutcome(table: RuleTable, outcome: SimOutcome): OracleOutcome {
  return outcome.ok ? { ok: true, cost: outcome.cost, result: fromSimObject(table, outcome.result) } : outcome
}
