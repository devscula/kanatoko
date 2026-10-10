// scripts/extract-book-icons.mjs imports this under Node, so it must not use Vite features such as import.meta.glob.
import { GAME_DATA } from '../../data/gameData.generated.ts'
import type { EnchantmentId } from '../../data/types.ts'

/** Credited in the footer, the About dialog and SOURCES.md. */
export const BOOK_IMAGE_PACK = {
  title: 'XK Redstone Display',
  author: 'Xe_Kr',
  page: 'https://modrinth.com/resourcepack/xk-redstone-display',
  license: 'CC BY-NC-ND 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
} as const

export function bookImageFile(id: EnchantmentId, level: number): string {
  return `${id}_${level}.png`
}

export const BOOK_IMAGE_LEVELS: readonly { readonly id: EnchantmentId; readonly level: number }[] = GAME_DATA.enchantments.flatMap((def) =>
  Array.from({ length: def.maxLevel }, (_, i) => ({ id: def.id, level: i + 1 })),
)
