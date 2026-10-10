// Packed form of a normalized problem, and a fast combine that gives the same answers as rules.combine.
//
// Each problem numbers the enchantments on its inputs with slots. combineCompiled and renameOnlyCompiled must match
// rules.combine and rules.renameOnly exactly: acceptance or refusal reason, cost and resulting state (compile.test.ts
// compares them on random objects). They run inside the exact search, so they allocate nothing.

import { GAME_DATA } from '../data/gameData.generated.ts'
import { areCompatible, getItem, isApplicable, maxLevel, multiplier } from '../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../data/types.ts'
import { groupInputs, type InputGroup } from './normalize.ts'
import { anvilObjectOf, JAVA_RENAME_ONLY_MAX_COST, levelEntries, REFUSAL_REASONS, type AnvilObject, type RefusalReason } from './rules.ts'
import type { EnchantLevels, NormalizedProblem, Settings } from './types.ts'

/** 3 words * 10 slots. LIMITS.exactMaxDistinctEnchantments must not exceed it. */
export const PACKED_SLOT_CAPACITY = 30
const SLOTS_PER_WORD = 10
const BITS_PER_LEVEL = 3
/** No enchantment in the game goes above level 5. */
const MAX_PACKED_LEVEL = 0b111

export const KIND_ITEM = 0
export const KIND_BOOK = 1
export const NO_ITEM_TYPE = -1

export const ITEM_TYPE_CODES: readonly ItemTypeId[] = GAME_DATA.items.map((item) => item.id)
const ITEM_CODE: ReadonlyMap<ItemTypeId, number> = new Map(ITEM_TYPE_CODES.map((id, code) => [id, code]))

export function itemTypeCode(itemType: ItemTypeId): number {
  const code = ITEM_CODE.get(itemType)
  if (code === undefined) throw new Error(`unknown item type id: ${String(itemType)}`)
  return code
}

/** Mutated in place so that the search allocates nothing. */
export interface PackedObject {
  kind: number        // KIND_ITEM | KIND_BOOK
  itemType: number    // itemTypeCode, NO_ITEM_TYPE for a book
  mask: number        // bit s set when slot s has a level of 1 or more
  w0: number          // levels of slots 0-9, 3 bits each
  w1: number          // slots 10-19
  w2: number          // slots 20-29
  uses: number        // anvil uses
  named: number       // 0 | 1, renamed by this plan
}

export function createPackedObject(): PackedObject {
  return { kind: KIND_ITEM, itemType: NO_ITEM_TYPE, mask: 0, w0: 0, w1: 0, w2: 0, uses: 0, named: 0 }
}

export function copyPackedObject(from: Readonly<PackedObject>, to: PackedObject): void {
  to.kind = from.kind
  to.itemType = from.itemType
  to.mask = from.mask
  to.w0 = from.w0
  to.w1 = from.w1
  to.w2 = from.w2
  to.uses = from.uses
  to.named = from.named
}

/** mask follows from the levels, so it is not compared. */
export function samePackedObject(a: Readonly<PackedObject>, b: Readonly<PackedObject>): boolean {
  return a.kind === b.kind && a.itemType === b.itemType && a.w0 === b.w0 && a.w1 === b.w1 && a.w2 === b.w2
    && a.uses === b.uses && a.named === b.named
}

export function levelAt(obj: Readonly<PackedObject>, slot: number): number {
  const word = slot < SLOTS_PER_WORD ? obj.w0 : slot < 2 * SLOTS_PER_WORD ? obj.w1 : obj.w2
  return (word >>> ((slot % SLOTS_PER_WORD) * BITS_PER_LEVEL)) & MAX_PACKED_LEVEL
}

/** a >= b in every slot and > in at least one: how results are ordered when there is no goal. */
export function levelsDominate(a: Readonly<PackedObject>, b: Readonly<PackedObject>): boolean {
  let pending = a.mask | b.mask
  let greater = false
  while (pending !== 0) {
    const slot = 31 - Math.clz32(pending)
    pending &= ~(1 << slot)
    const la = levelAt(a, slot)
    const lb = levelAt(b, slot)
    if (la < lb) return false
    if (la > lb) greater = true
  }
  return greater
}

const PWP_TABLE = Float64Array.from({ length: 64 }, (_, uses) => 2 ** uses - 1)

/** rules.pwp from a lookup table. */
export function packedPwp(uses: number): number {
  return uses < PWP_TABLE.length ? PWP_TABLE[uses] : 2 ** uses - 1
}

// Compiled rules

