// These solve with the engine, so the expected costs come from it rather than from hand calculation.
import { describe, expect, it } from 'vitest'
import { solveSync } from '../../engine/index.ts'
import { createTranslator, NAME_LEVEL_SPACE } from '../i18n/render.ts'
import type { TextArg } from '../i18n/text.ts'
import { buildProblem, type BuiltProblem } from '../state/buildProblem.ts'
import { DEFAULT_INPUT, DEFAULT_SESSION, type InputState } from '../state/types.ts'
import { displayPlanFromResult, unusedReasonText, type DisplayPlan } from './displayPlan.ts'

const ja = createTranslator({ lang: 'ja', edition: 'java' })
const t = (arg: TextArg) => ja.text(arg).replaceAll(NAME_LEVEL_SPACE, ' ')

let uid = 0
const book = (enchantments: InputState['ownedBooks'][number]['enchantments'], count = 1) => ({
  uid: `b${uid++}`,
  enchantments,
  count,
  anvilUsesOverride: null,
})

function solve(input: InputState): { plan: DisplayPlan; built: BuiltProblem } {
  const built = buildProblem(input, DEFAULT_SESSION)
  if (built === null) throw new Error('input builds no problem')
  const result = solveSync(built.problem, built.settings)
  if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
  return { plan: displayPlanFromResult(result, built.problem, built.settings, { built, input }), built }
}

describe('input sources from BuiltProblem', () => {
  it('gets only Mending and leaves Silk Touch and Unbreaking II unused for an enchanted pickaxe', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'pickaxe',
      existing: { efficiency: 4, unbreaking: 3 },
      wanted: { efficiency: 5, mending: 1, fortune: 3 },
      ownedBooks: [book({ efficiency: 4 }), book({ fortune: 3 }), book({ silk_touch: 1 }), book({ unbreaking: 2 })],
    }
    const { plan, built } = solve(input)
    expect(plan.summary).toMatchObject({ totalLevels: 26, maxStepLevels: 12 })
    expect(plan.steps).toHaveLength(3)
    expect(plan.planId).toBe(built.planId)
    expect(plan.getBooks.map((b) => `${b.id} ${b.level}`)).toEqual(['mending 1'])
    // What you have: the item uses label.itemWith, owned books the book label.
    const owned = plan.ownedUsed.map((o) => t(o.label))
    expect(owned[0]).toBe('ツルハシ（効率強化 IV、耐久力 III）')
    expect(owned).toContain('本（効率強化 IV）')
    expect(owned).toContain('本（幸運 III）')
    expect(plan.ownedUsed.every((o) => o.source.kind === 'target' || o.source.kind === 'owned')).toBe(true)
    // Unused: Silk Touch conflicts with the wanted Fortune, and the item already has Unbreaking III.
    expect(plan.ownedUnused.map((u) => `${t(u.label)}: ${t(unusedReasonText(u.reason, plan.targetItem))}`)).toEqual([
      '本（シルクタッチ）: シルクタッチは、付けたい幸運と同時に付けられない',
      '本（耐久力 II）: ツルハシにもう耐久力 III がある',
    ])
    const suppliedSlot = plan.steps.flatMap((s) => [s.left, s.right]).find((slot) => slot?.source?.kind === 'supplement')
    expect(suppliedSlot?.source).toEqual({ kind: 'supplement', enchantment: 'mending', level: 1 })
  })

  it('removes a cursed owned book before solving and lists it as unused because of the curse', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'pickaxe',
      wanted: { efficiency: 5, mending: 1 },
      ownedBooks: [book({ efficiency: 5 }), book({ mending: 1, vanishing_curse: 1 })],
    }
    const { plan, built } = solve(input)
    expect(built.excluded.map((e) => e.reason)).toEqual(['curse'])
    expect(plan.summary).toMatchObject({ totalLevels: 8, maxStepLevels: 5 })
    expect(plan.getBooks.map((b) => b.id)).toEqual(['mending'])
    expect(plan.ownedUnused).toHaveLength(1)
    expect(plan.ownedUnused[0]).toMatchObject({ count: 1, reason: { code: 'curse', curse: 'vanishing_curse' } })
    expect(t(unusedReasonText(plan.ownedUnused[0].reason, plan.targetItem))).toBe('使うと消滅の呪いが付く')
  })

  it('removes owned books that fall short of the wanted level and plans new books instead (Java Edition)', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'mace',
      wanted: { density: 5, unbreaking: 3, mending: 1, wind_burst: 3 },
      ownedBooks: [book({ wind_burst: 1 }, 3)],
    }
    const { plan, built } = solve(input)
    expect(plan.summary).toMatchObject({ totalLevels: 23, maxStepLevels: 8 })
    expect(plan.steps).toHaveLength(4)
    expect(built.excluded.every((e) => e.reason === 'below-wanted')).toBe(true)
    expect(plan.ownedUnused).toHaveLength(1)
    expect(plan.ownedUnused[0]).toMatchObject({ count: 3, reason: { code: 'below-wanted', names: ['wind_burst'] } })
    expect(t(unusedReasonText(plan.ownedUnused[0].reason, plan.targetItem))).toBe('ウィンドバーストは手持ちでは足りないので、本を用意する')
    expect(plan.getBooks.map((b) => b.id).sort()).toEqual(['density', 'mending', 'unbreaking', 'wind_burst'])
  })

  it('keeps the steps and plan ID when a book to get is marked as owned', () => {
    const base: InputState = { ...DEFAULT_INPUT, item: 'boots', wanted: { protection: 4, feather_falling: 4, unbreaking: 3, mending: 1 } }
    const before = solve(base)
    const after = solve({ ...base, ownedBooks: [book({ mending: 1 })] })
    expect(after.plan.planId).toBe(before.plan.planId)
    expect(after.plan.steps.map((s) => s.cost.total)).toEqual(before.plan.steps.map((s) => s.cost.total))
    expect(after.plan.getBooks.map((b) => b.id)).not.toContain('mending')
    expect(after.plan.ownedUsed.map((o) => t(o.label))).toContain('本（修繕）')
  })
})
