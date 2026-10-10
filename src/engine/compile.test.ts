import fc from 'fast-check'
import { enchantmentsInEdition, isApplicable, itemsInEdition, maxLevel } from '../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../data/types.ts'
import {
  COMBINE_OK,
  combineCompiled,
  compileProblem,
  compileRules,
  copyPackedObject,
  createCombineOut,
  createPackedObject,
  enchantmentUniverse,
  itemTypeCode,
  ITEM_TYPE_CODES,
  KIND_BOOK,
  KIND_ITEM,
  levelAt,
  levelsDominate,
  meetsGoal,
  NO_ITEM_TYPE,
  PACKED_SLOT_CAPACITY,
  packedPwp,
  packObject,
  REFUSAL_CODE,
  refusalReasonOf,
  renameOnlyCompiled,
  samePackedObject,
  unpackObject,
  type CompiledRules,
} from './compile.ts'
import { LIMITS } from './limits.ts'
import { normalizeProblem } from './normalize.ts'
import { combine, levelEntries, pwp, REFUSAL_REASONS, renameOnly, type AnvilObject, type CombineOutcome } from './rules.ts'
import type { AdvancedProblem, EnchantLevels, Settings } from './types.ts'

const EDITIONS: readonly Edition[] = ['java', 'bedrock']
const SEED = 20260927

const item = (itemType: ItemTypeId, enchantments: EnchantLevels = {}, anvilUses = 0, named = false): AnvilObject =>
  ({ kind: 'item', itemType, enchantments, anvilUses, named })
const book = (enchantments: EnchantLevels, anvilUses = 0, named = false): AnvilObject =>
  ({ kind: 'book', itemType: null, enchantments, anvilUses, named })

function rulesFor(edition: Edition, ...objects: AnvilObject[]): CompiledRules {
  const ids = new Set(objects.flatMap((obj) => levelEntries(obj.enchantments).map(([id]) => id)))
  return compileRules(edition, enchantmentsInEdition(edition).map((e) => e.id).filter((id) => ids.has(id)))
}

/** Returns the rules.combine outcome. */
function expectEquivalent(rules: CompiledRules, left: AnvilObject, right: AnvilObject, rename: boolean, levelCap: number | null): CombineOutcome {
  const expected = combine(left, right, { edition: rules.edition, levelCap, rename })
  const out = createCombineOut()
  out.cost = -1
  const code = combineCompiled(rules, packObject(rules, left), packObject(rules, right), rename, levelCap, out)
  if (expected.ok) {
    expect(code).toBe(COMBINE_OK)
    expect(out.cost).toBe(expected.cost)
    expect(unpackObject(rules, out.result)).toEqual(expected.result)
    expect(samePackedObject(out.result, packObject(rules, expected.result))).toBe(true)
    expect(out.result.mask).toBe(packObject(rules, expected.result).mask)
  } else {
    expect(code).not.toBe(COMBINE_OK)
    expect(refusalReasonOf(code)).toBe(expected.reason)
    if (expected.reason === 'too-expensive') expect(out.cost).toBe(expected.cost)
    else expect(out.cost).toBe(-1)
  }
  return expected
}

