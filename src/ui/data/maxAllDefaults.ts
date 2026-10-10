// Keys are exclusive_set tag names, and values are in order of preference: each entry that goes on the item and fits with
// what is already picked is taken. Unlisted groups fall back to tooltip order.

import type { EnchantmentId } from '../../data/types.ts'

export const MAX_ALL_DEFAULTS: Readonly<Record<string, readonly EnchantmentId[]>> = {
  armor: ['protection'],
  boots: ['depth_strider'],
  damage: ['sharpness', 'density'], // density for the mace, which cannot take sharpness
  mining: ['fortune'],
  bow: ['mending'],
  crossbow: ['piercing'],
  riptide: ['loyalty', 'channeling'], // both conflict only with riptide, so both are taken
}
