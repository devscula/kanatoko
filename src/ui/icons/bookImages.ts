import type { EnchantmentId } from '../../data/types.ts'
import type { EnchantLevels } from '../../engine/index.ts'
import { bookImageFile } from './bookImageTable.ts'
import type { ItemImageAsset } from './itemImages.ts'

// import.meta.glob only accepts literal strings; bookImages.test.ts checks the folder against the table.
const URLS = import.meta.glob<string>('./books/*.png', { eager: true, import: 'default' })

/** null unless the book holds exactly one enchantment; the caller then uses the official book image. */
export function bookImage(contents: EnchantLevels): ItemImageAsset | null {
  const entries = (Object.entries(contents) as [EnchantmentId, number | undefined][]).filter(
    (entry): entry is [EnchantmentId, number] => entry[1] !== undefined && entry[1] > 0,
  )
  if (entries.length !== 1) return null
  const [id, level] = entries[0]
  const src = URLS[`./books/${bookImageFile(id, level)}`]
  if (src === undefined) throw new Error(`book image ${bookImageFile(id, level)} is missing: run node scripts/extract-book-icons.mjs <pack.zip>`)
  return { src, px: 16, foil: true }
}
