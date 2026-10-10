import type { Edition, ItemTypeId } from '../data/types.ts'
import {
  anvilObjectOf,
  canonicalLevels,
  combine,
  JAVA_RENAME_ONLY_MAX_COST,
  levelEntries,
  pwp,
  renameOnly,
  type AnvilObject,
  type CombineOutcome,
  type RuleContext,
} from './rules.ts'
import type { EnchantCostLine, EnchantLevels, StepCost } from './types.ts'

const item = (itemType: ItemTypeId, enchantments: EnchantLevels = {}, anvilUses = 0): AnvilObject =>
  ({ kind: 'item', itemType, enchantments, anvilUses, named: false })
const book = (enchantments: EnchantLevels, anvilUses = 0): AnvilObject =>
  ({ kind: 'book', itemType: null, enchantments, anvilUses, named: false })
const ctx = (edition: Edition, overrides: Partial<Omit<RuleContext, 'edition'>> = {}): RuleContext =>
  ({ edition, levelCap: 39, rename: false, ...overrides })

type Accepted = Extract<CombineOutcome, { ok: true }>
type Refused = Extract<CombineOutcome, { ok: false }>

/** Also checks that the cost breakdown adds up to the total. */
function accepted(outcome: CombineOutcome): Accepted {
  if (!outcome.ok) throw new Error(`expected accepted, got refused: ${outcome.reason}`)
  expectCostsAddUp(outcome.breakdown)
  expect(outcome.cost).toBe(outcome.breakdown.total)
  return outcome
}

function refused(outcome: CombineOutcome): Refused {
  if (outcome.ok) throw new Error(`expected refused, got accepted with cost ${outcome.cost}`)
  return outcome
}

function expectCostsAddUp(breakdown: StepCost): void {
  const enchantCost = breakdown.enchantments.reduce((total, line) => total + line.cost, 0)
  const conflicts = breakdown.enchantments.reduce((total, line) => total + line.conflictsWith.length, 0)
  if (breakdown.clampedFrom === null) {
    expect(breakdown.total).toBe(breakdown.leftPenalty + breakdown.rightPenalty + enchantCost + breakdown.conflictPenalty + breakdown.rename)
  } else {
    expect(breakdown.total).toBe(JAVA_RENAME_ONLY_MAX_COST)
    expect(breakdown.clampedFrom).toBeGreaterThan(breakdown.total)
  }
  // Java: one per conflicting left enchantment, summed over the lines; Bedrock: always 0
  expect([0, conflicts]).toContain(breakdown.conflictPenalty)
}

function line(outcome: Accepted | Refused, id: EnchantCostLine['id']): EnchantCostLine {
  const found = outcome.breakdown?.enchantments.find((l) => l.id === id)
  if (found === undefined) throw new Error(`no cost line for ${id}`)
  return found
}

describe('pwp', () => {
  it.each([[0, 0], [1, 1], [2, 3], [3, 7], [4, 15], [5, 31], [6, 63], [10, 1023]])('uses %i -> %i', (uses, penalty) => {
    expect(pwp(uses)).toBe(penalty)
  })
})

