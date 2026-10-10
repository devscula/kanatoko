// IDs are the Java IDs in both editions; the Bedrock IDs binding and vanishing are not used.

export type Edition = 'java' | 'bedrock'
export type Lang = 'ja' | 'en'

export type EnchantmentId =
  | 'aqua_affinity' | 'bane_of_arthropods' | 'binding_curse' | 'blast_protection' | 'breach'
  | 'channeling' | 'density' | 'depth_strider' | 'efficiency' | 'feather_falling'
  | 'fire_aspect' | 'fire_protection' | 'flame' | 'fortune' | 'frost_walker'
  | 'impaling' | 'infinity' | 'knockback' | 'looting' | 'loyalty'
  | 'luck_of_the_sea' | 'lunge' | 'lure' | 'mending' | 'multishot'
  | 'piercing' | 'power' | 'projectile_protection' | 'protection' | 'punch'
  | 'quick_charge' | 'respiration' | 'riptide' | 'sharpness' | 'silk_touch'
  | 'smite' | 'soul_speed' | 'sweeping_edge' | 'swift_sneak' | 'thorns'
  | 'unbreaking' | 'vanishing_curse' | 'wind_burst'

export type ItemTypeId =
  | 'helmet' | 'turtle_shell' | 'chestplate' | 'leggings' | 'boots' | 'elytra'
  | 'sword' | 'spear' | 'axe' | 'pickaxe' | 'shovel' | 'hoe' | 'shears'
  | 'bow' | 'crossbow' | 'trident' | 'mace' | 'fishing_rod' | 'shield'
  | 'flint_and_steel' | 'brush' | 'carrot_on_a_stick' | 'warped_fungus_on_a_stick'
  | 'compass' | 'carved_pumpkin' | 'head' | 'recovery_compass' | 'enchanted_book'

export type ItemGroupId = 'armor' | 'weapon' | 'tool' | 'other' | 'book'
/** Where a multiplier comes from; the UI shows it for Bedrock. */
export type DataSource = 'official-data' | 'wiki' | 'assumption'

export interface LocalizedText { readonly ja: string; readonly en: string }

export interface EnchantmentEditionData {
  /** Used when the sacrifice (right input) is an item. Java: anvil_cost. */
  readonly itemMultiplier: number
  /** Used when the sacrifice is an enchanted book. Java: max(1, floor(anvil_cost / 2)). */
  readonly bookMultiplier: number
  /** Symmetric closure of exclusive_set; never contains the enchantment itself. */
  readonly exclusiveWith: readonly EnchantmentId[]
  /** exclusive_set tag name without the namespace, used to group the UI; null when in no set. */
  readonly exclusiveSetTag: string | null
  readonly multiplierSource: DataSource
  /** Set only where this edition's name differs from EnchantmentDef.name. */
  readonly nameOverride: LocalizedText | null
}

export interface EnchantmentDef {
  readonly id: EnchantmentId
  /** Official Java names (ja_jp / en_us 26.3). */
  readonly name: LocalizedText
  readonly maxLevel: number            // identical in both editions
  readonly curse: boolean
  readonly treasure: boolean
  readonly java: EnchantmentEditionData | null      // null = does not exist in this edition
  readonly bedrock: EnchantmentEditionData | null
}

export interface ItemEditionData {
  /** Enchantments an anvil applies to this item (Java: supported_items; Bedrock: wiki). */
  readonly applicable: readonly EnchantmentId[]
}

export interface ItemDef {
  readonly id: ItemTypeId
  readonly name: LocalizedText
  readonly group: ItemGroupId
  readonly order: number               // 1-based position in the picker group
  readonly isBook: boolean
  readonly damageable: boolean         // only then can two of the same item be combined
  readonly stackable: boolean          // a stack in the anvil costs 40 in Java, so the UI asks for a single one
  readonly curseOnly: boolean
  readonly java: ItemEditionData | null            // null = not selectable in this edition
  readonly bedrock: ItemEditionData | null
  readonly icon: string                // key into src/ui/icons/itemImageTable.ts
}

export interface GameData {
  readonly version: { readonly java: '26.3'; readonly bedrock: '26.52'; readonly generatedFrom: readonly string[] }
  readonly enchantments: readonly EnchantmentDef[]
  readonly items: readonly ItemDef[]
}