describe('packing', () => {
  it('round-trips objects and reads levels per slot, across all three words', () => {
    const universe = enchantmentsInEdition('java').map((e) => e.id).slice(0, PACKED_SLOT_CAPACITY)
    const rules = compileRules('java', universe)
    const levels: EnchantLevels = {}
    universe.forEach((id, slot) => { if (slot % 3 !== 1) levels[id] = 1 + (slot % maxLevel(id)) })
    for (const obj of [book(levels, 4, true), item('sword', { [universe[29]]: maxLevel(universe[29]) }, 0), item('boots')]) {
      const packed = packObject(rules, obj)
      expect(unpackObject(rules, packed)).toEqual({ ...obj, enchantments: Object.fromEntries(levelEntries(obj.enchantments)) })
      universe.forEach((id, slot) => expect(levelAt(packed, slot)).toBe(obj.enchantments[id] ?? 0))
      expect(packed.mask).toBe(universe.reduce((mask, id, slot) => (obj.enchantments[id] ? mask | (1 << slot) : mask), 0))
    }
  })

  it('encodes kind, item type, uses and name', () => {
    const rules = compileRules('java', ['mending'])
    expect(packObject(rules, book({ mending: 1 }, 3, true))).toMatchObject({ kind: KIND_BOOK, itemType: NO_ITEM_TYPE, uses: 3, named: 1 })
    expect(packObject(rules, item('boots', {}, 2))).toMatchObject({ kind: KIND_ITEM, itemType: itemTypeCode('boots'), uses: 2, named: 0 })
    expect(ITEM_TYPE_CODES[itemTypeCode('boots')]).toBe('boots')
  })

  it('rejects enchantments outside the universe and unpackable levels', () => {
    const rules = compileRules('java', ['mending'])
    expect(() => packObject(rules, book({ unbreaking: 1 }))).toThrow(/unbreaking/)
    expect(() => packObject(rules, book({ mending: 8 }))).toThrow(/cannot be packed/)
    expect(() => packObject(rules, { kind: 'item', itemType: null, enchantments: {}, anvilUses: 0, named: false })).toThrow(/itemType/)
  })

  it('copyPackedObject and samePackedObject', () => {
    const rules = compileRules('java', ['mending', 'unbreaking'])
    const a = packObject(rules, item('boots', { unbreaking: 3 }, 1))
    const b = createPackedObject()
    expect(samePackedObject(a, b)).toBe(false)
    copyPackedObject(a, b)
    expect(samePackedObject(a, b)).toBe(true)
    b.named = 1
    expect(samePackedObject(a, b)).toBe(false)
  })

  it('levelsDominate: ≥ everywhere and > somewhere, absent = 0', () => {
    const rules = compileRules('java', ['feather_falling', 'unbreaking', 'mending'])
    const p = (levels: EnchantLevels) => packObject(rules, book(levels))
    expect(levelsDominate(p({ unbreaking: 3, feather_falling: 2 }), p({ unbreaking: 2, feather_falling: 2 }))).toBe(true)
    expect(levelsDominate(p({ unbreaking: 3, feather_falling: 2 }), p({ unbreaking: 2, feather_falling: 3 }))).toBe(false)
    expect(levelsDominate(p({ unbreaking: 3 }), p({ unbreaking: 3 }))).toBe(false)
    expect(levelsDominate(p({ unbreaking: 3, mending: 1 }), p({ unbreaking: 3 }))).toBe(true)
    expect(levelsDominate(p({ unbreaking: 3 }), p({ unbreaking: 3, mending: 1 }))).toBe(false)
    expect(levelsDominate(p({}), p({}))).toBe(false)
  })

  it('packedPwp equals rules.pwp', () => {
    for (let uses = 0; uses <= 70; uses++) expect(packedPwp(uses)).toBe(pwp(uses))
  })
})

describe('compileRules', () => {
  it('builds the tables from the edition data', () => {
    const rules = compileRules('java', ['impaling', 'sharpness', 'unbreaking'])
    expect([...rules.bookMultiplier]).toEqual([2, 1, 1])
    expect([...rules.itemMultiplier]).toEqual([4, 1, 2])
    expect([...rules.maxLevel]).toEqual([5, 5, 3])
    expect([...rules.exclusive]).toEqual([0b010, 0b001, 0])
    expect(rules.applicable[itemTypeCode('trident')]).toBe(0b101)
    expect(rules.applicable[itemTypeCode('sword')]).toBe(0b110)
    expect(rules.damageable[itemTypeCode('carved_pumpkin')]).toBe(0)
    expect(rules.allSlots).toBe(0b111)
    const bedrock = compileRules('bedrock', ['impaling', 'sharpness', 'unbreaking'])
    expect([...bedrock.bookMultiplier]).toEqual([1, 1, 1])
    expect([...bedrock.exclusive]).toEqual([0, 0, 0])
  })

  it('accepts exactly PACKED_SLOT_CAPACITY enchantments (the limit of LIMITS.exactMaxDistinctEnchantments)', () => {
    const ids = enchantmentsInEdition('java').map((e) => e.id)
    expect(LIMITS.exactMaxDistinctEnchantments).toBeLessThanOrEqual(PACKED_SLOT_CAPACITY)
    expect(compileRules('java', ids.slice(0, PACKED_SLOT_CAPACITY)).allSlots).toBe(2 ** PACKED_SLOT_CAPACITY - 1)
    expect(() => compileRules('java', ids.slice(0, PACKED_SLOT_CAPACITY + 1))).toThrow(RangeError)
  })

  it('rejects duplicates and enchantments that are not in the edition', () => {
    expect(() => compileRules('java', ['mending', 'mending'])).toThrow(/duplicate/)
    expect(() => compileRules('bedrock', ['sweeping_edge'])).toThrow(/sweeping_edge/)
  })

  it('maps every refusal reason to a code and back', () => {
    for (const reason of REFUSAL_REASONS) expect(refusalReasonOf(REFUSAL_CODE[reason])).toBe(reason)
    expect(new Set(Object.values(REFUSAL_CODE)).size).toBe(REFUSAL_REASONS.length)
    expect(Object.values(REFUSAL_CODE)).not.toContain(COMBINE_OK)
    expect(() => refusalReasonOf(COMBINE_OK)).toThrow()
  })
})