describe('single anvil steps', () => {
  it('Java: sword + book{Sharpness V} = 5, uses 1', () => {
    const outcome = accepted(combine(item('sword'), book({ sharpness: 5 }), ctx('java')))
    expect(outcome.cost).toBe(5)
    expect(outcome.result).toEqual({ kind: 'item', itemType: 'sword', enchantments: { sharpness: 5 }, anvilUses: 1, named: false })
    expect(outcome.breakdown).toEqual({
      leftPenalty: 0,
      rightPenalty: 0,
      enchantments: [{
        id: 'sharpness', leftLevel: 0, rightLevel: 5, resultLevel: 5, multiplier: 1, multiplierKind: 'book',
        cost: 5, outcome: 'added', conflictsWith: [],
      }],
      conflictPenalty: 0,
      rename: 0,
      clampedFrom: null,
      total: 5,
    })
  })

  it('Java: boots + book{Thorns III} = 12 (book multiplier 4)', () => {
    const outcome = accepted(combine(item('boots'), book({ thorns: 3 }), ctx('java')))
    expect(outcome.cost).toBe(12)
    expect(line(outcome, 'thorns').multiplier).toBe(4)
  })

  it('Java: sword + sword{Sharpness V, Looting III} = 17 (item multipliers 1 and 4)', () => {
    const outcome = accepted(combine(item('sword'), item('sword', { sharpness: 5, looting: 3 }), ctx('java')))
    expect(outcome.cost).toBe(17)
    expect(line(outcome, 'sharpness')).toMatchObject({ multiplier: 1, multiplierKind: 'item', cost: 5 })
    expect(line(outcome, 'looting')).toMatchObject({ multiplier: 4, multiplierKind: 'item', cost: 12 })
    expect(outcome.result.enchantments).toEqual({ sharpness: 5, looting: 3 })
  })

  const trident = item('trident', { loyalty: 3, channeling: 1 })
  const riptideBook = book({ riptide: 3, unbreaking: 3 })

  it('Java: trident{Loyalty III, Channeling} + book{Riptide III, Unbreaking III} = 5 (+2 conflict + 3)', () => {
    const outcome = accepted(combine(trident, riptideBook, ctx('java')))
    expect(outcome.cost).toBe(5)
    expect(outcome.breakdown.conflictPenalty).toBe(2)
    expect(line(outcome, 'riptide')).toMatchObject({ outcome: 'conflict', cost: 0, resultLevel: 0, conflictsWith: ['channeling', 'loyalty'] })
    expect(line(outcome, 'unbreaking')).toMatchObject({ outcome: 'added', cost: 3 })
    expect(outcome.result.enchantments).toEqual({ channeling: 1, loyalty: 3, unbreaking: 3 })
  })

  it('Bedrock: the same trident and book = 3 (no conflict penalty, the rest still transfers)', () => {
    const outcome = accepted(combine(trident, riptideBook, ctx('bedrock')))
    expect(outcome.cost).toBe(3)
    expect(outcome.breakdown.conflictPenalty).toBe(0)
    expect(line(outcome, 'riptide')).toMatchObject({ outcome: 'conflict', cost: 0, conflictsWith: ['channeling', 'loyalty'] })
    expect(outcome.result.enchantments).toEqual({ channeling: 1, loyalty: 3, unbreaking: 3 })
  })

  it.each<Edition>(['java', 'bedrock'])('%s: sword{Sharpness V} + book{Smite V} is refused as nothing-transfers', (edition) => {
    const outcome = refused(combine(item('sword', { sharpness: 5 }), book({ smite: 5 }), ctx(edition)))
    expect(outcome.reason).toBe('nothing-transfers')
    expect(outcome.cost).toBeUndefined()
    expect(line(outcome, 'smite')).toMatchObject({ outcome: 'conflict', conflictsWith: ['sharpness'] })
  })

  it('Java: sword{Sharpness V} + book{Density V, Unbreaking III} = 4 (the inapplicable Density still conflicts)', () => {
    const outcome = accepted(combine(item('sword', { sharpness: 5 }), book({ density: 5, unbreaking: 3 }), ctx('java')))
    expect(outcome.cost).toBe(4)
    expect(line(outcome, 'density')).toMatchObject({ outcome: 'conflict', conflictsWith: ['sharpness'], cost: 0, resultLevel: 0 })
    expect(outcome.breakdown.conflictPenalty).toBe(1)
    expect(outcome.result.enchantments).toEqual({ sharpness: 5, unbreaking: 3 })
  })

  it.each<[Edition, number]>([['java', 5], ['bedrock', 1]])('%s: book{Efficiency IV} + book{Efficiency IV} = %i, result Efficiency V', (edition, cost) => {
    const outcome = accepted(combine(book({ efficiency: 4 }), book({ efficiency: 4 }), ctx(edition)))
    expect(outcome.cost).toBe(cost)
    expect(outcome.result).toEqual({ kind: 'book', itemType: null, enchantments: { efficiency: 5 }, anvilUses: 1, named: false })
    expect(line(outcome, 'efficiency').outcome).toBe('increased')
  })

  it.each<[Edition, number]>([['java', 6], ['bedrock', 1]])('%s: pickaxe{Efficiency V} + book{Efficiency III, Unbreaking I} = %i', (edition, cost) => {
    const outcome = accepted(combine(item('pickaxe', { efficiency: 5 }), book({ efficiency: 3, unbreaking: 1 }), ctx(edition)))
    expect(outcome.cost).toBe(cost)
    // Java also charges 5 for the unchanged Efficiency V; Bedrock charges only for the levels gained
    expect(line(outcome, 'efficiency')).toMatchObject({ outcome: 'unchanged', resultLevel: 5, cost: edition === 'java' ? 5 : 0 })
    expect(outcome.result.enchantments).toEqual({ efficiency: 5, unbreaking: 1 })
  })

  it('Java: pickaxe{Efficiency V} + book{Efficiency V} = 5', () => {
    expect(accepted(combine(item('pickaxe', { efficiency: 5 }), book({ efficiency: 5 }), ctx('java'))).cost).toBe(5)
  })

  it('Bedrock: pickaxe{Efficiency V} + book{Efficiency V} is refused as no-effect (no level changes)', () => {
    const outcome = refused(combine(item('pickaxe', { efficiency: 5 }), book({ efficiency: 5 }), ctx('bedrock')))
    expect(outcome.reason).toBe('no-effect')
    expect(line(outcome, 'efficiency')).toMatchObject({ outcome: 'unchanged', cost: 0 })
  })

  it('Java: boots(uses 2) + book{Mending}(uses 1) = 6 = 3 + 1 + 2, result uses 3', () => {
    const outcome = accepted(combine(item('boots', {}, 2), book({ mending: 1 }, 1), ctx('java')))
    expect(outcome.cost).toBe(6)
    expect(outcome.breakdown).toMatchObject({ leftPenalty: 3, rightPenalty: 1 })
    expect(outcome.result.anvilUses).toBe(3)
  })

  it('Java: book{Mending} + sword is refused as item-onto-book', () => {
    expect(refused(combine(book({ mending: 1 }), item('sword'), ctx('java')))).toEqual({ ok: false, reason: 'item-onto-book' })
  })

  it('Java: sword + pickaxe{Efficiency I} is refused as different-item-type', () => {
    expect(refused(combine(item('sword'), item('pickaxe', { efficiency: 1 }), ctx('java')))).toEqual({ ok: false, reason: 'different-item-type' })
  })

  it('Java: carved_pumpkin + carved_pumpkin{Binding} is refused as not-damageable; with a book it costs 4', () => {
    expect(refused(combine(item('carved_pumpkin'), item('carved_pumpkin', { binding_curse: 1 }), ctx('java'))))
      .toEqual({ ok: false, reason: 'not-damageable' })
    expect(accepted(combine(item('carved_pumpkin'), book({ binding_curse: 1 }), ctx('java'))).cost).toBe(4)
  })

  it('Java: boots(uses 5) + book{Thorns III} is refused as too-expensive (43); without a cap 43, uses 6', () => {
    const capped = refused(combine(item('boots', {}, 5), book({ thorns: 3 }), ctx('java')))
    expect(capped.reason).toBe('too-expensive')
    expect(capped.cost).toBe(43)
    expect(capped.breakdown?.total).toBe(43)
    const uncapped = accepted(combine(item('boots', {}, 5), book({ thorns: 3 }), ctx('java', { levelCap: null })))
    expect(uncapped.cost).toBe(43)
    expect(uncapped.result.anvilUses).toBe(6)
  })

  it.each<[Edition, number]>([['java', 10], ['bedrock', 5]])('%s: trident + book{Impaling V} = %i', (edition, cost) => {
    expect(accepted(combine(item('trident'), book({ impaling: 5 }), ctx(edition))).cost).toBe(cost)
  })

  it.each<[Edition, number]>([['java', 5], ['bedrock', 1]])('%s: sword{Sharpness IV} + book{Sharpness IV} = %i', (edition, cost) => {
    const outcome = accepted(combine(item('sword', { sharpness: 4 }), book({ sharpness: 4 }), ctx(edition)))
    expect(outcome.cost).toBe(cost)
    expect(outcome.result.enchantments).toEqual({ sharpness: 5 })
  })

  it('Java: trident + trident{Loyalty III} = 6 (Loyalty item multiplier 2)', () => {
    const outcome = accepted(combine(item('trident'), item('trident', { loyalty: 3 }), ctx('java')))
    expect(outcome.cost).toBe(6)
    expect(line(outcome, 'loyalty').multiplier).toBe(2)
  })

  it('Java: book{Sharpness V} + book{Impaling V} is refused as nothing-transfers', () => {
    expect(refused(combine(book({ sharpness: 5 }), book({ impaling: 5 }), ctx('java'))).reason).toBe('nothing-transfers')
  })

  it('Bedrock: book{Sharpness V} + book{Impaling V} = 5 (Impaling is not exclusive)', () => {
    const outcome = accepted(combine(book({ sharpness: 5 }), book({ impaling: 5 }), ctx('bedrock')))
    expect(outcome.cost).toBe(5)
    expect(outcome.result.enchantments).toEqual({ impaling: 5, sharpness: 5 })
  })

  it('Java: sword + sword (no enchantments) is refused as no-effect', () => {
    expect(refused(combine(item('sword'), item('sword'), ctx('java'))).reason).toBe('no-effect')
  })

  it('Java: sword + book{Sharpness V} with rename = 6', () => {
    const outcome = accepted(combine(item('sword'), book({ sharpness: 5 }), ctx('java', { rename: true })))
    expect(outcome.cost).toBe(6)
    expect(outcome.breakdown.rename).toBe(1)
    expect(outcome.result.named).toBe(true)
  })

  it('Java: shears + book{Silk Touch} is refused as nothing-transfers', () => {
    const outcome = refused(combine(item('shears'), book({ silk_touch: 1 }), ctx('java')))
    expect(outcome.reason).toBe('nothing-transfers')
    expect(line(outcome, 'silk_touch')).toMatchObject({ outcome: 'inapplicable', conflictsWith: [] })
  })

  it('Bedrock: shears + book{Silk Touch} = 4', () => {
    expect(accepted(combine(item('shears'), book({ silk_touch: 1 }), ctx('bedrock'))).cost).toBe(4)
  })

  it('Java: book{Protection IV} + book{Feather Falling IV, Protection III} = 8 (Protection stays IV, charged 4)', () => {
    const outcome = accepted(combine(book({ protection: 4 }), book({ feather_falling: 4, protection: 3 }), ctx('java')))
    expect(outcome.cost).toBe(8)
    expect(line(outcome, 'protection')).toMatchObject({ outcome: 'unchanged', leftLevel: 4, rightLevel: 3, resultLevel: 4, cost: 4 })
    expect(outcome.result.enchantments).toEqual({ feather_falling: 4, protection: 4 })
  })

  it('Java: helmet{Protection IV} + book{Blast Protection IV, Unbreaking III} = 4 = +1 + 3', () => {
    const outcome = accepted(combine(item('helmet', { protection: 4 }), book({ blast_protection: 4, unbreaking: 3 }), ctx('java')))
    expect(outcome.cost).toBe(4)
    expect(outcome.breakdown.conflictPenalty).toBe(1)
    expect(outcome.result.enchantments).toEqual({ protection: 4, unbreaking: 3 })
  })

  it('Java: book{Riptide III} + book{Loyalty III, Channeling} is refused as nothing-transfers (+2 would apply)', () => {
    const outcome = refused(combine(book({ riptide: 3 }), book({ loyalty: 3, channeling: 1 }), ctx('java')))
    expect(outcome.reason).toBe('nothing-transfers')
    expect(outcome.breakdown?.conflictPenalty).toBe(2)
  })

  it('Java: renameOnly on uses 6 (PWP 63) = 39 with clampedFrom 64', () => {
    const outcome = accepted(renameOnly(item('boots', { unbreaking: 3 }, 6), ctx('java')))
    expect(outcome.cost).toBe(39)
    expect(outcome.breakdown).toEqual({
      leftPenalty: 63, rightPenalty: 0, enchantments: [], conflictPenalty: 0, rename: 1, clampedFrom: 64, total: 39,
    })
    expect(outcome.result).toEqual({ kind: 'item', itemType: 'boots', enchantments: { unbreaking: 3 }, anvilUses: 6, named: true })
  })

  it('Bedrock: renameOnly on uses 6 (PWP 63) is refused as too-expensive (64)', () => {
    const outcome = refused(renameOnly(item('boots', { unbreaking: 3 }, 6), ctx('bedrock')))
    expect(outcome.reason).toBe('too-expensive')
    expect(outcome.cost).toBe(64)
    expect(outcome.breakdown?.clampedFrom).toBeNull()
  })

  it.each<Edition>(['java', 'bedrock'])('%s: pickaxe + book{Sharpness V, Efficiency I} = 1 (Sharpness is inapplicable, no cost)', (edition) => {
    const outcome = accepted(combine(item('pickaxe'), book({ sharpness: 5, efficiency: 1 }), ctx(edition)))
    expect(outcome.cost).toBe(1)
    expect(line(outcome, 'sharpness')).toMatchObject({ outcome: 'inapplicable', conflictsWith: [], cost: 0, resultLevel: 0 })
    expect(outcome.breakdown.conflictPenalty).toBe(0)
    expect(outcome.result.enchantments).toEqual({ efficiency: 1 })
  })
})

