// scripts/gen-data.mjs imports this file through Node's type stripping (22.18+), so it must have no value imports
// and use only erasable syntax.

import type {
  DataSource,
  EnchantmentDef,
  EnchantmentEditionData,
  EnchantmentId,
  GameData,
  ItemDef,
  ItemEditionData,
  ItemGroupId,
  ItemTypeId,
  LocalizedText,
} from './types.ts'

// Paths are relative to the repository root.
export const SOURCE_DATA_PATHS = {
  enchantmentData: 'data/enchantment-data.json',
  japaneseNames: 'data/japanese-names.json',
} as const

export const GENERATED_MODULE_PATH = 'src/data/gameData.generated.ts'

export interface SourceData {
  readonly enchantmentData: unknown
  readonly japaneseNames: unknown
}

// Corrections and additions to the source data

const JAVA_VERSION = '26.3'
const BEDROCK_VERSION = '26.52'
const ENCHANTMENT_COUNT = 43
const ITEM_COUNT = 28

// Array order is the order in the item picker.
const PICKER_GROUPS: Readonly<Record<ItemGroupId, readonly ItemTypeId[]>> = {
  armor: ['helmet', 'turtle_shell', 'chestplate', 'leggings', 'boots', 'elytra', 'shield'],
  weapon: ['sword', 'spear', 'mace', 'trident', 'bow', 'crossbow'],
  tool: [
    'pickaxe', 'axe', 'shovel', 'hoe', 'shears', 'fishing_rod', 'brush', 'flint_and_steel',
    'carrot_on_a_stick', 'warped_fungus_on_a_stick',
  ],
  other: ['compass', 'recovery_compass', 'carved_pumpkin', 'head'],
  book: ['enchanted_book'],
}

// No durability, so two of the same item cannot be combined.
const NOT_DAMAGEABLE: ReadonlySet<string> = new Set(['compass', 'carved_pumpkin', 'head', 'recovery_compass', 'enchanted_book'])

// Two or more of them stacked in the anvil make the cost 40.
const STACKABLE: ReadonlySet<string> = new Set(['compass', 'carved_pumpkin', 'head', 'recovery_compass'])

// Used where the source data has no Bedrock item multiplier; marked with multiplierSource 'assumption'.
const BEDROCK_ASSUMED_ITEM_MULTIPLIERS: Readonly<Record<string, number>> = { loyalty: 2 }

// Keys in japanese-names.json that differ from the item ID.
const ITEM_NAME_KEYS: Readonly<Record<string, string>> = { head: 'mob_head' }

// Missing from japanese-names.json; from item.minecraft.recovery_compass in the official 26.3 ja_jp and en_us.
const ITEM_NAMES_NOT_IN_SOURCE: Readonly<Record<string, LocalizedText>> = {
  recovery_compass: { ja: 'リカバリーコンパス', en: 'Recovery Compass' },
}

// enchantment-data.json does not use the official name for these, so their names are not cross-checked.
const ITEM_NAMES_NOT_FROM_ENCHANTMENT_DATA: ReadonlySet<string> = new Set(['head'])

const EXCLUSIVE_SET_TAG_PREFIX = '#minecraft:exclusive_set/'
const EXCLUSIVE_SET_TAGS: ReadonlySet<string> = new Set(['armor', 'boots', 'bow', 'crossbow', 'damage', 'mining', 'riptide'])

// Reading the source data

interface RawEnchantment {
  readonly id: string
  readonly maxLevel: number
  readonly itemMultiplier: number
  readonly bookMultiplier: number
  readonly exclusiveWith: readonly string[]
  readonly isCurse: boolean
  readonly isTreasure: boolean
  readonly javaOnly: boolean
  readonly bedrockOnly: boolean
  readonly nameJa: string
  readonly nameEn: string
  readonly nameJaBedrock: string | null
  readonly bedrockItemMultiplier: number | null
  readonly bedrockBookMultiplier: number | null
  readonly bedrockExclusiveWith: readonly string[] | null
  readonly exclusiveSetTag: string | null
}

interface RawItem {
  readonly id: string
  readonly nameJa: string
  readonly nameEn: string
  readonly enchantments: readonly string[]
  readonly bedrockEnchantments: readonly string[]
  readonly curseOnly: boolean
  readonly javaOnly: boolean
  readonly bedrockOnly: boolean
}