describe('combineCompiled on the single-step rule cases', () => {
  const trident = item('trident', { loyalty: 3, channeling: 1 })
  const cases: ReadonlyArray<[string, Edition, AnvilObject, AnvilObject, boolean, number | null]> = [
    ['sword + Sharpness V book', 'java', item('sword'), book({ sharpness: 5 }), false, 39],
    ['boots + Thorns III book', 'java', item('boots'), book({ thorns: 3 }), false, 39],
    ['sword + sword with Sharpness V, Looting III', 'java', item('sword'), item('sword', { sharpness: 5, looting: 3 }), false, 39],
    ['Riptide book onto a Loyalty, Channeling trident', 'java', trident, book({ riptide: 3, unbreaking: 3 }), false, 39],
    ['Riptide book onto a Loyalty, Channeling trident', 'bedrock', trident, book({ riptide: 3, unbreaking: 3 }), false, 39],
    ['Smite book onto a Sharpness sword', 'java', item('sword', { sharpness: 5 }), book({ smite: 5 }), false, 39],
    ['Density, Unbreaking book onto a Sharpness sword', 'java', item('sword', { sharpness: 5 }), book({ density: 5, unbreaking: 3 }), false, 39],
    ['Efficiency IV book + Efficiency IV book', 'java', book({ efficiency: 4 }), book({ efficiency: 4 }), false, 39],
    ['Efficiency IV book + Efficiency IV book', 'bedrock', book({ efficiency: 4 }), book({ efficiency: 4 }), false, 39],
    ['Efficiency V pickaxe + Efficiency III, Unbreaking I book', 'java', item('pickaxe', { efficiency: 5 }), book({ efficiency: 3, unbreaking: 1 }), false, 39],
    ['Efficiency V pickaxe + Efficiency III, Unbreaking I book', 'bedrock', item('pickaxe', { efficiency: 5 }), book({ efficiency: 3, unbreaking: 1 }), false, 39],
    ['Efficiency V pickaxe + Efficiency V book', 'java', item('pickaxe', { efficiency: 5 }), book({ efficiency: 5 }), false, 39],
    ['Efficiency V pickaxe + Efficiency V book', 'bedrock', item('pickaxe', { efficiency: 5 }), book({ efficiency: 5 }), false, 39],
    ['both inputs with prior work', 'java', item('boots', {}, 2), book({ mending: 1 }, 1), false, 39],
    ['sword onto a book', 'java', book({ mending: 1 }), item('sword'), false, 39],
    ['sword + pickaxe', 'java', item('sword'), item('pickaxe', { efficiency: 1 }), false, 39],
    ['carved pumpkin + carved pumpkin', 'java', item('carved_pumpkin'), item('carved_pumpkin', { binding_curse: 1 }), false, 39],
    ['carved pumpkin + Curse of Binding book', 'java', item('carved_pumpkin'), book({ binding_curse: 1 }), false, 39],
    ['boots with 5 anvil uses + Thorns III book, cap 39', 'java', item('boots', {}, 5), book({ thorns: 3 }), false, 39],
    ['boots with 5 anvil uses + Thorns III book, no cap', 'java', item('boots', {}, 5), book({ thorns: 3 }), false, null],
    ['trident + Impaling V book', 'java', item('trident'), book({ impaling: 5 }), false, 39],
    ['trident + Impaling V book', 'bedrock', item('trident'), book({ impaling: 5 }), false, 39],
    ['Sharpness IV sword + Sharpness IV book', 'java', item('sword', { sharpness: 4 }), book({ sharpness: 4 }), false, 39],
    ['Sharpness IV sword + Sharpness IV book', 'bedrock', item('sword', { sharpness: 4 }), book({ sharpness: 4 }), false, 39],
    ['trident + Loyalty III trident', 'java', item('trident'), item('trident', { loyalty: 3 }), false, 39],
    ['Sharpness V book + Impaling V book', 'java', book({ sharpness: 5 }), book({ impaling: 5 }), false, 39],
    ['Sharpness V book + Impaling V book', 'bedrock', book({ sharpness: 5 }), book({ impaling: 5 }), false, 39],
    ['sword + sword without enchantments', 'java', item('sword'), item('sword'), false, 39],
    ['sword + Sharpness V book with rename', 'java', item('sword'), book({ sharpness: 5 }), true, 39],
    ['shears + Silk Touch book', 'java', item('shears'), book({ silk_touch: 1 }), false, 39],
    ['shears + Silk Touch book', 'bedrock', item('shears'), book({ silk_touch: 1 }), false, 39],
    ['Protection IV book + Feather Falling IV, Protection III book', 'java', book({ protection: 4 }), book({ feather_falling: 4, protection: 3 }), false, 39],
    ['Protection IV helmet + Blast Protection IV, Unbreaking III book', 'java', item('helmet', { protection: 4 }), book({ blast_protection: 4, unbreaking: 3 }), false, 39],
    ['Riptide III book + Loyalty III, Channeling book', 'java', book({ riptide: 3 }), book({ loyalty: 3, channeling: 1 }), false, 39],
    ['pickaxe + Sharpness V, Efficiency I book', 'java', item('pickaxe'), book({ sharpness: 5, efficiency: 1 }), false, 39],
    ['pickaxe + Sharpness V, Efficiency I book', 'bedrock', item('pickaxe'), book({ sharpness: 5, efficiency: 1 }), false, 39],
    ['named left keeps its name', 'java', item('boots', {}, 1, true), book({ mending: 1 }, 0, true), false, 39],
  ]

  it.each(cases)('%s (%s)', (_label, edition, left, right, rename, levelCap) => {
    expectEquivalent(rulesFor(edition, left, right), left, right, rename, levelCap)
  })

  it.each<Edition>(['java', 'bedrock'])('%s renameOnlyCompiled equals rules.renameOnly', (edition) => {
    const rules = compileRules(edition, ['unbreaking'])
    for (let uses = 0; uses <= 12; uses++) {
      for (const levelCap of [39, null, 0, 1, 31, 32, 38, 63, 64]) {
        for (const obj of [item('boots', { unbreaking: 3 }, uses), book({ unbreaking: 1 }, uses, true)]) {
          const expected = renameOnly(obj, { edition, levelCap })
          const out = createCombineOut()
          const code = renameOnlyCompiled(rules, packObject(rules, obj), levelCap, out)
          if (expected.ok) {
            expect(code).toBe(COMBINE_OK)
            expect(out.cost).toBe(expected.cost)
            expect(unpackObject(rules, out.result)).toEqual(expected.result)
          } else {
            expect(refusalReasonOf(code)).toBe(expected.reason)
            expect(out.cost).toBe(expected.cost)
          }
        }
      }
    }
  })

  it('writes the result safely when out.result is the left or the right object', () => {
    const rules = compileRules('java', ['sharpness', 'looting'])
    const left = item('sword', { sharpness: 4 }, 1)
    const right = book({ sharpness: 4, looting: 3 }, 2)
    const expected = combine(left, right, { edition: 'java', levelCap: 39, rename: true })
    if (!expected.ok) throw new Error('the step must be accepted')
    for (const alias of ['left', 'right'] as const) {
      const packedLeft = packObject(rules, left)
      const packedRight = packObject(rules, right)
      const out = { cost: 0, result: alias === 'left' ? packedLeft : packedRight }
      expect(combineCompiled(rules, packedLeft, packedRight, true, 39, out)).toBe(COMBINE_OK)
      expect(out.cost).toBe(expected.cost)
      expect(unpackObject(rules, out.result)).toEqual(expected.result)
    }
  })
})

