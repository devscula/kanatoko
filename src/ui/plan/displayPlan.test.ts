import { describe, expect, it } from 'vitest'
import type { Problem, Settings, SolveOk } from '../../engine/index.ts'
import {
  ADVANCED_PROBLEM,
  BOOK_ONLY_PROBLEM,
  BOOTS_PROBLEM,
  DEFAULT_SETTINGS,
  type FixtureName,
  fixtureOk,
  getFixture,
  getFixtures,
  leaf,
  node,
} from '../dev/fixtures.ts'
import { createTranslator, NAME_LEVEL_SPACE } from '../i18n/render.ts'
import type { TextArg } from '../i18n/text.ts'
import {
  type DisplayPlan,
  displayPlanFromReference,
  displayPlanFromResult,
  isBookOnlyProblem,
  letterFor,
  problemInputLabel,
  renameStepOf,
  targetItemOf,
  unusedReasonText,
} from './displayPlan.ts'
import { assumptionParts } from './labels.ts'

const ja = createTranslator({ lang: 'ja', edition: 'java' })
// NAME_LEVEL_SPACE becomes a plain space here; i18n.test.ts covers the space itself.
const t = (arg: TextArg | null) => (arg === null ? null : ja.text(arg).replaceAll(NAME_LEVEL_SPACE, ' '))

function planOf(name: FixtureName): { plan: DisplayPlan; result: SolveOk; problem: Problem; settings: Settings } {
  const fixture = getFixture(name)
  if (fixture.result.status !== 'ok') throw new Error(`${name} is not an ok fixture`)
  return {
    plan: displayPlanFromResult(fixture.result, fixture.problem, fixture.settings),
    result: fixture.result,
    problem: fixture.problem,
    settings: fixture.settings,
  }
}

function rows(plan: DisplayPlan) {
  return plan.steps.map((s) => ({
    no: s.no,
    section: s.section,
    title: t(s.title),
    left: t(s.left.fullLabel),
    right: s.right && t(s.right.fullLabel),
    result: t(s.result.label),
    cost: s.cost.total,
  }))
}