interface RawEnchantmentNames {
  readonly ja: string
  readonly en: string
  readonly jaBedrock: string | null
  readonly maxLevel: number
  readonly anvilCost: number
}

interface RawNames {
  readonly enchantments: ReadonlyMap<string, RawEnchantmentNames>
  readonly items: ReadonlyMap<string, LocalizedText>
}

type JsonObject = Readonly<Record<string, unknown>>

function fail(path: string, message: string): never {
  throw new Error(`gen-data: ${path}: ${message}`)
}

function asObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'object expected')
  return value as JsonObject
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, 'array expected')
  return value
}

function str(o: JsonObject, key: string, path: string): string {
  const v = o[key]
  if (typeof v !== 'string') fail(`${path}.${key}`, 'string expected')
  return v
}

function nullableStr(o: JsonObject, key: string, path: string): string | null {
  const v = o[key] ?? null
  if (v !== null && typeof v !== 'string') fail(`${path}.${key}`, 'string or null expected')
  return v
}

function int(o: JsonObject, key: string, path: string): number {
  const v = o[key]
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) fail(`${path}.${key}`, 'non-negative integer expected')
  return v
}

function nullableInt(o: JsonObject, key: string, path: string): number | null {
  return o[key] === null ? null : int(o, key, path)
}

function bool(o: JsonObject, key: string, path: string): boolean {
  const v = o[key]
  if (typeof v !== 'boolean') fail(`${path}.${key}`, 'boolean expected')
  return v
}

function strArray(o: JsonObject, key: string, path: string): readonly string[] {
  const arr = asArray(o[key], `${path}.${key}`)
  return arr.map((v, i) => (typeof v === 'string' ? v : fail(`${path}.${key}[${i}]`, 'string expected')))
}

function nullableStrArray(o: JsonObject, key: string, path: string): readonly string[] | null {
  return o[key] === null ? null : strArray(o, key, path)
}

function parseEnchantmentData(source: unknown): { enchantments: readonly RawEnchantment[]; items: readonly RawItem[] } {
  const root = asObject(source, SOURCE_DATA_PATHS.enchantmentData)
  const enchantments = asArray(root.enchantments, 'enchantments').map((value, i): RawEnchantment => {
    const path = `enchantments[${i}]`
    const o = asObject(value, path)
    return {
      id: str(o, 'id', path),
      maxLevel: int(o, 'maxLevel', path),
      itemMultiplier: int(o, 'itemMultiplier', path),
      bookMultiplier: int(o, 'bookMultiplier', path),
      exclusiveWith: strArray(o, 'exclusiveWith', path),
      isCurse: bool(o, 'isCurse', path),
      isTreasure: bool(o, 'isTreasure', path),
      javaOnly: bool(o, 'javaOnly', path),
      bedrockOnly: bool(o, 'bedrockOnly', path),
      nameJa: str(o, 'nameJa', path),
      nameEn: str(o, 'nameEn', path),
      nameJaBedrock: nullableStr(o, 'nameJaBedrock', path),
      bedrockItemMultiplier: nullableInt(o, 'bedrockItemMultiplier', path),
      bedrockBookMultiplier: nullableInt(o, 'bedrockBookMultiplier', path),
      bedrockExclusiveWith: nullableStrArray(o, 'bedrockExclusiveWith', path),
      exclusiveSetTag: nullableStr(o, 'exclusiveSetTag', path),
    }
  })
  const items = asArray(root.items, 'items').map((value, i): RawItem => {
    const path = `items[${i}]`
    const o = asObject(value, path)
    return {
      id: str(o, 'id', path),
      nameJa: str(o, 'nameJa', path),
      nameEn: str(o, 'nameEn', path),
      enchantments: strArray(o, 'enchantments', path),
      bedrockEnchantments: strArray(o, 'bedrockEnchantments', path),
      curseOnly: bool(o, 'curseOnly', path),
      javaOnly: bool(o, 'javaOnly', path),
      bedrockOnly: bool(o, 'bedrockOnly', path),
    }
  })
  return { enchantments, items }
}