// Randomized equivalence

/** Covers every exclusive set. The curses are for items without durability (carved pumpkin, head, compass). */
const CONFLICT_POOL: readonly EnchantmentId[] = [
  'sharpness', 'smite', 'bane_of_arthropods', 'impaling', 'density', 'breach',
  'protection', 'blast_protection', 'fire_protection', 'projectile_protection',
  'riptide', 'loyalty', 'channeling', 'infinity', 'mending', 'fortune', 'silk_touch',
  'depth_strider', 'frost_walker', 'multishot', 'piercing', 'unbreaking', 'efficiency', 'looting', 'thorns',
  'binding_curse', 'vanishing_curse',
]

interface RandomCase {
  readonly universe: readonly EnchantmentId[]
  readonly left: AnvilObject
  readonly right: AnvilObject
  readonly rename: boolean
  readonly levelCap: number | null
}

function levelsArb(pool: readonly EnchantmentId[]): fc.Arbitrary<EnchantLevels> {
  if (pool.length === 0) return fc.constant({})
  const nonEmpty = fc.subarray([...pool], { minLength: 1, maxLength: Math.min(5, pool.length) }).chain((ids) =>
    fc.array(fc.integer({ min: 1, max: 5 }), { minLength: ids.length, maxLength: ids.length }).map((raw) => {
      const levels: EnchantLevels = {}
      // wrap around at the max level, so enchantments with a low max level often merge equal levels
      ids.forEach((id, i) => { levels[id] = ((raw[i] - 1) % maxLevel(id)) + 1 })
      return levels
    }))
  return fc.oneof({ weight: 1, arbitrary: fc.constant({}) }, { weight: 9, arbitrary: nonEmpty })
}