/** Lookup tables for one edition and slot assignment. */
export interface CompiledRules {
  readonly edition: Edition
  readonly java: boolean
  readonly universe: readonly EnchantmentId[]   // slot -> enchantment
  readonly slotOf: ReadonlyMap<EnchantmentId, number>
  readonly allSlots: number              // what a book on the left accepts
  readonly maxLevel: Uint8Array          // slot -> max level
  readonly bookMultiplier: Uint8Array    // slot -> multiplier when the right object is a book
  readonly itemMultiplier: Uint8Array    // slot -> multiplier when the right object is an item
  readonly exclusive: Int32Array         // slot -> mask of the slots it conflicts with (never itself)
  readonly applicable: Int32Array        // item type code -> mask of applicable slots (0 for items outside the edition)
  readonly damageable: Uint8Array        // item type code -> 1 when the item has durability
}

/** Slots follow the order of universe. Every enchantment must exist in the edition. */
export function compileRules(edition: Edition, universe: readonly EnchantmentId[]): CompiledRules {
  if (universe.length > PACKED_SLOT_CAPACITY) {
    throw new RangeError(`${universe.length} distinct enchantments exceed the packed capacity of ${PACKED_SLOT_CAPACITY}`)
  }
  const slotOf = new Map(universe.map((id, slot) => [id, slot]))
  if (slotOf.size !== universe.length) throw new Error('the enchantment universe has duplicate ids')

  const size = universe.length
  const maxLevels = new Uint8Array(size)
  const bookMultiplier = new Uint8Array(size)
  const itemMultiplier = new Uint8Array(size)
  const exclusive = new Int32Array(size)
  universe.forEach((id, slot) => {
    maxLevels[slot] = maxLevel(id)
    bookMultiplier[slot] = multiplier(edition, id, 'book')   // throws for an enchantment outside the edition
    itemMultiplier[slot] = multiplier(edition, id, 'item')
    universe.forEach((other, otherSlot) => {
      if (!areCompatible(edition, id, other)) exclusive[slot] |= 1 << otherSlot
    })
  })

  const applicable = new Int32Array(ITEM_TYPE_CODES.length)
  const damageable = new Uint8Array(ITEM_TYPE_CODES.length)
  ITEM_TYPE_CODES.forEach((itemType, code) => {
    damageable[code] = getItem(itemType).damageable ? 1 : 0
    universe.forEach((id, slot) => {
      if (isApplicable(edition, itemType, id)) applicable[code] |= 1 << slot
    })
  })

  return {
    edition,
    java: edition === 'java',
    universe,
    slotOf,
    allSlots: size === 0 ? 0 : (2 ** size - 1) | 0,
    maxLevel: maxLevels,
    bookMultiplier,
    itemMultiplier,
    exclusive,
    applicable,
    damageable,
  }
}

export function packObject(rules: CompiledRules, obj: AnvilObject): PackedObject {
  const packed = createPackedObject()
  packed.kind = obj.kind === 'book' ? KIND_BOOK : KIND_ITEM
  if (obj.kind === 'item') {
    if (obj.itemType === null) throw new Error('an item object must have an itemType')
    packed.itemType = itemTypeCode(obj.itemType)
  }
  for (const [id, level] of levelEntries(obj.enchantments)) {
    const slot = rules.slotOf.get(id)
    if (slot === undefined) throw new Error(`enchantment ${id} is not in the compiled universe`)
    if (!Number.isInteger(level) || level > MAX_PACKED_LEVEL) throw new Error(`level ${level} of ${id} cannot be packed`)
    setLevel(packed, slot, level)
  }
  packed.uses = obj.anvilUses
  packed.named = obj.named ? 1 : 0
  return packed
}

/** Enchantments come back in universe order. */
export function unpackObject(rules: CompiledRules, packed: Readonly<PackedObject>): AnvilObject {
  const enchantments: EnchantLevels = {}
  rules.universe.forEach((id, slot) => {
    const level = levelAt(packed, slot)
    if (level > 0) enchantments[id] = level
  })
  return {
    kind: packed.kind === KIND_BOOK ? 'book' : 'item',
    itemType: packed.kind === KIND_BOOK ? null : ITEM_TYPE_CODES[packed.itemType],
    enchantments,
    anvilUses: packed.uses,
    named: packed.named === 1,
  }
}