function parseJapaneseNames(source: unknown): RawNames {
  const root = asObject(source, SOURCE_DATA_PATHS.japaneseNames)
  const enchantments = new Map<string, RawEnchantmentNames>()
  for (const [id, value] of Object.entries(asObject(root.enchantments, 'enchantments'))) {
    const path = `enchantments.${id}`
    const o = asObject(value, path)
    enchantments.set(id, {
      ja: str(o, 'ja', path),
      en: str(o, 'en', path),
      jaBedrock: nullableStr(o, 'ja_bedrock', path),
      maxLevel: int(o, 'max_level', path),
      anvilCost: int(o, 'anvil_cost', path),
    })
  }
  const items = new Map<string, LocalizedText>()
  for (const [id, value] of Object.entries(asObject(root.items, 'items'))) {
    const path = `items.${id}`
    const o = asObject(value, path)
    items.set(id, { ja: str(o, 'ja', path), en: str(o, 'en', path) })
  }
  return { enchantments, items }
}

// Building

const BOTH_SOURCES = `${SOURCE_DATA_PATHS.enchantmentData} and ${SOURCE_DATA_PATHS.japaneseNames}`

/**
 * Throws when an invariant does not hold. IDs are only checked for count and uniqueness here; type-checking the
 * generated file is what confirms that they are valid EnchantmentId and ItemTypeId values.
 */
export function buildGameData(sources: SourceData): GameData {
  const source = parseEnchantmentData(sources.enchantmentData)
  const names = parseJapaneseNames(sources.japaneseNames)

  const enchantmentIds = source.enchantments.map((e) => e.id)
  assertUnique(enchantmentIds, 'enchantment ids')
  // Data order is the order of enchantment-data.json; exclusiveWith and applicable follow it.
  const dataOrder = new Map(enchantmentIds.map((id, i) => [id, i]))
  const inDataOrder = (ids: readonly string[], path: string): readonly EnchantmentId[] => {
    assertUnique(ids, path)
    for (const id of ids) if (!dataOrder.has(id)) fail(path, `unknown enchantment '${id}'`)
    return [...ids].sort((a, b) => dataOrder.get(a)! - dataOrder.get(b)!) as EnchantmentId[]
  }

  const enchantments = source.enchantments.map((raw) => buildEnchantment(raw, names, inDataOrder))
  const items = source.items.map((raw) => buildItem(raw, names, inDataOrder))
  const data: GameData = {
    version: {
      java: JAVA_VERSION,
      bedrock: BEDROCK_VERSION,
      generatedFrom: [SOURCE_DATA_PATHS.enchantmentData, SOURCE_DATA_PATHS.japaneseNames],
    },
    enchantments,
    items,
  }
  assertGameData(data)
  return data
}

type OrderIds = (ids: readonly string[], path: string) => readonly EnchantmentId[]

function buildEnchantment(raw: RawEnchantment, names: RawNames, inDataOrder: OrderIds): EnchantmentDef {
  const path = `enchantment '${raw.id}'`
  const nameEntry = names.enchantments.get(raw.id) ?? fail(path, `no entry in ${SOURCE_DATA_PATHS.japaneseNames}`)
  const name: LocalizedText = { ja: nameEntry.ja, en: nameEntry.en }
  // Both files were taken from the same official data, so a mismatch is an error in the source data.
  if (raw.nameJa !== name.ja || raw.nameEn !== name.en) fail(path, `names differ between ${BOTH_SOURCES}`)
  // Bedrock names come from japanese-names.json. enchantment-data.json lacks the Bedrock name of swift_sneak,
  // so the two are compared only when it has one.
  if (raw.nameJaBedrock !== null && raw.nameJaBedrock !== nameEntry.jaBedrock) fail(path, `Bedrock ja name differs between ${BOTH_SOURCES}`)
  if (nameEntry.maxLevel !== raw.maxLevel) fail(path, `max level differs between ${BOTH_SOURCES}`)
  if (!raw.bedrockOnly && nameEntry.anvilCost !== raw.itemMultiplier) fail(path, `anvil_cost differs between ${BOTH_SOURCES}`)

  const java: EnchantmentEditionData | null = raw.bedrockOnly ? null : {
    itemMultiplier: raw.itemMultiplier,
    bookMultiplier: raw.bookMultiplier,
    exclusiveWith: inDataOrder(raw.exclusiveWith, `${path} java exclusiveWith`),
    exclusiveSetTag: exclusiveSetTagName(raw.exclusiveSetTag, path),
    multiplierSource: 'official-data',
    nameOverride: null,
  }

  let bedrock: EnchantmentEditionData | null = null
  if (!raw.javaOnly) {
    const bookMultiplier = raw.bedrockBookMultiplier ?? fail(path, 'bedrockBookMultiplier is null')
    const assumed = raw.bedrockItemMultiplier === null
    const itemMultiplier = raw.bedrockItemMultiplier
      ?? BEDROCK_ASSUMED_ITEM_MULTIPLIERS[raw.id]
      ?? fail(path, 'bedrockItemMultiplier is null and no assumed value is defined')
    const exclusiveWith = inDataOrder(
      raw.bedrockExclusiveWith ?? fail(path, 'bedrockExclusiveWith is null'),
      `${path} bedrock exclusiveWith`,
    )
    const source: DataSource = assumed ? 'assumption' : 'wiki'
    bedrock = {
      itemMultiplier,
      bookMultiplier,
      exclusiveWith,
      // An enchantment exclusive with nothing (Bedrock Impaling) is in no set.
      exclusiveSetTag: exclusiveWith.length === 0 ? null : exclusiveSetTagName(raw.exclusiveSetTag, path),
      multiplierSource: source,
      // Only some Japanese names differ in Bedrock; English names are shared.
      nameOverride: nameEntry.jaBedrock === null ? null : { ja: nameEntry.jaBedrock, en: name.en },
    }
  }

  return {
    id: raw.id as EnchantmentId,
    name,
    maxLevel: raw.maxLevel,
    curse: raw.isCurse,
    treasure: raw.isTreasure,
    java,
    bedrock,
  }
}

