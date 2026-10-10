import { getEnchantment, getItem } from '../../../data/gameData.ts'
import type { EnchantmentId, ItemTypeId, Lang } from '../../../data/types.ts'
import { BOOK_TILE_ADVANCED_BREAKS_JA, ITEM_NAME_BREAKS_JA } from '../../data/nameBreaks.ts'

/** Unlike some enchantment names, item names do not differ between editions. */
export function itemSearchNames(id: ItemTypeId): readonly string[] {
  const { name } = getItem(id)
  return [name.ja, name.en]
}

/** Includes each edition's override, so a name used in only one edition (such as density's in Japanese) still matches. */
export function enchantmentSearchNames(id: EnchantmentId): readonly string[] {
  const def = getEnchantment(id)
  const names = [def.name.ja, def.name.en]
  for (const edition of [def.java, def.bedrock]) {
    const override = edition?.nameOverride
    if (override) names.push(override.ja, override.en)
  }
  return [...new Set(names)]
}

/** Pieces to join with <wbr>. English is left whole and wraps at spaces. */
export function itemNameParts(id: ItemTypeId, lang: Lang): readonly string[] {
  if (lang === 'ja') return ITEM_NAME_BREAKS_JA[id] ?? [getItem(id).name.ja]
  return [getItem(id).name.en]
}

/** text is item.bookTile in the current language. In Japanese the break table stands in for it, so keep the two in sync. */
export function bookTileAdvancedParts(text: string, lang: Lang): readonly string[] {
  return lang === 'ja' ? BOOK_TILE_ADVANCED_BREAKS_JA : [text]
}
