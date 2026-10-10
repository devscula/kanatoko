import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { areCompatible, getEnchantment, isEnchantmentInEdition, itemsInEdition, maxLevel } from '../../data/gameData.ts'
import { compareTooltipOrder } from '../../data/tooltipOrder.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../../data/types.ts'
import { DEFAULT_INPUT, type InputState } from '../state/types.ts'
import { canMaxAll, enchantmentLayout, groupOf, listCandidates, planMaxAll, type ListBlock } from './enchantmentGroups.ts'
import { MAX_ALL_DEFAULTS } from './maxAllDefaults.ts'

const blockIds = (blocks: readonly ListBlock[]) => blocks.map((b) => (b.kind === 'single' ? b.id : b.group.members))
type Entry = { readonly id: EnchantmentId; readonly level: number }
const input = (item: ItemTypeId | null, enchantments: readonly Entry[] = [], existing: readonly Entry[] = []): InputState => ({
  ...DEFAULT_INPUT,
  item,
  wanted: Object.fromEntries(enchantments.map((e) => [e.id, e.level])),
  existing: Object.fromEntries(existing.map((e) => [e.id, e.level])),
})
const entries = (state: InputState): Entry[] => (Object.entries(state.wanted) as [EnchantmentId, number][]).map(([id, level]) => ({ id, level }))
const ids = (state: InputState) => entries(state).map((e) => e.id).sort(compareTooltipOrder)

describe('enchantmentLayout', () => {
  it('places each conflict group as one block at its first member and keeps curses apart (boots)', () => {
    const layout = enchantmentLayout('java', 'boots')
    expect(blockIds(layout.blocks)).toEqual([
      ['frost_walker', 'depth_strider'],
      ['protection', 'blast_protection', 'fire_protection', 'projectile_protection'],
      'feather_falling',
      'soul_speed',
      'thorns',
      'unbreaking',
      'mending',
    ])
    expect(layout.curses).toEqual(['binding_curse', 'vanishing_curse'])
    expect(layout.curseOnly).toBe(false)
    const armor = groupOf(layout, 'fire_protection')
    expect(armor?.heading).toEqual({ kind: 'pickOne', count: 4 })
    expect(armor?.tag).toBe('armor')
    expect(groupOf(layout, 'mending')).toBeNull()
  })

  it('heads the riptide group with riptide as the center instead of "pick one" (trident)', () => {
    const group = groupOf(enchantmentLayout('java', 'trident'), 'riptide')
    expect(group?.members).toEqual(['riptide', 'channeling', 'loyalty'])
    expect(group?.heading).toEqual({ kind: 'star', center: 'riptide', others: ['channeling', 'loyalty'] })
    expect(group?.tag).toBe('riptide')
  })

  it('builds groups from the candidates only (a sword takes no impaling, density or breach, so its damage group has three members)', () => {
    expect(groupOf(enchantmentLayout('java', 'sword'), 'sharpness')?.members).toEqual(['sharpness', 'smite', 'bane_of_arthropods'])
    // Nothing that conflicts with impaling goes on a trident, so it forms no group
    expect(groupOf(enchantmentLayout('java', 'trident'), 'impaling')).toBeNull()
  })

  it('keeps impaling out of the damage group and has no sweeping edge in Bedrock Edition', () => {
    expect(groupOf(enchantmentLayout('bedrock', 'enchanted_book'), 'impaling')).toBeNull()
    expect(listCandidates('bedrock', 'sword')).not.toContain('sweeping_edge')
    expect(listCandidates('java', 'sword')).toContain('sweeping_edge')
  })

  it('offers every enchantment in the edition for a book (item null or enchanted_book)', () => {
    expect(listCandidates('java', null)).toHaveLength(43)
    expect(listCandidates('java', 'enchanted_book')).toEqual(listCandidates('java', null))
    expect(listCandidates('bedrock', 'enchanted_book')).toHaveLength(42)
  })

  it('marks an item that accepts only curses (compass) as curseOnly', () => {
    const layout = enchantmentLayout('java', 'compass')
    expect(layout.blocks).toEqual([])
    expect(layout.curses).toEqual(['vanishing_curse'])
    expect(layout.curseOnly).toBe(true)
  })

  it('follows tooltip order and returns the same layout for the same edition and item', () => {
    const layout = enchantmentLayout('java', 'enchanted_book')
    expect(layout.candidates).toEqual([...layout.candidates].sort(compareTooltipOrder))
    expect(enchantmentLayout('java', 'enchanted_book')).toBe(layout)
  })
})