function exclusiveSetTagName(tag: string | null, path: string): string | null {
  if (tag === null) return null
  if (!tag.startsWith(EXCLUSIVE_SET_TAG_PREFIX)) fail(path, `unexpected exclusiveSetTag '${tag}'`)
  const name = tag.slice(EXCLUSIVE_SET_TAG_PREFIX.length)
  if (!EXCLUSIVE_SET_TAGS.has(name)) fail(path, `unknown exclusive set '${name}'`)
  return name
}

function buildItem(raw: RawItem, names: RawNames, inDataOrder: OrderIds): ItemDef {
  const path = `item '${raw.id}'`
  const name = ITEM_NAMES_NOT_IN_SOURCE[raw.id]
    ?? names.items.get(ITEM_NAME_KEYS[raw.id] ?? raw.id)
    ?? fail(path, `no entry in ${SOURCE_DATA_PATHS.japaneseNames}`)
  if (!ITEM_NAMES_NOT_FROM_ENCHANTMENT_DATA.has(raw.id) && (raw.nameJa !== name.ja || raw.nameEn !== name.en)) {
    fail(path, `names differ between ${BOTH_SOURCES}`)
  }

  const groupEntry = Object.entries(PICKER_GROUPS).find(([, ids]) => ids.includes(raw.id as ItemTypeId))
  if (groupEntry === undefined) fail(path, 'not in any picker group')
  const [group, members] = groupEntry

  const java: ItemEditionData | null = raw.bedrockOnly
    ? null
    : { applicable: inDataOrder(raw.enchantments, `${path} java applicable`) }
  const bedrock: ItemEditionData | null = raw.javaOnly
    ? null
    : { applicable: inDataOrder(raw.bedrockEnchantments, `${path} bedrock applicable`) }

  return {
    id: raw.id as ItemTypeId,
    name,
    group: group as ItemGroupId,
    order: members.indexOf(raw.id as ItemTypeId) + 1,
    isBook: raw.id === 'enchanted_book',
    damageable: !NOT_DAMAGEABLE.has(raw.id),
    stackable: STACKABLE.has(raw.id),
    curseOnly: raw.curseOnly,
    java,
    bedrock,
    icon: raw.id,
  }
}

// Invariants