function objectArb(
  edition: Edition, universe: readonly EnchantmentId[], itemTypes: readonly ItemTypeId[], mainType: ItemTypeId, bookWeight: number,
): fc.Arbitrary<AnvilObject> {
  return fc.record({
    kind: fc.oneof({ weight: 1, arbitrary: fc.constant<AnvilObject['kind']>('item') }, { weight: bookWeight, arbitrary: fc.constant<AnvilObject['kind']>('book') }),
    itemType: fc.oneof({ weight: 5, arbitrary: fc.constant(mainType) }, { weight: 1, arbitrary: fc.constantFrom(...itemTypes) }),
    applicableOnly: fc.oneof({ weight: 4, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
    anvilUses: fc.oneof({ weight: 3, arbitrary: fc.constant(0) }, { weight: 4, arbitrary: fc.integer({ min: 1, max: 6 }) }),
    named: fc.boolean(),
  }).chain(({ kind, itemType, applicableOnly, anvilUses, named }) => {
    // items usually carry only applicable enchantments (validated inputs and the objects made from them)
    const pool = kind === 'item' && applicableOnly ? universe.filter((id) => isApplicable(edition, itemType, id)) : universe
    return levelsArb(pool).map((enchantments): AnvilObject =>
      ({ kind, itemType: kind === 'item' ? itemType : null, enchantments, anvilUses, named }))
  })
}

function caseArb(edition: Edition): fc.Arbitrary<RandomCase> {
  const all = enchantmentsInEdition(edition).map((e) => e.id)
  const conflictPool = CONFLICT_POOL.filter((id) => all.includes(id))
  const itemTypes = itemsInEdition(edition).filter((i) => !i.isBook).map((i) => i.id)
  const universeArb = fc.oneof(
    { weight: 3, arbitrary: fc.shuffledSubarray([...conflictPool], { minLength: 1, maxLength: 10 }) },
    { weight: 1, arbitrary: fc.shuffledSubarray([...all], { minLength: 1, maxLength: 12 }) },
    // use the slots of all three words
    { weight: 1, arbitrary: fc.shuffledSubarray([...all], { minLength: PACKED_SLOT_CAPACITY, maxLength: PACKED_SLOT_CAPACITY }) },
  )
  return universeArb.chain((universe) => {
    const fitting = itemTypes.filter((type) => universe.some((id) => isApplicable(edition, type, id)))
    return fc.constantFrom(...(fitting.length > 0 ? fitting : itemTypes)).chain((mainType) =>
      fc.record({
        universe: fc.constant(universe),
        // the left is an item or a book equally often, the right is mostly a book (so that few pairs put an item onto a book)
        left: objectArb(edition, universe, itemTypes, mainType, 1),
        right: objectArb(edition, universe, itemTypes, mainType, 3),
        rename: fc.boolean(),
        levelCap: fc.oneof(
          { weight: 3, arbitrary: fc.constant<number | null>(39) },
          { weight: 2, arbitrary: fc.constant<number | null>(null) },
          { weight: 1, arbitrary: fc.integer({ min: 0, max: 80 }) },
        ),
      }))
  })
}

/** These usually take 2-5 s, too close to the default 5 s on a busy machine. */
const HEAVY_TEST_TIMEOUT_MS = 60_000

describe('combineCompiled equals rules.combine on random objects', () => {
  it.each(EDITIONS)('%s: 10 000 random pairs', (edition) => {
    const seen = new Map<string, number>()
    const note = (key: string): void => { seen.set(key, (seen.get(key) ?? 0) + 1) }

    fc.assert(
      fc.property(caseArb(edition), ({ universe, left, right, rename, levelCap }) => {
        const rules = compileRules(edition, universe)
        const outcome = expectEquivalent(rules, left, right, rename, levelCap)
        note(outcome.ok ? 'ok' : outcome.reason)
        const lines = outcome.breakdown?.enchantments ?? []
        if (lines.some((line) => line.outcome === 'conflict')) note(outcome.ok ? 'ok-with-conflict' : 'refused-with-conflict')
        if (lines.some((line) => line.outcome === 'inapplicable')) note(outcome.ok ? 'ok-with-inapplicable' : 'refused-with-inapplicable')
        if (lines.some((line) => line.outcome === 'increased')) note('increased')
        if (lines.some((line) => line.outcome === 'unchanged')) note('unchanged')
        if (outcome.ok && rename) note('ok-renamed')
        if (outcome.ok && left.anvilUses + right.anvilUses > 0) note('ok-with-pwp')
        if (outcome.ok && right.kind === 'item') note('ok-item-sacrifice')
        if (outcome.ok && left.kind === 'book') note('ok-book-left')
        if (outcome.ok) {
          // the exact cap boundary: a cap equal to the cost accepts the step, one less refuses it as 'too-expensive'
          expect(expectEquivalent(rules, left, right, rename, outcome.cost).ok).toBe(true)
          expect(expectEquivalent(rules, left, right, rename, outcome.cost - 1)).toMatchObject({ ok: false, reason: 'too-expensive' })
          note('cap-boundary')
        }
      }),
      { numRuns: 10_000, seed: SEED },
    )

    // the generated pairs must cover conflicts, inapplicable enchantments, books and items, PWP, names and the cap
    const required = [
      'ok', ...REFUSAL_REASONS, 'ok-with-conflict', 'refused-with-conflict', 'ok-with-inapplicable', 'refused-with-inapplicable',
      'increased', 'unchanged', 'ok-renamed', 'ok-with-pwp', 'ok-item-sacrifice', 'ok-book-left', 'cap-boundary',
    ]
    for (const key of required) expect(seen.get(key) ?? 0, `${edition}: ${key}`).toBeGreaterThanOrEqual(10)
  }, HEAVY_TEST_TIMEOUT_MS)
})

describe('compileProblem', () => {
  const java: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
  const advanced = (overrides: Partial<AdvancedProblem>): AdvancedProblem =>
    ({ mode: 'advanced', target: null, extraItems: [], books: [], goal: null, useOnlyNeeded: true, ...overrides })
  const compiled = <T,>(input: T | null): T => {
    if (input === null) throw new Error('the input was left out of the search')
    return input
  }

  it('packs every input, uses the enchantments on inputs (data order) as slots, and groups identical inputs', () => {
    const np = normalizeProblem({
      mode: 'simple',
      item: 'mace',
      enchantments: [{ id: 'wind_burst', level: 3, sources: [{ level: 1, count: 4 }] }, { id: 'density', level: 5 }, { id: 'mending', level: 1 }],
    }, java)
    const cp = compileProblem(np, java)
    expect(cp.universe).toEqual(['density', 'mending', 'wind_burst'])
    expect(enchantmentUniverse(np)).toEqual(cp.universe)
    expect(cp.targetIndex).toBe(0)
    expect(cp.inputs.map((input) => unpackObject(cp, compiled(input)))).toEqual(np.inputs.map((input) => ({
      kind: input.kind, itemType: input.itemType, enchantments: input.enchantments, anvilUses: input.anvilUses, named: false,
    })))
    expect(cp.groups).toEqual([{ inputs: [1, 2, 3, 4] }, { inputs: [5] }, { inputs: [6] }])
    expect(cp.goal?.missing).toEqual([])
    expect(cp.goal?.mask).toBe(0b111)
    expect([...(cp.goal?.levels ?? [])]).toEqual([5, 1, 3])
  })

  it('leaves the inputs left out of the search out of the slots and the groups, and does not pack them', () => {
    const np = normalizeProblem(advanced({
      target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 2 }, { enchantments: { power: 5 }, anvilUses: 0, count: 2 }, { enchantments: { mending: 1 }, anvilUses: 1 }],
      goal: { unbreaking: 2 },
    }), java)
    expect(np.excludedInputs).toEqual([3, 4, 5])
    const cp = compileProblem(np, java)
    expect(cp.universe).toEqual(['unbreaking'])
    expect(enchantmentUniverse(np)).toEqual(cp.universe)
    expect(cp.inputs.map((input) => input === null)).toEqual([false, false, false, true, true, true])
    expect(cp.groups).toEqual([{ inputs: [1, 2] }])
  })

  it('meetsGoal compares every goal level; a goal enchantment on no input can never be met', () => {
    const np = normalizeProblem(advanced({
      target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 4 }, { enchantments: { mending: 1 }, anvilUses: 0 }],
      goal: { unbreaking: 3 },
      useOnlyNeeded: false,   // use every input, so the Mending book stays in the search
    }), java)
    const cp = compileProblem(np, java)
    const p = (levels: EnchantLevels) => packObject(cp, item('boots', levels))
    expect(meetsGoal(cp, p({ unbreaking: 3, mending: 1 }))).toBe(true)
    expect(meetsGoal(cp, p({ unbreaking: 2, mending: 1 }))).toBe(false)
    expect(meetsGoal(cp, p({ mending: 1 }))).toBe(false)

    const missing = compileProblem(normalizeProblem(advanced({ books: [{ enchantments: { mending: 1 }, anvilUses: 0 }], goal: { mending: 1, thorns: 1 } }), java), java)
    expect(missing.goal?.missing).toEqual(['thorns'])
    expect(meetsGoal(missing, packObject(missing, book({ mending: 1 })))).toBe(false)

    const noGoal = compileProblem(normalizeProblem(advanced({ books: [{ enchantments: { mending: 1 }, anvilUses: 0 }] }), java), java)
    expect(noGoal.goal).toBeNull()
    expect(meetsGoal(noGoal, compiled(noGoal.inputs[0]))).toBe(true)
  })

  it('combines the compiled inputs like the rules (boots + Unbreaking II + Unbreaking II)', () => {
    const np = normalizeProblem(advanced({
      target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
      books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0 }, { enchantments: { unbreaking: 2 }, anvilUses: 0, count: 2 }],
      goal: { unbreaking: 3 },
    }), java)
    const cp = compileProblem(np, java)
    const first = createCombineOut()
    expect(combineCompiled(cp, compiled(cp.inputs[0]), compiled(cp.inputs[2]), false, 39, first)).toBe(COMBINE_OK)
    expect(first.cost).toBe(2)
    const second = createCombineOut()
    expect(combineCompiled(cp, first.result, compiled(cp.inputs[3]), false, 39, second)).toBe(COMBINE_OK)
    expect(second.cost).toBe(4)
    expect(meetsGoal(cp, second.result)).toBe(true)
    expect(second.result.uses).toBe(2)
  })

  it('throws a RangeError when the inputs carry more distinct enchantments than can be packed', () => {
    const ids = enchantmentsInEdition('java').map((e) => e.id).slice(0, PACKED_SLOT_CAPACITY + 1)
    const np = normalizeProblem(advanced({ books: ids.map((id) => ({ enchantments: { [id]: 1 }, anvilUses: 0 })) }), java)
    expect(enchantmentUniverse(np)).toHaveLength(PACKED_SLOT_CAPACITY + 1)
    expect(() => compileProblem(np, java)).toThrow(RangeError)
  })
})
