import { getEnchantment, getItem } from './gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId, Lang } from './types.ts'

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'] as const

/** The game only has enchantment.level.1 to .10; other values come back as Arabic digits. */
export function romanNumeral(n: number): string {
  return Number.isInteger(n) && n >= 1 && n <= ROMAN_NUMERALS.length ? ROMAN_NUMERALS[n - 1] : String(n)
}

export function enchantmentName(id: EnchantmentId, edition: Edition, lang: Lang): string {
  const def = getEnchantment(id)
  // An enchantment missing from the edition (Sweeping Edge in Bedrock) still needs a name for the message saying so.
  return def[edition]?.nameOverride?.[lang] ?? def.name[lang]
}

/**
 * edition is unused: only material-specific names such as chainmail armor differ between editions, and items here
 * carry no material.
 */
export function itemName(id: ItemTypeId, _edition: Edition, lang: Lang): string {
  return getItem(id).name[lang]
}

/** As in the game's Enchantment.getFullname, the level is left out only when both the level and the max level are 1. */
export function formatEnchantment(id: EnchantmentId, level: number, edition: Edition, lang: Lang): string {
  const name = enchantmentName(id, edition, lang)
  return level === 1 && getEnchantment(id).maxLevel === 1 ? name : `${name} ${romanNumeral(level)}`
}