function assertUnique(values: readonly string[], path: string): void {
  const seen = new Set<string>()
  for (const v of values) {
    if (seen.has(v)) fail(path, `duplicate '${v}'`)
    seen.add(v)
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) fail('invariant', message)
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function assertGameData(data: GameData): void {
  const { enchantments, items } = data
  assert(enchantments.length === ENCHANTMENT_COUNT, `expected ${ENCHANTMENT_COUNT} enchantments, got ${enchantments.length}`)
  assert(items.length === ITEM_COUNT, `expected ${ITEM_COUNT} items, got ${items.length}`)
  assertUnique(items.map((i) => i.id), 'item ids')
  const groupedItems = Object.values(PICKER_GROUPS).flat()
  assert(groupedItems.length === ITEM_COUNT, 'every item belongs to exactly one picker group')

  const ench = new Map(enchantments.map((e) => [e.id, e]))
  const item = new Map(items.map((i) => [i.id, i]))
  const get = <K, V>(m: ReadonlyMap<K, V>, k: K): V => m.get(k) ?? fail('invariant', `missing '${String(k)}'`)

  for (const edition of ['java', 'bedrock'] as const) {
    for (const e of enchantments) {
      const d = e[edition]
      if (d === null) continue
      assert(!d.exclusiveWith.includes(e.id), `${edition} ${e.id} is exclusive with itself`)
      for (const other of d.exclusiveWith) {
        const od = get(ench, other)[edition]
        assert(od !== null, `${edition} ${e.id} is exclusive with ${other}, which is not in the edition`)
        assert(od.exclusiveWith.includes(e.id), `${edition} exclusivity ${e.id} ↔ ${other} is not symmetric`)
      }
      assert(d.itemMultiplier >= 1 && d.bookMultiplier >= 1, `${edition} ${e.id} multipliers must be ≥ 1`)
      assert(e.maxLevel >= 1, `${e.id} max level must be ≥ 1`)
    }
    for (const i of items) {
      const d = i[edition]
      if (d === null) continue
      for (const id of d.applicable) {
        const def = get(ench, id)
        assert(def[edition] !== null, `${edition} ${i.id} accepts ${id}, which is not in the edition`)
        if (i.curseOnly) assert(def.curse, `${edition} ${i.id} is curse-only but accepts ${id}`)
      }
    }
    // An enchanted book accepts every enchantment of the edition (the anvil does not check applicability for books).
    const book = get(item, 'enchanted_book')[edition]
    const inEdition = enchantments.filter((e) => e[edition] !== null).map((e) => e.id)
    assert(book !== null && sameIds(book.applicable, inEdition), `${edition} enchanted_book must accept every enchantment`)
  }

  for (const e of enchantments) {
    // The Java book multiplier is max(1, floor(anvil_cost / 2)) (AnvilMenu).
    if (e.java !== null) {
      assert(e.java.bookMultiplier === Math.max(1, Math.floor(e.java.itemMultiplier / 2)), `java ${e.id} book multiplier`)
    }
    if (e.bedrock !== null) {
      const expected: DataSource = e.id in BEDROCK_ASSUMED_ITEM_MULTIPLIERS ? 'assumption' : 'wiki'
      assert(e.bedrock.multiplierSource === expected, `bedrock ${e.id} multiplier source must be ${expected}`)
    }
  }

  // Java Loyalty is item 2 / book 1: the 26.3 data has anvil_cost 2, while the wikis list 1 / 1.
  const loyalty = get(ench, 'loyalty')
  assert(loyalty.java?.itemMultiplier === 2 && loyalty.java.bookMultiplier === 1, 'java loyalty multipliers must be 2/1')
  // Density is item 2 / book 1 in both editions (the Japanese wiki lists 1 / 1).
  const density = get(ench, 'density')
  assert(density.java?.itemMultiplier === 2 && density.java.bookMultiplier === 1, 'java density multipliers must be 2/1')
  assert(density.bedrock?.itemMultiplier === 2 && density.bedrock.bookMultiplier === 1, 'bedrock density multipliers must be 2/1')
  // The wiki gives no Bedrock item multiplier for Loyalty, so 2 is assumed. Only a trident with Loyalty as the sacrifice uses it.
  assert(
    loyalty.bedrock?.itemMultiplier === 2 && loyalty.bedrock.multiplierSource === 'assumption',
    'bedrock loyalty item multiplier must be the assumed 2',
  )
  const impaling = get(ench, 'impaling')
  assert(impaling.bedrock?.itemMultiplier === 2 && impaling.bedrock.bookMultiplier === 1, 'bedrock impaling multipliers must be 2/1')
  assert(
    impaling.bedrock.exclusiveWith.length === 0 && impaling.bedrock.exclusiveSetTag === null,
    'bedrock impaling must not be exclusive with anything',
  )
  for (const id of ['sharpness', 'smite', 'bane_of_arthropods', 'density', 'breach'] as const) {
    assert(!get(ench, id).bedrock?.exclusiveWith.includes('impaling'), `bedrock ${id} must not exclude impaling`)
  }
  assert(get(ench, 'sweeping_edge').bedrock === null, 'sweeping_edge must be Java only')
  const recovery = get(item, 'recovery_compass')
  assert(
    recovery.java === null && sameIds(recovery.bedrock?.applicable ?? [], ['vanishing_curse']),
    'recovery_compass must be Bedrock only and accept only vanishing_curse',
  )
  const compass = get(item, 'compass')
  assert(
    compass.java?.applicable.includes('vanishing_curse') === true && compass.bedrock?.applicable.includes('vanishing_curse') === true,
    'compass must accept vanishing_curse in both editions',
  )
  assert(get(item, 'shears').bedrock?.applicable.includes('silk_touch') === true, 'bedrock shears must accept silk_touch')
  const bedrockJa = enchantments.flatMap((e) => (e.bedrock?.nameOverride ? [`${e.id}=${e.bedrock.nameOverride.ja}`] : []))
  const expectedBedrockJa = ['breach=違反', 'density=密度', 'swift_sneak=しのび足速度上昇', 'wind_burst=爆風']
  assert(sameIds([...bedrockJa].sort(), expectedBedrockJa), `unexpected Bedrock ja names: ${bedrockJa.join(', ')}`)
  for (const e of enchantments) {
    if (e.bedrock?.nameOverride) assert(e.bedrock.nameOverride.en === e.name.en, `${e.id} English name must be the same in both editions`)
  }
  // Official item names.
  assert(get(item, 'head').name.ja === 'Mobの頭' && get(item, 'head').name.en === 'Mob Head', 'head name')
  assert(recovery.name.ja === 'リカバリーコンパス' && recovery.name.en === 'Recovery Compass', 'recovery_compass name')
  assert(get(item, 'trident').name.ja === 'トライデント', 'trident name')
  assert(get(item, 'fishing_rod').name.ja === '釣竿', 'fishing_rod name')
  for (const i of items) {
    assert(i.damageable === !NOT_DAMAGEABLE.has(i.id), `${i.id} damageable`)
    assert(i.stackable === STACKABLE.has(i.id), `${i.id} stackable`)
    assert(i.isBook === (i.id === 'enchanted_book'), `${i.id} isBook`)
  }
}

// Rendering gameData.generated.ts

const MAX_LINE = 110
const INDENT = '  '

/** Deterministic, so that `gen-data --check` can compare the output byte for byte. */
export function renderGameDataModule(data: GameData): string {
  return [
    '// Generated by scripts/gen-data.mjs. Do not edit by hand.',
    '// Regenerate with `npm run gen:data`; check with `node scripts/gen-data.mjs --check`.',
    `// Sources: ${data.version.generatedFrom.join(', ')}, with the corrections in src/data/buildGameData.ts applied.`,
    "import type { GameData } from './types.ts'",
    '',
    `export const GAME_DATA: GameData = ${literal(data, 0, 'export const GAME_DATA: GameData = '.length)}`,
    '',
  ].join('\n')
}

export function generateGameDataModule(sources: SourceData): string {
  return renderGameDataModule(buildGameData(sources))
}

// column is the width of the text before the value on its line.
function literal(value: unknown, depth: number, column: number): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return quote(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const parts = value.map((v) => literal(v, depth + 1, 0))
    const inline = `[${parts.join(', ')}]`
    if (fitsInline(inline, column)) return inline
    const pad = INDENT.repeat(depth + 1)
    const lines = value.map((v) => `${pad}${literal(v, depth + 1, pad.length)},`)
    return `[\n${lines.join('\n')}\n${INDENT.repeat(depth)}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const inline = `{ ${entries.map(([k, v]) => `${key(k)}: ${literal(v, depth + 1, 0)}`).join(', ')} }`
    if (fitsInline(inline, column)) return inline
    const pad = INDENT.repeat(depth + 1)
    const lines = entries.map(([k, v]) => {
      const head = `${pad}${key(k)}: `
      return `${head}${literal(v, depth + 1, head.length)},`
    })
    return `{\n${lines.join('\n')}\n${INDENT.repeat(depth)}}`
  }
  throw new Error(`gen-data: cannot render ${typeof value}`)
}

function fitsInline(text: string, column: number): boolean {
  return !text.includes('\n') && column + text.length + 1 <= MAX_LINE
}

function key(k: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k)
}

function quote(s: string): string {
  // JSON.stringify escapes backslashes, double quotes and control characters; then switch to single quotes.
  const body = JSON.stringify(s).slice(1, -1)
  return `'${body.replace(/\\"/g, '"').replace(/'/g, "\\'")}'`
}