describe('planMaxAll', () => {
  it('selects seven enchantments at max for boots, picking protection and depth strider from the groups', () => {
    const plan = planMaxAll(input('boots'), 'java')
    expect(plan.changed).toBe(true)
    expect(ids(plan.next)).toEqual(['protection', 'feather_falling', 'soul_speed', 'depth_strider', 'thorns', 'unbreaking', 'mending'])
    expect(entries(plan.next).every((e) => e.level === maxLevel(e.id))).toBe(true)
    expect(plan.picked).toEqual(['protection', 'depth_strider'])
  })

  it('keeps a group member that is already selected and raises it to max', () => {
    const plan = planMaxAll(input('boots', [{ id: 'fire_protection', level: 2 }]), 'java')
    expect(entries(plan.next)).toContainEqual({ id: 'fire_protection', level: 4 })
    expect(ids(plan.next)).not.toContain('protection')
    expect(plan.picked).toEqual(['depth_strider'])
  })

  it('leaves curses as they are', () => {
    const plan = planMaxAll(input('boots', [{ id: 'binding_curse', level: 1 }]), 'java')
    expect(entries(plan.next)).toContainEqual({ id: 'binding_curse', level: 1 })
    expect(ids(plan.next)).not.toContain('vanishing_curse')
  })

  it('counts an existing enchantment as the group choice, raises it to max when lower and skips rows that conflict with it', () => {
    const plan = planMaxAll(input('boots', [], [{ id: 'frost_walker', level: 2 }, { id: 'unbreaking', level: 2 }]), 'java')
    expect(ids(plan.next)).not.toContain('depth_strider')
    expect(ids(plan.next)).not.toContain('frost_walker')
    expect(entries(plan.next)).toContainEqual({ id: 'unbreaking', level: 3 })
    expect(plan.picked).not.toContain('depth_strider')
  })

  it('picks the default member of each group (density, sharpness, loyalty and channeling, mending, piercing, fortune)', () => {
    expect(planMaxAll(input('mace'), 'java').picked).toEqual(['density'])
    expect(planMaxAll(input('sword'), 'java').picked).toEqual(['sharpness'])
    expect(planMaxAll(input('trident'), 'java').picked).toEqual(['channeling', 'loyalty'])
    expect(planMaxAll(input('bow'), 'java').picked).toEqual(['mending'])
    expect(planMaxAll(input('crossbow'), 'java').picked).toEqual(['piercing'])
    expect(planMaxAll(input('pickaxe'), 'java').picked).toEqual(['fortune'])
  })

  it('skips loyalty and channeling when riptide is selected, and adds channeling when only loyalty is', () => {
    expect(ids(planMaxAll(input('trident', [{ id: 'riptide', level: 1 }]), 'java').next)).toEqual(['riptide', 'impaling', 'unbreaking', 'mending'])
    expect(planMaxAll(input('trident', [{ id: 'loyalty', level: 3 }]), 'java').picked).toEqual(['channeling'])
  })

  it('reports no change once everything is at max, which disables the button', () => {
    const once = planMaxAll(input('boots'), 'java')
    const twice = planMaxAll(once.next, 'java')
    expect(twice).toEqual({ next: once.next, picked: [], changed: false })
  })

  it('hides the button for an enchanted book, a curse-only item and no item', () => {
    expect(canMaxAll('java', 'enchanted_book')).toBe(false)
    expect(canMaxAll('java', 'compass')).toBe(false)
    expect(canMaxAll('java', null)).toBe(false)
    expect(canMaxAll('java', 'boots')).toBe(true)
    expect(planMaxAll(input('enchanted_book'), 'java').changed).toBe(false)
  })

  it('never selects a conflicting pair, covers every non-curse candidate and changes nothing on a second run', () => {
    const cases = (['java', 'bedrock'] as const).flatMap((edition) =>
      itemsInEdition(edition).map((item) => [edition, item.id] as [Edition, ItemTypeId]),
    )
    fc.assert(
      fc.property(fc.constantFrom(...cases), fc.array(fc.nat(), { maxLength: 6 }), ([edition, item], picks) => {
        const candidates = listCandidates(edition, item)
        // Start from mutually compatible candidates, as the UI only allows that
        const start: EnchantmentId[] = []
        for (const n of picks) {
          if (candidates.length === 0) break
          const id = candidates[n % candidates.length]
          if (!start.includes(id) && start.every((s) => areCompatible(edition, id, s))) start.push(id)
        }
        const plan = planMaxAll(input(item, start.map((id) => ({ id, level: 1 }))), edition)
        const chosen = entries(plan.next).map((e) => e.id)
        for (const a of chosen) for (const b of chosen) expect(areCompatible(edition, a, b)).toBe(true)
        if (canMaxAll(edition, item)) {
          for (const id of candidates) {
            if (getEnchantment(id).curse) continue
            expect(chosen.includes(id) || chosen.some((c) => !areCompatible(edition, id, c)), `${item} ${id}`).toBe(true)
          }
        }
        expect(start.every((id) => chosen.includes(id))).toBe(true)
        expect(planMaxAll(plan.next, edition).changed).toBe(false)
      }),
    )
  })
})

describe('MAX_ALL_DEFAULTS', () => {
  it('maps exclusive_set names from either edition to members of that group', () => {
    const tags = new Set<string>()
    for (const edition of ['java', 'bedrock'] as const) {
      for (const id of listCandidates(edition, null)) {
        const tag = getEnchantment(id)[edition]?.exclusiveSetTag
        if (tag) tags.add(tag)
      }
    }
    for (const [tag, preferred] of Object.entries(MAX_ALL_DEFAULTS)) {
      expect(tags.has(tag), tag).toBe(true)
      const group = groupOf(enchantmentLayout('java', null), preferred[0])
      expect(group?.tag, tag).toBe(tag)
      for (const id of preferred) expect(group?.members, `${tag}: ${id}`).toContain(id)
      for (const id of preferred) expect(isEnchantmentInEdition('java', id)).toBe(true)
    }
  })
})
