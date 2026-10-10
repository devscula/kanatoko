// Reference implementation of the anvil rules. compile.ts and the tree tables must agree with it, so it is written for
// readability rather than speed. Java follows the game code (AnvilMenu.createResult in 26.3); Bedrock follows
// https://minecraft.wiki/w/Anvil_mechanics and Mojira, since its code is not available.
//
// Objects are assumed valid (no two exclusive enchantments, every enchantment in the edition) and undamaged, so there
// is no repair cost. Stacks of more than one object are not modeled.

import { GAME_DATA } from '../data/gameData.generated.ts'
import { areCompatible, getItem, isApplicable, maxLevel, multiplier } from '../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../data/types.ts'
import type { EnchantCostLine, EnchantLevels, EngineInput, StepCost } from './types.ts'

/** An input or the product of an earlier step. */
export interface AnvilObject {
  readonly kind: 'item' | 'book'
  readonly itemType: ItemTypeId | null       // null for books
  readonly enchantments: EnchantLevels
  readonly anvilUses: number
  readonly named: boolean                    // renamed by this plan
}

export interface RuleContext {
  readonly edition: Edition
  readonly levelCap: number | null
  readonly rename: boolean                   // rename on this step (+1 level)
}

/** compile.ts encodes each reason as its index + 1, so the order matters. */
export const REFUSAL_REASONS = [
  'item-onto-book',        // left is a book, right is an item
  'different-item-type',   // item + item of another type
  'not-damageable',        // item + item of a type without durability
  'nothing-transfers',     // right has enchantments but none can be applied (all conflict / inapplicable)
  'no-effect',             // Java: right has no enchantments. Bedrock: no enchantment level changes (assumed, not verified)
  'too-expensive',         // cost > levelCap (i.e. >= 40 in survival)
] as const

export type RefusalReason = (typeof REFUSAL_REASONS)[number]

export type CombineOutcome =
  | { readonly ok: true; readonly cost: number; readonly result: AnvilObject; readonly breakdown: StepCost }
  /** cost is set only for 'too-expensive'. breakdown is set for 'nothing-transfers', 'no-effect' and 'too-expensive';
   *  its total is what the step would cost if it were accepted. */
  | { readonly ok: false; readonly reason: RefusalReason; readonly cost?: number; readonly breakdown?: StepCost }

/** Prior work penalty. */
export const pwp = (uses: number): number => 2 ** uses - 1

/** Java clamps the cost of a rename-only step to this value; Bedrock does not. */
export const JAVA_RENAME_ONLY_MAX_COST = 39

/** A step that costs more is refused as Too Expensive. */
export const SURVIVAL_LEVEL_CAP = 39

const DATA_ORDER: readonly EnchantmentId[] = GAME_DATA.enchantments.map((e) => e.id)

/** Present enchantments in game data order. */
export function levelEntries(levels: EnchantLevels): Array<readonly [EnchantmentId, number]> {
  const entries: Array<readonly [EnchantmentId, number]> = []
  for (const id of DATA_ORDER) {
    const level = levels[id]
    if (level !== undefined && level > 0) entries.push([id, level])
  }
  return entries
}

export function meetsLevels(levels: EnchantLevels, required: EnchantLevels): boolean {
  return levelEntries(required).every(([id, level]) => (levels[id] ?? 0) >= level)
}

/** Present enchantments only, in data order, so that equal contents also have equal key order. */
export function canonicalLevels(levels: EnchantLevels): EnchantLevels {
  const result: EnchantLevels = {}
  for (const [id, level] of levelEntries(levels)) result[id] = level
  return result
}

export function anvilObjectOf(input: EngineInput): AnvilObject {
  return { kind: input.kind, itemType: input.itemType, enchantments: input.enchantments, anvilUses: input.anvilUses, named: false }
}

/** The left object is kept and the right one is consumed. */
export function combine(left: AnvilObject, right: AnvilObject, ctx: RuleContext): CombineOutcome {
  const refusal = pairRefusal(left, right)
  if (refusal !== null) return { ok: false, reason: refusal }
  return ctx.edition === 'java' ? combineJava(left, right, ctx) : combineBedrock(left, right, ctx)
}

/** The same in both editions. */
function pairRefusal(left: AnvilObject, right: AnvilObject): RefusalReason | null {
  if (left.kind === 'book' && right.kind === 'item') return 'item-onto-book'
  if (left.kind === 'item' && right.kind === 'item') {
    if (left.itemType !== right.itemType) return 'different-item-type'
    if (!getItem(itemTypeOf(left)).damageable) return 'not-damageable'
  }
  return null
}

function combineJava(left: AnvilObject, right: AnvilObject, ctx: RuleContext): CombineOutcome {
  const lines = costLines('java', left, right)
  // +1 per conflicting enchantment on the left, counted even when the right enchantment cannot go on the item anyway
  const conflictPenalty = sum(lines.map((line) => line.conflictsWith.length))
  const breakdown = stepCost(left, right, lines, conflictPenalty, ctx.rename)
  if (nothingTransfers(lines)) return { ok: false, reason: 'nothing-transfers', breakdown }
  // Only when the right object has no enchantments: any transferred enchantment costs multiplier * level >= 1
  if (sum(lines.map((line) => line.cost)) + conflictPenalty === 0) return { ok: false, reason: 'no-effect', breakdown }
  return accept(left, right, lines, breakdown, ctx)
}