function setLevel(obj: PackedObject, slot: number, level: number): void {
  const shift = (slot % SLOTS_PER_WORD) * BITS_PER_LEVEL
  const clear = ~(MAX_PACKED_LEVEL << shift)
  if (slot < SLOTS_PER_WORD) obj.w0 = (obj.w0 & clear) | (level << shift)
  else if (slot < 2 * SLOTS_PER_WORD) obj.w1 = (obj.w1 & clear) | (level << shift)
  else obj.w2 = (obj.w2 & clear) | (level << shift)
  if (level > 0) obj.mask |= 1 << slot
  else obj.mask &= ~(1 << slot)
}

// Fast combine

export const COMBINE_OK = 0

export const REFUSAL_CODE: Readonly<Record<RefusalReason, number>> = Object.fromEntries(
  REFUSAL_REASONS.map((reason, index) => [reason, index + 1]),
) as Record<RefusalReason, number>

export function refusalReasonOf(code: number): RefusalReason {
  const reason = REFUSAL_REASONS[code - 1]
  if (reason === undefined) throw new Error(`not a refusal code: ${code}`)
  return reason
}

const ITEM_ONTO_BOOK = REFUSAL_CODE['item-onto-book']
const DIFFERENT_ITEM_TYPE = REFUSAL_CODE['different-item-type']
const NOT_DAMAGEABLE = REFUSAL_CODE['not-damageable']
const NOTHING_TRANSFERS = REFUSAL_CODE['nothing-transfers']
const NO_EFFECT = REFUSAL_CODE['no-effect']
const TOO_EXPENSIVE = REFUSAL_CODE['too-expensive']

/** Reused across calls. */
export interface PackedCombineOut {
  /** Step cost when accepted or refused as 'too-expensive'; left untouched by other refusals. */
  cost: number
  /** Result when accepted; left untouched by refusals. */
  readonly result: PackedObject
}

export function createCombineOut(): PackedCombineOut {
  return { cost: 0, result: createPackedObject() }
}

/**
 * rules.combine on packed objects; returns COMBINE_OK or a REFUSAL_CODE value. left and right may only use the slots of
 * rules. out.result may be the same object as left or right: it is written after both are read.
 */
export function combineCompiled(
  rules: CompiledRules,
  left: Readonly<PackedObject>,
  right: Readonly<PackedObject>,
  rename: boolean,
  levelCap: number | null,
  out: PackedCombineOut,
): number {
  if (left.kind === KIND_BOOK) {
    if (right.kind === KIND_ITEM) return ITEM_ONTO_BOOK
  } else if (right.kind === KIND_ITEM) {
    if (left.itemType !== right.itemType) return DIFFERENT_ITEM_TYPE
    if (rules.damageable[left.itemType] === 0) return NOT_DAMAGEABLE
  }

  const java = rules.java
  const applicableMask = left.kind === KIND_BOOK ? rules.allSlots : rules.applicable[left.itemType]
  const multipliers = right.kind === KIND_BOOK ? rules.bookMultiplier : rules.itemMultiplier
  const leftMask = left.mask
  let w0 = left.w0
  let w1 = left.w1
  let w2 = left.w2
  let mask = leftMask
  let enchantCost = 0
  let conflictPenalty = 0
  let applied = 0
  let rejected = 0
  let changed = 0

  let pending = right.mask
  while (pending !== 0) {
    const bit = pending & -pending
    pending ^= bit
    const slot = 31 - Math.clz32(bit)
    // Against the left object's original enchantments, since the right one never conflicts with itself
    const conflicts = rules.exclusive[slot] & leftMask
    if (java && conflicts !== 0) conflictPenalty += popcount(conflicts)
    if (conflicts !== 0 || (applicableMask & bit) === 0) {
      rejected++
      continue
    }
    const shift = (slot % SLOTS_PER_WORD) * BITS_PER_LEVEL
    const wordIndex = slot < SLOTS_PER_WORD ? 0 : slot < 2 * SLOTS_PER_WORD ? 1 : 2
    const r = ((wordIndex === 0 ? right.w0 : wordIndex === 1 ? right.w1 : right.w2) >>> shift) & MAX_PACKED_LEVEL
    const q = ((wordIndex === 0 ? left.w0 : wordIndex === 1 ? left.w1 : left.w2) >>> shift) & MAX_PACKED_LEVEL
    let level = q === r ? r + 1 : q > r ? q : r
    const max = rules.maxLevel[slot]
    if (level > max) level = max
    if (java) {
      enchantCost += multipliers[slot] * level
    } else {
      enchantCost += multipliers[slot] * (level - q)
      if (level > q) changed++
    }
    const clear = ~(MAX_PACKED_LEVEL << shift)
    if (wordIndex === 0) w0 = (w0 & clear) | (level << shift)
    else if (wordIndex === 1) w1 = (w1 & clear) | (level << shift)
    else w2 = (w2 & clear) | (level << shift)
    mask |= bit
    applied++
  }

  if (applied === 0 && rejected > 0) return NOTHING_TRANSFERS
  if (java ? enchantCost + conflictPenalty === 0 : changed === 0) return NO_EFFECT

  const cost = packedPwp(left.uses) + packedPwp(right.uses) + enchantCost + conflictPenalty + (rename ? 1 : 0)
  out.cost = cost
  if (levelCap !== null && cost > levelCap) return TOO_EXPENSIVE

  const result = out.result
  result.kind = left.kind
  result.itemType = left.itemType
  result.mask = mask
  result.w0 = w0
  result.w1 = w1
  result.w2 = w2
  result.uses = (left.uses > right.uses ? left.uses : right.uses) + 1
  result.named = rename ? 1 : left.named
  return COMBINE_OK
}