describe('Bedrock rules shared with Java, and Bedrock data', () => {
  it('refuses item onto book, different item types and items without durability like Java', () => {
    expect(refused(combine(book({ mending: 1 }), item('sword'), ctx('bedrock'))).reason).toBe('item-onto-book')
    expect(refused(combine(item('sword'), item('pickaxe', { efficiency: 1 }), ctx('bedrock'))).reason).toBe('different-item-type')
    expect(refused(combine(item('carved_pumpkin'), item('carved_pumpkin', { binding_curse: 1 }), ctx('bedrock'))).reason).toBe('not-damageable')
  })

  it('adds both prior work penalties and raises the uses to max + 1, as in Java', () => {
    const outcome = accepted(combine(item('boots', {}, 2), book({ mending: 1 }, 1), ctx('bedrock')))
    expect(outcome.cost).toBe(6)
    expect(outcome.result.anvilUses).toBe(3)
  })

  it('uses the assumed Loyalty item multiplier 2 for a trident sacrifice', () => {
    const outcome = accepted(combine(item('trident'), item('trident', { loyalty: 3 }), ctx('bedrock')))
    expect(outcome.cost).toBe(6)
    expect(line(outcome, 'loyalty').multiplier).toBe(2)
  })
})

describe('level merge (both editions)', () => {
  // [left level q, right level r, result level, Java cost, Bedrock cost] for Efficiency (max V, book multiplier 1)
  it.each<[number, number, number, number, number]>([
    [0, 3, 3, 3, 3],   // q = 0
    [2, 4, 4, 4, 2],   // r > q
    [3, 3, 4, 4, 1],   // r = q < max
    [4, 2, 4, 4, 0],   // r < q (on its own, Bedrock would refuse this step because no level changes)
  ])('q=%i, r=%i -> level %i (Java %i / Bedrock %i)', (q, r, level, javaCost, bedrockCost) => {
    const left = book(q > 0 ? { efficiency: q } : {})
    const right = book({ efficiency: r, unbreaking: 1 })   // Unbreaking I gives Bedrock a level change, so the step is not refused
    const java = accepted(combine(left, right, ctx('java')))
    const bedrock = accepted(combine(left, right, ctx('bedrock')))
    expect(java.result.enchantments.efficiency).toBe(level)
    expect(bedrock.result.enchantments.efficiency).toBe(level)
    expect(line(java, 'efficiency').cost).toBe(javaCost)
    expect(line(bedrock, 'efficiency').cost).toBe(bedrockCost)
  })

  it('r = q = max stays at max: Java still pays max * multiplier, Bedrock refuses the no-change step', () => {
    expect(accepted(combine(book({ sharpness: 5 }), book({ sharpness: 5 }), ctx('java'))).cost).toBe(5)
    expect(refused(combine(book({ sharpness: 5 }), book({ sharpness: 5 }), ctx('bedrock'))).reason).toBe('no-effect')
  })

  it('a lower right level: Java pays the kept left level, Bedrock refuses the no-change step', () => {
    const outcome = accepted(combine(item('sword', { sharpness: 5 }), book({ sharpness: 3 }), ctx('java')))
    expect(outcome.cost).toBe(5)
    expect(line(outcome, 'sharpness').outcome).toBe('unchanged')
    expect(refused(combine(item('sword', { sharpness: 5 }), book({ sharpness: 3 }), ctx('bedrock'))).reason).toBe('no-effect')
  })
})