describe('boots with seven max-level books', () => {
  const { plan } = planOf('bootsSevenBooks')

  it('places each book merge right before the step that uses it', () => {
    expect(plan.steps.map((s) => s.cost.total)).toEqual([12, 2, 16, 4, 14, 3, 15])
    expect(plan.steps.map((s) => s.section)).toEqual(['target', 'materials', 'target', 'materials', 'target', 'materials', 'target'])
    expect(plan.steps.map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(plan.steps.map((s) => s.engineIndex)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('labels each slot', () => {
    expect(rows(plan)).toEqual([
      { no: 1, section: 'target', title: 'ブーツに本（棘の鎧 III）を付ける', left: 'ブーツ（新品）', right: '本（棘の鎧 III）', result: 'ブーツ', cost: 12 },
      { no: 2, section: 'materials', title: '本Aを作る', left: '本（ソウルスピード III）', right: '本（修繕）', result: '本A', cost: 2 },
      { no: 3, section: 'target', title: 'ブーツに本Aを付ける', left: 'ブーツ（手順1の結果）', right: '本A（ソウルスピード III、修繕）', result: 'ブーツ', cost: 16 },
      { no: 4, section: 'materials', title: '本Bを作る', left: '本（水中歩行 III）', right: '本（ダメージ軽減 IV）', result: '本B', cost: 4 },
      { no: 5, section: 'target', title: 'ブーツに本Bを付ける', left: 'ブーツ（手順3の結果）', right: '本B（ダメージ軽減 IV、水中歩行 III）', result: 'ブーツ', cost: 14 },
      { no: 6, section: 'materials', title: '本Cを作る', left: '本（落下耐性 IV）', right: '本（耐久力 III）', result: '本C', cost: 3 },
      { no: 7, section: 'target', title: 'ブーツに本Cを付ける', left: 'ブーツ（手順5の結果）', right: '本C（落下耐性 IV、耐久力 III）', result: 'ブーツ（完成）', cost: 15 },
    ])
  })

  it('tags made books with letters and sets slot icons and glint', () => {
    const first = plan.steps[0]
    const makeA = plan.steps[1]
    const applyA = plan.steps[2]
    expect(applyA.right?.letter).toBe('A')
    expect(applyA.right?.item).toBe('enchanted_book')
    expect(applyA.left.item).toBe('boots')
    // Inputs carry their source; made objects have none.
    expect(applyA.right?.source).toBeNull()
    expect(applyA.left.source).toBeNull()
    expect(first.left.source).toEqual({ kind: 'target' })
    expect(first.right?.source).toEqual({ kind: 'supplement', enchantment: 'thorns', level: 3 })
    expect(applyA.right?.anvilUses).toBe(1)
    expect(applyA.left.enchanted).toBe(true)
    expect(first.left.enchanted).toBe(false)
    expect(makeA.result.letter).toBe('A')
    expect(t(makeA.result.detail)).toBe('ソウルスピード III、修繕')
  })

  it('lists books to get, what you have, the final result and the summary', () => {
    // In a simple problem every input other than the item is a book to get.
    // Both lists follow the order of the inputs in the plan, left to right.
    expect(plan.getBooks.map((b) => `${b.id} ${b.level}`)).toEqual([
      'thorns 3',
      'soul_speed 3',
      'mending 1',
      'depth_strider 3',
      'protection 4',
      'feather_falling 4',
      'unbreaking 3',
    ])
    expect(plan.ownedUsed.map((o) => ({ label: t(o.label), steps: o.steps, source: o.source }))).toEqual([
      { label: 'ブーツ（新品）', steps: [1, 3, 5, 7], source: { kind: 'target' } },
    ])
    expect(plan.ownedUnused).toEqual([])
    expect(plan.fallbackUsed).toEqual([])
    expect(t(plan.steps.at(-1)!.result.label)).toBe('ブーツ（完成）')
    expect(plan.summary).toMatchObject({ totalLevels: 66, maxStepLevels: 16, xpPoints: 1246, finalPriorWorkPenalty: 15, finalAnvilUses: 4 })
    expect(plan.baseline).toMatchObject({ totalLevels: 163, firstTooExpensiveStep: 7, comparable: false })
    expect(plan.targetItem).toBe('boots')
    expect(plan.planId).toMatch(/^[0-9a-f]{8}$/)
  })

  it('renders English titles and labels', () => {
    const en = createTranslator({ lang: 'en', edition: 'java' })
    expect(en.text(plan.steps[2].title)).toBe('Apply Book A to the Boots')
    expect(en.text(plan.steps[2].left.label)).toBe('Boots (after step 1)')
  })
})

describe('rename', () => {
  it('makes the first chain step a 1-level rename with no right slot', () => {
    const { plan } = planOf('bootsRename')
    expect(plan.steps).toHaveLength(8)
    const rename = plan.steps[0]
    expect(rename).toMatchObject({ no: 1, kind: 'rename', section: 'target', right: null, renameHere: true })
    expect(rename.cost.total).toBe(1)
    expect(t(rename.title)).toBe('ブーツに名前を付ける')
    expect(t(rename.left.label)).toBe('ブーツ（新品）')
    expect(t(rename.result.label)).toBe('ブーツ')
    expect(t(plan.steps[1].left.label)).toBe('ブーツ（手順1の結果）')
    expect(plan.summary.totalLevels).toBe(67)
  })
})

describe('merging books only', () => {
  const { plan } = planOf('bookOnly')

  it('names the base after its book and later states as the merged book', () => {
    expect(plan.targetItem).toBeNull()
    expect(rows(plan)).toEqual([
      { no: 1, section: 'target', title: '本（ソウルスピード III）を合わせる', left: '本（棘の鎧 III）', right: '本（ソウルスピード III）', result: 'まとめている本', cost: 12 },
      { no: 2, section: 'materials', title: '本Aを作る', left: '本（水中歩行 III）', right: '本（修繕）', result: '本A', cost: 2 },
      { no: 3, section: 'target', title: '本Aを合わせる', left: 'まとめている本（手順1の結果）', right: '本A（水中歩行 III、修繕）', result: 'まとめている本', cost: 10 },
      { no: 4, section: 'materials', title: '本Bを作る', left: '本（落下耐性 IV）', right: '本（耐久力 III）', result: '本B', cost: 3 },
      { no: 5, section: 'target', title: '本Bを合わせる', left: 'まとめている本（手順3の結果）', right: '本B（落下耐性 IV、耐久力 III）', result: 'まとめている本', cost: 11 },
      { no: 6, section: 'target', title: '本（ダメージ軽減 IV）を合わせる', left: 'まとめている本（手順5の結果）', right: '本（ダメージ軽減 IV）', result: 'まとめた本（完成）', cost: 11 },
    ])
    expect(plan.summary).toMatchObject({ totalLevels: 49, maxStepLevels: 12, xpPoints: 793, finalPriorWorkPenalty: 15 })
    expect(plan.summary.applyToFreshItem).toEqual({ cost: 58, tooExpensive: true })
  })
})

describe('advanced problem with owned books', () => {
  const { plan } = planOf('advancedUnused')

  it('builds the steps and labels', () => {
    expect(rows(plan)).toEqual([
      { no: 1, section: 'materials', title: '本Aを作る', left: '本（幸運 III）', right: '本（修繕）', result: '本A', cost: 2 },
      { no: 2, section: 'target', title: 'ツルハシに本Aを付ける', left: 'ツルハシ', right: '本A（幸運 III、修繕）', result: 'ツルハシ', cost: 12 },
      { no: 3, section: 'target', title: 'ツルハシに本（効率強化 IV）を付ける', left: 'ツルハシ（手順2の結果）', right: '本（効率強化 IV）', result: 'ツルハシ（完成）', cost: 12 },
    ])
  })

  it('explains why owned books go unused', () => {
    expect(plan.ownedUnused.map((u) => `${t(u.label)}: ${t(unusedReasonText(u.reason, plan.targetItem))}`)).toEqual([
      '本（シルクタッチ）: シルクタッチは、付けたい幸運と同時に付けられない',
      '本（耐久力 II）: ツルハシにもう耐久力 III がある',
    ])
    expect(plan.ownedUnused.map((u) => u.reason.code)).toEqual(['conflicts-wanted', 'target-has'])
    // What you have, in the order of the inputs in the plan: the item (label.itemWith when it already has enchantments),
    // then owned books.
    expect(plan.ownedUsed.map((o) => `${t(o.label)} ${o.steps.join(',')}`)).toEqual([
      'ツルハシ（効率強化 IV、耐久力 III） 2,3',
      '本（幸運 III） 1',
      '本（修繕） 1',
      '本（効率強化 IV） 3',
    ])
    expect(plan.getBooks).toEqual([])
  })

  it('sets renameHere on the step that includes the rename cost', () => {
    const renamed = planOf('advancedRename').plan
    expect(renamed.steps.map((s) => s.renameHere)).toEqual([false, false, true])
    expect(renamed.steps[2].cost.total).toBe(13)
    expect(renamed.steps.every((s) => s.kind === 'combine')).toBe(true)
  })
})

describe('other unused reasons', () => {
  it('reports books without wanted enchantments and books covered by others', () => {
    const problem: Problem = {
      mode: 'advanced',
      target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
      extraItems: [],
      books: [
        { enchantments: { unbreaking: 3 }, anvilUses: 0 },
        { enchantments: { unbreaking: 2 }, anvilUses: 0 },
        { enchantments: { feather_falling: 4 }, anvilUses: 0 },
      ],
      goal: { unbreaking: 3 },
      useOnlyNeeded: true,
    }
    const result = fixtureOk(problem, DEFAULT_SETTINGS, node(leaf(0), leaf(1)), { method: 'exact' })
    const plan = displayPlanFromResult(result, problem, DEFAULT_SETTINGS)
    expect(plan.ownedUnused.map((u) => t(unusedReasonText(u.reason, plan.targetItem)))).toEqual([
      '耐久力はほかの本で足りている',
      '付けたいエンチャントが入っていない',
    ])
    expect(plan.ownedUnused.map((u) => u.reason.code)).toEqual(['covered-by-others', 'no-wanted'])
  })

  it('groups copies of an owned book into one row with the unused count', () => {
    const problem: Problem = {
      mode: 'advanced',
      target: { itemType: 'mace', enchantments: {}, anvilUses: 0 },
      extraItems: [],
      books: [{ enchantments: { wind_burst: 1 }, anvilUses: 0, count: 6 }],
      goal: { wind_burst: 3 },
      useOnlyNeeded: true,
    }
    // Four level I books make III (1+2 and 3+4 give II + II, then III), leaving two unused.
    const result = fixtureOk(problem, DEFAULT_SETTINGS, node(leaf(0), node(node(leaf(1), leaf(2)), node(leaf(3), leaf(4)))), { method: 'exact' })
    const input = { item: 'mace' as const, existing: {}, wanted: { wind_burst: 3 }, ownedBooks: [{ enchantments: { wind_burst: 1 }, count: 6 }], extraItems: [] }
    const plan = displayPlanFromResult(result, problem, DEFAULT_SETTINGS, { input })
    expect(plan.ownedUnused).toHaveLength(1)
    expect(plan.ownedUnused[0]).toMatchObject({ source: { kind: 'owned', index: 0, copy: 4 }, count: 2 })
    expect(t(unusedReasonText(plan.ownedUnused[0].reason, plan.targetItem))).toBe('ウィンドバーストはほかの本で足りている')
    expect(plan.ownedUsed.map((o) => t(o.label))).toEqual([
      'メイス（新品）',
      '本（ウィンドバースト I）',
      '本（ウィンドバースト I）',
      '本（ウィンドバースト I）',
      '本（ウィンドバースト I）',
    ])
  })
})

describe('Creative and reference plans', () => {
  it('flags steps of 40 or more levels with nested merged books', () => {
    const { plan } = planOf('creative40')
    expect(rows(plan)).toEqual([
      { no: 1, section: 'materials', title: '本Aを作る', left: '本（幸運 III）', right: '本（効率強化 V）', result: '本A', cost: 5 },
      { no: 2, section: 'materials', title: '本Bを作る', left: '本A（幸運 III、効率強化 V）', right: '本（修繕）', result: '本B', cost: 3 },
      { no: 3, section: 'target', title: 'ツルハシに本Bを付ける', left: 'ツルハシ', right: '本B（幸運 III、効率強化 V、修繕）', result: 'ツルハシ（完成）', cost: 47 },
    ])
    expect(plan.steps[2]).toMatchObject({ tooExpensive: true, warnings: ['steps-over-survival-limit'] })
  })

  it('builds from the reference plan of an infeasible result', () => {
    const fixture = getFixture('infeasible')
    if (fixture.result.status !== 'infeasible' || fixture.result.reference === null) throw new Error('no reference plan')
    const plan = displayPlanFromReference(fixture.result.reference, fixture.problem, fixture.settings)
    expect(plan.steps.map((s) => [s.cost.total, s.tooExpensive])).toEqual([
      [5, false],
      [3, false],
      [47, true],
    ])
    expect(plan.baseline).toBeNull()
  })
})

describe('letterFor', () => {
  it('continues from Z to AA', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(letterFor)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'])
  })
})

describe('labels for inputs outside the plan', () => {
  it('labels a new item, an owned item and an original book', () => {
    expect(t(problemInputLabel(BOOTS_PROBLEM, 0))).toBe('ブーツ（新品）')
    expect(t(problemInputLabel(BOOTS_PROBLEM, 5))).toBe('本（棘の鎧 III）')
    expect(t(problemInputLabel(ADVANCED_PROBLEM, 0))).toBe('ツルハシ')
    expect(t(problemInputLabel(ADVANCED_PROBLEM, 3))).toBe('本（幸運 III）')
  })

  it('labels extra items as numbered spares of the same material', () => {
    const problem: Problem = {
      mode: 'advanced',
      target: { itemType: 'pickaxe', enchantments: {}, anvilUses: 0 },
      extraItems: [{ enchantments: { efficiency: 3 }, anvilUses: 1 }],
      books: [],
      goal: null,
      useOnlyNeeded: false,
    }
    expect(t(problemInputLabel(problem, 1))).toBe('予備のツルハシ1（同じ素材）')
  })

  it('matches the slot labels in every fixture', () => {
    for (const fixture of Object.values(getFixtures())) {
      if (fixture.result.status !== 'ok') continue
      const { plan } = planOf(fixture.name)
      for (const step of plan.steps) {
        const engine = fixture.result.plan.steps[step.engineIndex - 1]
        if (engine.left.kind === 'input') expect(t(problemInputLabel(fixture.problem, engine.left.input))).toBe(t(step.left.fullLabel))
        if (engine.right?.kind === 'input' && step.right !== null) {
          expect(t(problemInputLabel(fixture.problem, engine.right.input))).toBe(t(step.right.fullLabel))
        }
      }
    }
  })

  it('gives every slot the contents of the matching engine object in every fixture', () => {
    const levels = (state: { readonly enchantments: readonly { readonly id: string; readonly level: number }[] }) =>
      Object.fromEntries(state.enchantments.map((e) => [e.id, e.level]))
    let books = 0
    for (const fixture of Object.values(getFixtures())) {
      if (fixture.result.status !== 'ok') continue
      const { plan } = planOf(fixture.name)
      for (const step of plan.steps) {
        const engine = fixture.result.plan.steps[step.engineIndex - 1]
        expect(step.left.contents, fixture.name).toEqual(levels(engine.before.left))
        if (engine.before.right !== null) expect(step.right?.contents, fixture.name).toEqual(levels(engine.before.right))
        expect(step.result.contents, fixture.name).toEqual(levels(engine.after))
        books += [step.left, step.right, step.result].filter((slot) => slot?.item === 'enchanted_book').length
      }
    }
    // At least one fixture puts a book in a slot.
    expect(books).toBeGreaterThan(0)
  })

  it('throws on an out-of-range index', () => {
    expect(() => problemInputLabel(BOOTS_PROBLEM, 8)).toThrow(RangeError)
  })

  it('finds the target item and detects book-only problems', () => {
    expect(targetItemOf(BOOTS_PROBLEM)).toBe('boots')
    expect(targetItemOf(ADVANCED_PROBLEM)).toBe('pickaxe')
    expect(targetItemOf(BOOK_ONLY_PROBLEM)).toBeNull()
    expect(isBookOnlyProblem(BOOK_ONLY_PROBLEM)).toBe(true)
    expect(isBookOnlyProblem(BOOTS_PROBLEM)).toBe(false)
  })

  it('finds the step where the name is typed', () => {
    expect(renameStepOf(planOf('bootsRename').plan)).toBe(1)
    expect(renameStepOf(planOf('bootsSevenBooks').plan)).toBeNull()
  })
})

describe('assumption line', () => {
  it('orders the assumptions as item state, books to get, then durability', () => {
    const joined = (parts: readonly TextArg[]) => parts.map((p) => t(p)).join('')
    expect(joined(assumptionParts(BOOTS_PROBLEM, { hasSupplements: true }))).toBe(
      'ブーツは新品の前提で計算しています。用意する本は、まだ金床を使っていない前提です。耐久値は満タンの前提です。',
    )
    expect(joined(assumptionParts(BOOK_ONLY_PROBLEM, { hasSupplements: true }))).toBe(
      'どの本も、まだ金床を使っていない前提で計算しています。用意する本は、まだ金床を使っていない前提です。耐久値は満タンの前提です。',
    )
    expect(joined(assumptionParts(ADVANCED_PROBLEM, { hasSupplements: false }))).toBe(
      'ツルハシの金床使用回数は2回（自動）で計算しています。耐久値は満タンの前提です。',
    )
    expect(joined(assumptionParts(ADVANCED_PROBLEM, { hasSupplements: false, anvilUsesOverride: 2 }))).toBe(
      'ツルハシの金床使用回数は2回（入力）で計算しています。耐久値は満タンの前提です。',
    )
  })
})
