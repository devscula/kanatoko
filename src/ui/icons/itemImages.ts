import type { ItemTypeId } from '../../data/types.ts'
import { ITEM_IMAGE_TABLE } from './itemImageTable.ts'

export interface ItemImageAsset {
  readonly src: string
  /** Display at whole multiples of this, or at 16 or 48px for a 32px image, so that the pixels stay sharp. */
  readonly px: 16 | 32
  readonly foil: boolean
}

// The glint texture is loaded by ItemImage.module.css. import.meta.glob only accepts literal strings, hence the
// spelled-out file name; itemImages.test.ts checks it against the table.
const URLS = import.meta.glob<string>(['./items/*.png', '!./items/enchanted_glint_item.png'], { eager: true, import: 'default' })

function urlOf(file: string): string {
  const url = URLS[`./items/${file}`]
  if (url === undefined) throw new Error(`item image ${file} is missing: run node scripts/extract-icons.mjs <client.jar>`)
  return url
}

export const ITEM_IMAGES: Readonly<Record<ItemTypeId, ItemImageAsset>> = Object.fromEntries(
  Object.entries(ITEM_IMAGE_TABLE).map(([item, def]) => [item, { src: urlOf(def.file), px: def.px, foil: def.foil }]),
) as Record<ItemTypeId, ItemImageAsset>

export function itemImage(item: ItemTypeId): ItemImageAsset {
  return ITEM_IMAGES[item]
}
