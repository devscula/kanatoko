// scripts/extract-icons.mjs imports this under Node, so it must not use Vite features such as import.meta.glob and may
// import only types.
import type { ItemTypeId } from '../../data/types.ts'

// The material does not affect the cost, so armor and tools all show this one. Rerun scripts/extract-icons.mjs after
// changing it.
export const ITEM_MATERIAL = 'diamond'

export type ItemImageSource =
  /** assets/minecraft/textures/<path>.png in client.jar */
  | { readonly kind: 'texture'; readonly path: string }
  /** minecraft.wiki inventory render <name>.png, for items drawn as 3D models; the script holds the URLs */
  | { readonly kind: 'render'; readonly name: string }

export interface ItemImageDef {
  /** File name in src/ui/icons/items/ */
  readonly file: string
  readonly px: 16 | 32
  readonly source: ItemImageSource
  /** Always glints in the game, as the enchanted book does */
  readonly foil: boolean
}

const texture = (name: string): ItemImageDef => ({ file: `${name}.png`, px: 16, source: { kind: 'texture', path: `item/${name}` }, foil: false })
const material = (piece: string): ItemImageDef => texture(`${ITEM_MATERIAL}_${piece}`)
const render = (name: string, file: string): ItemImageDef => ({ file: `${file}.png`, px: 32, source: { kind: 'render', name }, foil: false })

// A Record, so that a new item type is a type error until it gets an image. Both editions use the Java textures.
export const ITEM_IMAGE_TABLE: Readonly<Record<ItemTypeId, ItemImageDef>> = {
  helmet: material('helmet'),
  turtle_shell: texture('turtle_helmet'),
  chestplate: material('chestplate'),
  leggings: material('leggings'),
  boots: material('boots'),
  elytra: texture('elytra'),
  sword: material('sword'),
  // The inventory icon, not the 32px held model diamond_spear_in_hand
  spear: material('spear'),
  axe: material('axe'),
  pickaxe: material('pickaxe'),
  shovel: material('shovel'),
  hoe: material('hoe'),
  shears: texture('shears'),
  bow: texture('bow'),
  // Unloaded
  crossbow: texture('crossbow_standby'),
  trident: texture('trident'),
  mace: texture('mace'),
  fishing_rod: texture('fishing_rod'),
  shield: render('Invicon_Shield', 'shield'),
  flint_and_steel: texture('flint_and_steel'),
  brush: texture('brush'),
  carrot_on_a_stick: texture('carrot_on_a_stick'),
  warped_fungus_on_a_stick: texture('warped_fungus_on_a_stick'),
  // Needle pointing up (the first frame in item/compass.json)
  compass: texture('compass_16'),
  carved_pumpkin: render('Invicon_Carved_Pumpkin', 'carved_pumpkin'),
  // The creeper head stands in for all mob heads
  head: render('Invicon_Creeper_Head', 'creeper_head'),
  recovery_compass: texture('recovery_compass_16'),
  enchanted_book: { ...texture('enchanted_book'), foil: true },
}

export const GLINT_TEXTURE = { file: 'enchanted_glint_item.png', path: 'misc/enchanted_glint_item', px: 128 } as const