/** rules.renameOnly on a packed object. */
export function renameOnlyCompiled(
  rules: CompiledRules,
  obj: Readonly<PackedObject>,
  levelCap: number | null,
  out: PackedCombineOut,
): number {
  const unclamped = packedPwp(obj.uses) + 1
  const cost = rules.java && unclamped > JAVA_RENAME_ONLY_MAX_COST ? JAVA_RENAME_ONLY_MAX_COST : unclamped
  out.cost = cost
  if (levelCap !== null && cost > levelCap) return TOO_EXPENSIVE
  copyPackedObject(obj, out.result)
  out.result.named = 1
  return COMBINE_OK
}

function popcount(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24
}

// Compiled problem

export interface CompiledGoal {
  readonly mask: number
  readonly levels: Uint8Array            // slot -> required level, 0 when not in the goal
  /** Goal enchantments that no input carries, so the goal cannot be met. */
  readonly missing: readonly EnchantmentId[]
}

export interface CompiledProblem extends CompiledRules {
  /** null for the inputs left out of the search. */
  readonly inputs: readonly (Readonly<PackedObject> | null)[]
  readonly targetIndex: number | null
  readonly groups: readonly InputGroup[]
  /** null asks for a maximal result. */
  readonly goal: CompiledGoal | null
}

/** The slot assignment: the enchantments on the inputs the search uses, in data order. */
export function enchantmentUniverse(np: NormalizedProblem): EnchantmentId[] {
  const present = new Set<EnchantmentId>()
  const excluded = new Set(np.excludedInputs)
  np.inputs.forEach((input, index) => {
    if (!excluded.has(index)) for (const [id] of levelEntries(input.enchantments)) present.add(id)
  })
  return GAME_DATA.enchantments.map((e) => e.id).filter((id) => present.has(id))
}

/** Throws when the inputs carry more than PACKED_SLOT_CAPACITY enchantments; check enchantmentUniverse first. */
export function compileProblem(np: NormalizedProblem, settings: Pick<Settings, 'edition'>): CompiledProblem {
  const rules = compileRules(settings.edition, enchantmentUniverse(np))
  const excluded = new Set(np.excludedInputs)
  return {
    ...rules,
    inputs: np.inputs.map((input, index) => (excluded.has(index) ? null : packObject(rules, anvilObjectOf(input)))),
    targetIndex: np.targetIndex,
    groups: groupInputs(np),
    goal: np.goal === null ? null : compileGoal(rules, np.goal),
  }
}

function compileGoal(rules: CompiledRules, goal: EnchantLevels): CompiledGoal {
  let mask = 0
  const levels = new Uint8Array(rules.universe.length)
  const missing: EnchantmentId[] = []
  for (const [id, level] of levelEntries(goal)) {
    const slot = rules.slotOf.get(id)
    if (slot === undefined) {
      missing.push(id)
      continue
    }
    mask |= 1 << slot
    levels[slot] = level
  }
  return { mask, levels, missing }
}

export function meetsGoal(problem: CompiledProblem, obj: Readonly<PackedObject>): boolean {
  const goal = problem.goal
  if (goal === null) return true
  if (goal.missing.length > 0 || (obj.mask & goal.mask) !== goal.mask) return false
  let pending = goal.mask
  while (pending !== 0) {
    const slot = 31 - Math.clz32(pending)
    pending &= ~(1 << slot)
    if (levelAt(obj, slot) < goal.levels[slot]) return false
  }
  return true
}