function combineBedrock(left: AnvilObject, right: AnvilObject, ctx: RuleContext): CombineOutcome {
  const lines = costLines('bedrock', left, right)
  // A conflicting enchantment does not transfer and adds no penalty; the other enchantments still transfer
  const breakdown = stepCost(left, right, lines, 0, ctx.rename)
  if (nothingTransfers(lines)) return { ok: false, reason: 'nothing-transfers', breakdown }
  // Assumed, not verified: a step that raises no enchantment level is refused
  if (!lines.some((line) => line.resultLevel > line.leftLevel)) return { ok: false, reason: 'no-effect', breakdown }
  return accept(left, right, lines, breakdown, ctx)
}

/**
 * Conflicts are checked before applicability, so an enchantment that fails both is a 'conflict'. Validation guarantees
 * that the right object never conflicts with itself, so comparing against the left object's original enchantments is
 * enough and the order of the right enchantments does not matter.
 */
function costLines(edition: Edition, left: AnvilObject, right: AnvilObject): EnchantCostLine[] {
  const leftIds = levelEntries(left.enchantments).map(([id]) => id)
  return levelEntries(right.enchantments).map(([id, rightLevel]): EnchantCostLine => {
    const leftLevel = levelOf(left.enchantments, id)
    const base = {
      id,
      leftLevel,
      rightLevel,
      multiplier: multiplier(edition, id, right.kind),   // depends on the kind of the right object only
      multiplierKind: right.kind,
      conflictsWith: leftIds.filter((other) => other !== id && !areCompatible(edition, id, other)),
    }
    if (base.conflictsWith.length > 0) return { ...base, resultLevel: leftLevel, cost: 0, outcome: 'conflict' }
    const applicable = left.kind === 'book' || isApplicable(edition, itemTypeOf(left), id)
    if (!applicable) return { ...base, resultLevel: leftLevel, cost: 0, outcome: 'inapplicable' }
    const resultLevel = mergedLevel(leftLevel, rightLevel, maxLevel(id))
    // Java charges the merged level even when it is unchanged; Bedrock charges only for the levels gained
    const cost = edition === 'java' ? base.multiplier * resultLevel : base.multiplier * (resultLevel - leftLevel)
    const outcome = leftLevel === 0 ? 'added' : resultLevel > leftLevel ? 'increased' : 'unchanged'
    return { ...base, resultLevel, cost, outcome }
  })
}

/** The same in both editions. */
function mergedLevel(left: number, right: number, max: number): number {
  return Math.min(left === right ? right + 1 : Math.max(left, right), max)
}

const isTransferred = (line: EnchantCostLine): boolean => line.outcome !== 'conflict' && line.outcome !== 'inapplicable'

function nothingTransfers(lines: readonly EnchantCostLine[]): boolean {
  return lines.length > 0 && !lines.some(isTransferred)
}

function stepCost(left: AnvilObject, right: AnvilObject, lines: readonly EnchantCostLine[], conflictPenalty: number, rename: boolean): StepCost {
  const leftPenalty = pwp(left.anvilUses)
  const rightPenalty = pwp(right.anvilUses)
  const renameCost = rename ? 1 : 0
  return {
    leftPenalty,
    rightPenalty,
    enchantments: lines,
    conflictPenalty,
    rename: renameCost,
    clampedFrom: null,
    total: leftPenalty + rightPenalty + sum(lines.map((line) => line.cost)) + conflictPenalty + renameCost,
  }
}

function accept(left: AnvilObject, right: AnvilObject, lines: readonly EnchantCostLine[], breakdown: StepCost, ctx: RuleContext): CombineOutcome {
  const cost = breakdown.total
  if (ctx.levelCap !== null && cost > ctx.levelCap) return { ok: false, reason: 'too-expensive', cost, breakdown }
  const enchantments: EnchantLevels = { ...left.enchantments }
  for (const line of lines) if (isTransferred(line)) enchantments[line.id] = line.resultLevel
  const result: AnvilObject = {
    kind: left.kind,
    itemType: left.itemType,
    enchantments: canonicalLevels(enchantments),
    // The PWP rule 2 * max(PWP) + 1, written in anvil uses
    anvilUses: Math.max(left.anvilUses, right.anvilUses) + 1,
    named: left.named || ctx.rename,
  }
  return { ok: true, cost, result, breakdown }
}

/**
 * Done on the base leaf before its first use; anvil uses do not increase. Java charges min(PWP + 1, 39), Bedrock
 * PWP + 1. The cap check is the same, so a Java rename-only step is never refused at a cap of 39 or more.
 */
export function renameOnly(obj: AnvilObject, ctx: Pick<RuleContext, 'edition' | 'levelCap'>): CombineOutcome {
  const leftPenalty = pwp(obj.anvilUses)
  const unclamped = leftPenalty + 1
  const clamped = ctx.edition === 'java' && unclamped > JAVA_RENAME_ONLY_MAX_COST
  const total = clamped ? JAVA_RENAME_ONLY_MAX_COST : unclamped
  const breakdown: StepCost = {
    leftPenalty,
    rightPenalty: 0,
    enchantments: [],
    conflictPenalty: 0,
    rename: 1,
    clampedFrom: clamped ? unclamped : null,
    total,
  }
  if (ctx.levelCap !== null && total > ctx.levelCap) return { ok: false, reason: 'too-expensive', cost: total, breakdown }
  return { ok: true, cost: total, result: { ...obj, named: true }, breakdown }
}

function levelOf(levels: EnchantLevels, id: EnchantmentId): number {
  const level = levels[id]
  return level !== undefined && level > 0 ? level : 0
}

function itemTypeOf(obj: AnvilObject): ItemTypeId {
  if (obj.itemType === null) throw new Error('an item object must have an itemType')
  return obj.itemType
}

function sum(values: readonly number[]): number {
  let total = 0
  for (const value of values) total += value
  return total
}