describe('multiplier selection', () => {
  it('depends on the right input only: book vs item sacrifice', () => {
    expect(accepted(combine(item('sword'), book({ looting: 3 }), ctx('java'))).cost).toBe(6)
    expect(accepted(combine(item('sword'), item('sword', { looting: 3 }), ctx('java'))).cost).toBe(12)
    // the kind of the left input does not matter
    expect(accepted(combine(book({}), book({ looting: 3 }), ctx('java'))).cost).toBe(6)
  })

  it('an item sacrifice built from books pays the item multiplier (Java and Bedrock)', () => {
    const sword = accepted(combine(item('sword'), book({ fire_aspect: 2 }), ctx('java'))).result
    expect(accepted(combine(item('sword'), sword, ctx('java'))).cost).toBe(1 + 4 * 2)
    expect(accepted(combine(item('sword'), sword, ctx('bedrock'))).cost).toBe(1 + 4 * 2)
  })
})

describe('conflicts and applicability', () => {
  it('Java: the +1 counts every conflicting left enchantment, even for an enchantment that also is inapplicable', () => {
    // Bane of Arthropods is applicable and conflicts; Density on a sword (above) is inapplicable and still conflicts
    expect(accepted(combine(item('sword', { sharpness: 5 }), book({ bane_of_arthropods: 5, unbreaking: 3 }), ctx('java'))).cost).toBe(4)
  })

  it('a book on the left accepts enchantments of any item type (applicability is skipped)', () => {
    const outcome = accepted(combine(book({ unbreaking: 1 }), book({ density: 5, riptide: 3 }), ctx('java')))
    expect(outcome.result.enchantments).toEqual({ density: 5, riptide: 3, unbreaking: 1 })
    expect(outcome.cost).toBe(5 + 2 * 3)
  })

  it('Bedrock: a partial conflict transfers the rest without a penalty', () => {
    const outcome = accepted(combine(item('helmet', { protection: 4 }), book({ blast_protection: 4, unbreaking: 3 }), ctx('bedrock')))
    expect(outcome.cost).toBe(3)
    expect(outcome.result.enchantments).toEqual({ protection: 4, unbreaking: 3 })
  })

  it('Bedrock: the recovery compass accepts Curse of Vanishing', () => {
    expect(accepted(combine(item('recovery_compass'), book({ vanishing_curse: 1 }), ctx('bedrock'))).cost).toBe(4)
  })

  it('an enchantment that does not exist in the edition is a programming error (validation rejects it first)', () => {
    expect(() => combine(item('sword'), book({ sweeping_edge: 3 }), ctx('bedrock'))).toThrow(/sweeping_edge/)
  })

  it('nothing-transfers is decided before the cap; item-onto-book before anything else', () => {
    expect(refused(combine(item('boots', {}, 6), book({ smite: 5 }), ctx('java'))).reason).toBe('nothing-transfers')
    expect(refused(combine(book({}, 6), item('sword', { sharpness: 5 }), ctx('java'))).reason).toBe('item-onto-book')
    expect(refused(combine(item('compass'), item('sword'), ctx('java'))).reason).toBe('different-item-type')
  })
})

