import type { EnchantmentId } from './types.ts'

// The order the game lists enchantments in tooltips, from the 26.3 tag #minecraft:tooltip_order:
// https://github.com/misode/mcmeta/blob/26.3-data/data/minecraft/tags/enchantment/tooltip_order.json
export const ENCHANTMENT_TOOLTIP_ORDER: readonly EnchantmentId[] = [
  'binding_curse', 'vanishing_curse', 'riptide', 'channeling', 'wind_burst', 'frost_walker', 'lunge',
  'sharpness', 'smite', 'bane_of_arthropods', 'impaling', 'power', 'density', 'breach', 'piercing',
  'sweeping_edge', 'multishot', 'fire_aspect', 'flame', 'knockback', 'punch', 'protection',
  'blast_protection', 'fire_protection', 'projectile_protection', 'feather_falling', 'fortune', 'looting',
  'silk_touch', 'luck_of_the_sea', 'efficiency', 'quick_charge', 'lure', 'respiration', 'aqua_affinity',
  'soul_speed', 'swift_sneak', 'depth_strider', 'thorns', 'loyalty', 'unbreaking', 'infinity', 'mending',
]

const position: ReadonlyMap<EnchantmentId, number> = new Map(ENCHANTMENT_TOOLTIP_ORDER.map((id, i) => [id, i]))

export function tooltipPosition(id: EnchantmentId): number {
  const p = position.get(id)
  if (p === undefined) throw new Error(`enchantment ${id} is missing from ENCHANTMENT_TOOLTIP_ORDER`)
  return p
}

export function compareTooltipOrder(a: EnchantmentId, b: EnchantmentId): number {
  return tooltipPosition(a) - tooltipPosition(b)
}