describe('cap, rename and the result object', () => {
  it.each<Edition>(['java', 'bedrock'])('%s: a step of exactly 39 is accepted, 40 is refused', (edition) => {
    // PWP 31 + Thorns II (book multiplier 4 * 2 = 8) = 39
    expect(accepted(combine(item('boots', {}, 5), book({ thorns: 2 }), ctx(edition))).cost).toBe(39)
    const over = refused(combine(item('boots', {}, 5), book({ thorns: 2 }), ctx(edition, { rename: true })))
    expect(over).toMatchObject({ reason: 'too-expensive', cost: 40 })
  })

  it('levelCap null never refuses for cost; a test override applies as cost > levelCap', () => {
    expect(accepted(combine(item('boots', {}, 8), book({ thorns: 3 }), ctx('java', { levelCap: null }))).cost).toBe(255 + 12)
    expect(refused(combine(item('boots'), book({ thorns: 3 }), ctx('java', { levelCap: 11 }))).reason).toBe('too-expensive')
    expect(accepted(combine(item('boots'), book({ thorns: 3 }), ctx('java', { levelCap: 12 }))).cost).toBe(12)
  })

  it('the result keeps the left kind, type and name; uses = max(left, right) + 1', () => {
    const left: AnvilObject = { ...item('boots', { protection: 4 }, 1), named: true }
    const right: AnvilObject = { ...book({ unbreaking: 3 }, 3), named: true }
    const outcome = accepted(combine(left, right, ctx('java', { levelCap: null })))
    expect(outcome.result).toEqual({ kind: 'item', itemType: 'boots', enchantments: { protection: 4, unbreaking: 3 }, anvilUses: 4, named: true })
    expect(accepted(combine(item('boots'), right, ctx('java', { levelCap: null }))).result.named).toBe(false)
  })

  it.each<[Edition, number, number]>([
    ['java', 0, 1], ['java', 5, 32], ['bedrock', 0, 1], ['bedrock', 5, 32],
  ])('%s renameOnly on uses %i costs %i and keeps the anvil uses', (edition, uses, cost) => {
    const outcome = accepted(renameOnly(book({ mending: 1 }, uses), ctx(edition)))
    expect(outcome.cost).toBe(cost)
    expect(outcome.breakdown.clampedFrom).toBeNull()
    expect(outcome.result).toEqual({ kind: 'book', itemType: null, enchantments: { mending: 1 }, anvilUses: uses, named: true })
  })

  it('Bedrock renameOnly without a cap is not clamped; Java is clamped to 39 even without a cap', () => {
    expect(accepted(renameOnly(item('boots', {}, 6), ctx('bedrock', { levelCap: null }))).cost).toBe(64)
    const java = accepted(renameOnly(item('boots', {}, 10), ctx('java', { levelCap: null })))
    expect(java.cost).toBe(39)
    expect(java.breakdown.clampedFrom).toBe(1024)
  })
})

describe('known plans replayed with the rules', () => {
  const maxBootsBooks = [
    book({ soul_speed: 3 }), book({ thorns: 3 }), book({ feather_falling: 4 }), book({ depth_strider: 3 }),
    book({ protection: 4 }), book({ unbreaking: 3 }), book({ mending: 1 }),
  ]

  function chain(base: AnvilObject, rights: readonly AnvilObject[], context: RuleContext): number[] {
    let current = base
    return rights.map((right) => {
      const outcome = accepted(combine(current, right, context))
      current = outcome.result
      return outcome.cost
    })
  }

  it.each<Edition>(['java', 'bedrock'])('%s: the one-at-a-time chain for boots + the 7 books costs 12, 13, 9, 11, 19, 34, 65 (163)', (edition) => {
    // heaviest first, ties in input order: Soul Speed, Thorns, Depth Strider, Feather Falling, Protection, Unbreaking, Mending
    const order = [0, 1, 3, 2, 4, 5, 6].map((i) => maxBootsBooks[i])
    const costs = chain(item('boots'), order, ctx(edition, { levelCap: null }))
    expect(costs).toEqual([12, 13, 9, 11, 19, 34, 65])
    expect(costs.reduce((a, b) => a + b, 0)).toBe(163)
    // in survival, step 7 is Too Expensive
    expect(() => chain(item('boots'), order, ctx(edition))).toThrow(/too-expensive/)
  })

  it.each<[Edition, number[]]>([['java', [2, 4]], ['bedrock', [2, 2]]])(
    '%s: boots + Unbreaking II, then + Unbreaking II gives Unbreaking III for %j',
    (edition, costs) => {
      expect(chain(item('boots'), [book({ unbreaking: 2 }), book({ unbreaking: 2 })], ctx(edition))).toEqual(costs)
    },
  )

  it('Java: boots(uses 5) + Mending instead of Thorns III costs 33', () => {
    expect(accepted(combine(item('boots', {}, 5), book({ mending: 1 }), ctx('java'))).cost).toBe(33)
  })

  it('Java: the trivial rename-only step on boots(uses 6) costs 39 (xp 2727 is checked in xp.test.ts)', () => {
    expect(accepted(renameOnly(item('boots', { unbreaking: 3 }, 6), ctx('java'))).cost).toBe(39)
  })
})

describe('helpers', () => {
  it('levelEntries lists present enchantments in data order and ignores undefined and 0', () => {
    expect(levelEntries({ unbreaking: 3, efficiency: 5, mending: undefined, sharpness: 0 })).toEqual([['efficiency', 5], ['unbreaking', 3]])
  })

  it('canonicalLevels gives the same key order for the same content', () => {
    expect(Object.keys(canonicalLevels({ unbreaking: 3, efficiency: 5 }))).toEqual(['efficiency', 'unbreaking'])
    expect(canonicalLevels({ mending: undefined })).toEqual({})
  })

  it('anvilObjectOf turns a normalized input into an unnamed object', () => {
    expect(anvilObjectOf({ kind: 'book', itemType: null, enchantments: { mending: 1 }, anvilUses: 2, origin: { source: 'book', index: 0, copy: 0 } }))
      .toEqual({ kind: 'book', itemType: null, enchantments: { mending: 1 }, anvilUses: 2, named: false })
  })
})
