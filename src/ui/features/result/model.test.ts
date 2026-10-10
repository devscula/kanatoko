import { describe, expect, it, vi } from 'vitest'
import { solveSync } from '../../../engine/index.ts'
import type {
  AdvancedProblem,
  ClientResult,
  EnchantLevels,
  Problem,
  Settings,
  SolveOk,
  SolveResult,
  Suggestion,
} from '../../../engine/index.ts'
import { BOOTS_PROBLEM, DEFAULT_SETTINGS, getFixture, INFEASIBLE_PROBLEM } from '../../dev/fixtures.ts'
import { createTranslator } from '../../i18n/render.ts'
import { displayPlanFromResult } from '../../plan/displayPlan.ts'
import {
  booksToRemove,
  complexityRatio,
  extraEnchantmentTexts,
  gaugeNote,
  mismatchKeys,
  showsBusyBadge,
  showsGauge,
} from './model.ts'
import { summaryNotices, type SummaryActions } from './notices.ts'
import { positionOf } from './resultAnchor.ts'
import { resultBarContent } from './resultBarContent.ts'
import { sortSuggestions, suggestionButton, suggestionTitle, suggestionToast, type ShownSuggestion } from './suggestions.ts'
import { infeasibleTitleKey } from '../../solver/infeasibleTitle.ts'
import type { SolveOutcome } from '../../solver/types.ts'
import { buildTree, connectorPath, layoutTree, type LeafNode, type PlacedLeaf, type PlacedStep, type StepNode } from './tree.ts'

// Turns the no-break space between an enchantment name and its level into a plain space
function plainTranslator(...args: Parameters<typeof createTranslator>) {
  const translator = createTranslator(...args)
  return { text: (text: Parameters<typeof translator.text>[0]) => translator.text(text).replaceAll('\u00a0', ' ') }
}
const ja = plainTranslator({ lang: 'ja', edition: 'java' })

function shown(result: ClientResult): Exclude<ClientResult, { readonly status: 'cancelled' }> {
  if (result.status === 'cancelled') throw new Error('cancelled')
  return result
}

function okOf(name: Parameters<typeof getFixture>[0]): SolveOk {
  const result = getFixture(name).result
  if (result.status !== 'ok') throw new Error(`fixture ${name} is not ok`)
  return result
}

function planOf(name: Parameters<typeof getFixture>[0]) {
  const fixture = getFixture(name)
  return displayPlanFromResult(okOf(name), fixture.problem, fixture.settings)
}

describe('step card contents', () => {
  it('checks the book for a book on the right, repair for an item, and adds the wiki note last in Bedrock Edition', () => {
    const step = planOf('bootsSevenBooks').steps[4]
    expect(mismatchKeys(step, 'simple', 'java')).toEqual(['mismatch.swap', 'mismatch.wrongBook', 'mismatch.priorWork', 'mismatch.renameTyped'])
    expect(mismatchKeys({ ...step, right: step.left, rightIsItem: true, renameHere: true }, 'advanced', 'bedrock')).toEqual([
      'mismatch.swap',
      'mismatch.priorWork',
      'mismatch.renameMissing',
      'mismatch.repair',
      'mismatch.bedrock',
    ])
  })

  it('shows the gauge from 30 or when too expensive, with notes for 35 to 38 and for exactly 39', () => {
    const step = planOf('bootsSevenBooks').steps[0]
    expect(showsGauge(step)).toBe(false)
    expect(showsGauge({ ...step, cost: { ...step.cost, total: 30 } })).toBe(true)
    expect(showsGauge({ ...step, tooExpensive: true })).toBe(true)
    expect(gaugeNote(34)).toBeNull()
    expect(ja.text(gaugeNote(35)!)).toBe('上限まであと4レベル')
    expect(ja.text(gaugeNote(39)!)).toBe('上限ちょうどです')
  })
})

describe('too complex', () => {
  it('rounds the ratio to one decimal place, or to a whole number from 10', () => {
    expect(complexityRatio(4_400_000, 1_000_000)).toBe(4.4)
    expect(complexityRatio(12_600_000, 1_000_000)).toBe(13)
  })

  it('asks to remove ceil(log3(work / limit)) more different books, at least one', () => {
    expect(booksToRemove(2 * 3 ** 13, 360_000)).toBe(2)
    expect(booksToRemove(1_000_001, 1_000_000)).toBe(1)
    expect(booksToRemove(27_000_000, 1_000_000)).toBe(3)
  })
})

describe('suggestions', () => {
  const drop: Suggestion = { code: 'drop-goal-enchantment', enchantment: 'fortune', totalLevels: 41, maxStepLevels: 39 }

  it('keeps the three cheapest and drops kinds the UI never produces', () => {
    const list: Suggestion[] = [
      { code: 'enable-use-only-needed', totalLevels: 20, maxStepLevels: 30 },
      drop,
      { code: 'lower-goal-level', enchantment: 'fortune', level: 2, totalLevels: 45, maxStepLevels: 20 },
      { code: 'drop-goal-enchantment', enchantment: 'mending', totalLevels: 50, maxStepLevels: 20 },
      { code: 'drop-goal-enchantment', enchantment: 'efficiency', totalLevels: 60, maxStepLevels: 20 },
      { code: 'add-book', enchantment: 'fortune', level: 3, totalLevels: 10, maxStepLevels: 20 },
      { code: 'remove-input', input: 1, totalLevels: 11, maxStepLevels: 20 },
    ]
    expect(sortSuggestions(list).map((s) => s.totalLevels)).toEqual([41, 45, 50])
  })

  it('uses the same titles and buttons for every input mode', () => {
    expect(ja.text(suggestionTitle(drop, INFEASIBLE_PROBLEM))).toBe('幸運 III を外す')
    expect(ja.text(suggestionTitle(drop, { ...BOOTS_PROBLEM }))).toBe('幸運を外す')
    expect(ja.text(suggestionButton(drop))).toBe('外す')
    const lower: Suggestion = { code: 'lower-goal-level', enchantment: 'wind_burst', level: 2, totalLevels: 30, maxStepLevels: 12 }
    expect(ja.text(suggestionTitle(lower as ShownSuggestion, BOOTS_PROBLEM))).toBe('ウィンドバーストを II にする')
    expect(ja.text(suggestionButton(lower as ShownSuggestion))).toBe('II にする')
  })
})

describe('suggestion toasts', () => {
  it('describes what each suggestion changed instead of a generic message', () => {
    const cases: readonly [ShownSuggestion, Problem, string][] = [
      [{ code: 'drop-goal-enchantment', enchantment: 'fortune', totalLevels: 1, maxStepLevels: 1 }, INFEASIBLE_PROBLEM, '幸運 III を外しました'],
      [{ code: 'drop-goal-enchantment', enchantment: 'thorns', totalLevels: 1, maxStepLevels: 1 }, BOOTS_PROBLEM, '棘の鎧 III を外しました'],
      [{ code: 'lower-goal-level', enchantment: 'wind_burst', level: 2, totalLevels: 1, maxStepLevels: 1 }, BOOTS_PROBLEM, 'ウィンドバーストを II にしました'],
    ]
    for (const [suggestion, problem, expected] of cases) expect(ja.text(suggestionToast(suggestion, problem))).toBe(expected)
    const en = plainTranslator({ lang: 'en', edition: 'java' })
    expect(en.text(suggestionToast(cases[0][0], INFEASIBLE_PROBLEM))).toBe('Removed Fortune III')
  })
})

function solved(problem: Problem, settings: Settings = DEFAULT_SETTINGS): SolveResult {
  return solveSync(problem, settings)
}

describe('infeasible heading', () => {
  it('uses the any-input title only when the engine ruled out the level limit', () => {
    expect(infeasibleTitleKey({ capExcluded: true })).toBe('infeasible.titleAny')
    expect(infeasibleTitleKey({ capExcluded: false })).toBe('infeasible.title')
  })

  it('uses the any-input title for too few or missing books and the Survival title for the level limit', () => {
    const mace: Problem = {
      mode: 'advanced',
      target: { itemType: 'mace', enchantments: {}, anvilUses: 0 },
      extraItems: [],
      books: [{ enchantments: { wind_burst: 1 }, anvilUses: 0, count: 3 }],
      goal: { wind_burst: 3 },
      useOnlyNeeded: true,
    }
    const noBook: Problem = {
      mode: 'advanced',
      target: { itemType: 'pickaxe', enchantments: {}, anvilUses: 0 },
      extraItems: [],
      books: [{ enchantments: { mending: 1 }, anvilUses: 0 }],
      goal: { mending: 1, fortune: 3 },
      useOnlyNeeded: true,
    }
    for (const [problem, key] of [
      [mace, 'infeasible.titleAny'],
      [noBook, 'infeasible.titleAny'],
      [INFEASIBLE_PROBLEM, 'infeasible.title'],
    ] as const) {
      const result = solved(problem)
      if (result.status !== 'infeasible') throw new Error(result.status)
      expect(infeasibleTitleKey(result)).toBe(key)
    }
  })
})

const noopActions: SummaryActions = { onKeep: vi.fn(), onChooseItem: vi.fn() }

function noticesOf(problem: AdvancedProblem, actions: SummaryActions = noopActions) {
  const result = solved(problem)
  if (result.status !== 'ok') throw new Error(result.status)
  const notices = summaryNotices(
    result.warnings,
    { itemType: problem.target?.itemType ?? null },
    actions,
  )
  return { result, notices, texts: notices.map((n) => ja.text(n.text)) }
}

const sword = { itemType: 'sword', enchantments: {}, anvilUses: 0 } as const
const adv = (target: AdvancedProblem['target'], books: readonly EnchantLevels[], goal: EnchantLevels | null): AdvancedProblem => ({
  mode: 'advanced',
  target,
  extraItems: [],
  books: books.map((enchantments) => ({ enchantments, anvilUses: 0 })),
  goal,
  useOnlyNeeded: true,
})

describe('summary notices', () => {
  it('shows discarded enchantments with "Keep it" and ignores other warning codes', () => {
    const onKeep = vi.fn()
    const notices = summaryNotices(
      [
        { code: 'below-reachable-level', items: [{ id: 'unbreaking', level: 1, reachable: 2 }] },
        {
          code: 'enchantments-discarded',
          items: [{ id: 'sharpness', inputLevel: 5, finalLevel: 0, inputs: [2], reason: 'conflict' }],
          keep: { enchantments: { sharpness: 5 }, totalLevels: 11, maxStepLevels: 6 },
        },
        { code: 'inputs-unused', inputs: [1] },
      ],
      { itemType: 'sword' },
      { ...noopActions, onKeep },
    )
    expect(notices.map((n) => ja.text(n.text))).toEqual(['合計を少なくするため、ダメージ増加 V は付けずに捨てる手順にしています。'])
    expect(ja.text(notices[0].more!)).toBe('付けたまま作ると合計11レベルです。')
    notices[0].actions[0].run()
    expect(onKeep).toHaveBeenCalledWith({ sharpness: 5 })
  })

  it('words each discard reason differently: does not fit the item, conflicts with existing enchantments, or left off to save levels', () => {
    // Protection does not go on a sword
    expect(noticesOf(adv(sword, [{ unbreaking: 3, protection: 4 }], { unbreaking: 3 })).texts).toEqual([
      'ダメージ軽減 IV は剣に付かないので、引き継がれません。',
    ])
    // Riptide cannot join the trident's existing Loyalty
    const trident = adv({ itemType: 'trident', enchantments: { loyalty: 3 }, anvilUses: 0 }, [{ riptide: 3, unbreaking: 2 }], null)
    expect(noticesOf(trident).texts).toEqual(['激流 III はほかのエンチャントと同時に付けられないので、完成品には付きません。'])
    // "To lower the total" only when keeping it works and costs more
    const leftOff = noticesOf(adv(sword, [{ smite: 1 }, { sharpness: 5, looting: 3 }], { looting: 3 }))
    expect(leftOff.texts).toEqual(['合計を少なくするため、ダメージ増加 V は付けずに捨てる手順にしています。'])
    expect(ja.text(leftOff.notices[0].more!)).toBe('付けたまま作ると合計11レベルです。')
    expect(leftOff.notices[0].actions.map((a) => ja.text(a.label))).toEqual(['付けたまま作る'])
  })

  it('gives enchantments that do not fit and conflicting ones separate notices', () => {
    const notices = summaryNotices(
      [
        {
          code: 'enchantments-discarded',
          items: [
            { id: 'protection', inputLevel: 4, finalLevel: 0, inputs: [1], reason: 'inapplicable' },
            { id: 'smite', inputLevel: 5, finalLevel: 0, inputs: [2], reason: 'conflict' },
          ],
          keep: null,
        },
      ],
      { itemType: 'sword' },
      noopActions,
    )
    expect(notices.map((n) => ja.text(n.text))).toEqual([
      'ダメージ軽減 IV は剣に付かないので、引き継がれません。',
      'アンデッド特効 V はほかのエンチャントと同時に付けられないので、完成品には付きません。',
    ])
  })
})

describe('extra enchantments', () => {
  it('lists them with their levels', () => {
    const plan = { ...planOf('bootsSevenBooks'), extraEnchantments: ['thorns' as const] }
    expect(ja.text({ t: 'list', items: extraEnchantmentTexts(plan) })).toBe('棘の鎧 III')
  })
})

describe('tree and result bar', () => {
  it('roots the tree at the finished item with left and right subtrees, with the inputs as leaves', () => {
    const fixture = getFixture('bootsSevenBooks')
    const plan = planOf('bootsSevenBooks')
    const root = buildTree(plan, okOf('bootsSevenBooks').plan)
    expect(root?.kind).toBe('step')
    if (root?.kind !== 'step') return
    expect(root.step.no).toBe(7)
    expect(root.right?.kind === 'step' && root.right.step.no).toBe(6)
    // The leftmost leaf is the base item
    let node = root
    while (node.left.kind === 'step') node = node.left
    expect(node.left.kind === 'leaf' && node.left.slot.source).toEqual({ kind: 'target' })
    expect(fixture.problem.mode).toBe('simple')
  })

  it('lays the tree out top down: one row per step in step order, each step under its inputs, each material just above its step', () => {
    const root = buildTree(planOf('bootsSevenBooks'), okOf('bootsSevenBooks').plan)
    if (root === null) throw new Error('the plan has no steps')
    const metrics = { leafWidth: 100, gap: 8, nodeHeight: 48, rowHeight: 76, firstRow: 32 }
    const layout = layoutTree(root, metrics)
    expect(layout.leaves.map((leaf) => leaf.x)).toEqual([50, 158, 266, 374, 482, 590, 698, 806])
    expect(layout.width).toBe(8 * 108 - 8)
    const steps: PlacedStep[] = []
    const walk = (step: PlacedStep): void => {
      steps.push(step)
      for (const input of step.inputs) if (input.kind === 'step') walk(input)
    }
    walk(layout.root)
    expect(steps.map((step) => step.node.step.no).sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
    for (const step of steps) {
      expect(step.y).toBe(metrics.firstRow + (step.node.step.no - 1) * metrics.rowHeight)
      expect(step.x).toBe(step.inputs.reduce((sum, input) => sum + input.x, 0) / step.inputs.length)
      expect(step.inputs[0].x).toBeLessThan(step.x)
      expect(step.inputs[1].x).toBeGreaterThan(step.x)
      for (const input of step.inputs) {
        if (input.kind === 'step') expect(input.y).toBeLessThan(step.y)
        else expect(input.bottom).toBe(step.y - metrics.firstRow)
      }
    }
    // The books for step 6 hang down to it rather than waiting in a row at the top
    expect(layout.leaves.map((leaf) => leaf.bottom)).toEqual([0, 0, 76, 76, 228, 228, 380, 380])
    expect(layout.height).toBe(layout.root.y + metrics.nodeHeight)
  })

  it('draws a connector straight down when aligned, otherwise down, across the crossbar and down with rounded corners', () => {
    const leaf = (x: number): PlacedLeaf => ({ kind: 'leaf', node: {} as LeafNode, x, bottom: 0 })
    const step = (x: number, y: number): PlacedStep => ({ kind: 'step', node: {} as StepNode, x, y, inputs: [] })
    expect(connectorPath(leaf(50), step(50, 100), 48)).toBe('M50 0V100')
    expect(connectorPath(leaf(50), step(104, 100), 48)).toBe('M50 0V74Q50 82 58 82H96Q104 82 104 90V100')
    // Close inputs shrink the radius to half the distance across, so the two corners still meet
    expect(connectorPath(leaf(100), step(104, 100), 48)).toBe('M100 0V80Q100 82 102 82H102Q104 82 104 84V100')
  })

  it('tells whether a card fully out of view is above or below the viewport', () => {
    expect(positionOf({ top: 900, bottom: 1200 }, 800)).toBe('below')
    expect(positionOf({ top: -500, bottom: -10 }, 800)).toBe('above')
    expect(positionOf({ top: -10, bottom: 10 }, 800)).toBe('visible')
  })

  it('shows figures for a plan, the heading for failures, "Calculating" while stale, and nothing when empty', () => {
    const fixture = getFixture('bootsSevenBooks')
    // The result bar does not read built or input
    const outcome = {
      kind: 'result' as const,
      result: shown(fixture.result),
      problem: fixture.problem,
      settings: fixture.settings,
      planId: 'p',
    } as unknown as Extract<SolveOutcome, { readonly kind: 'result' }>
    const ok = resultBarContent({ outcome, stale: false })
    expect(ok).toMatchObject({ kind: 'figures', steps: 7, summary: { totalLevels: 66, maxStepLevels: 16 } })
    const stale = resultBarContent({ outcome, stale: true })
    expect(stale?.kind === 'text' && ja.text(stale.text)).toBe('計算中')
    const infeasible = getFixture('infeasible')
    const bar = resultBarContent({ outcome: { ...outcome, result: shown(infeasible.result), settings: infeasible.settings }, stale: false })
    expect(bar?.kind === 'text' && [ja.text(bar.text), ja.text(bar.action)]).toEqual(['サバイバルでは作れません', '理由を見る'])
    const textOf = (result: Parameters<typeof shown>[0]) => {
      const content = resultBarContent({ outcome: { ...outcome, result: shown(result) }, stale: false })
      return content?.kind === 'text' ? [ja.text(content.text), ja.text(content.action)] : content
    }
    expect(textOf(getFixture('tooComplex').result)).toEqual(['組み合わせが多すぎて計算できません', '理由を見る'])
    expect(textOf({ ...(getFixture('tooComplex').result as Extract<ClientResult, { status: 'too-complex' }>), cause: 'time-limit' })).toEqual([
      '計算が時間内に終わりませんでした',
      '理由を見る',
    ])
    expect(textOf(getFixture('invalid').result)).toEqual(['入力に直すところがあります', '理由を見る'])
    expect(textOf({ status: 'error', cause: 'worker-crashed', message: 'x', retryable: true })).toEqual(['計算できませんでした', '理由を見る'])
    // When the level limit is not the cause, the bar matches the heading
    const unreachable = { ...(infeasible.result as Extract<ClientResult, { status: 'infeasible' }>), reasons: [{ code: 'goal-enchantment-missing', enchantment: 'fortune' }], capExcluded: true } as const
    expect(textOf(unreachable)).toEqual(['この入力では作れません', '理由を見る'])
    expect(resultBarContent({ outcome: { ...outcome, result: { status: 'empty' } } as typeof outcome, stale: false })).toBeNull()
    expect(resultBarContent({ outcome: { kind: 'empty', reason: 'noItem' }, stale: false })).toBeNull()
  })

  it('shows the busy badge by the heading only when the status card is hidden', () => {
    expect(showsBusyBadge({ stale: true, slow: false, slowPredicted: false })).toBe(true)
    expect(showsBusyBadge({ stale: true, slow: true, slowPredicted: false })).toBe(false)
    expect(showsBusyBadge({ stale: true, slow: false, slowPredicted: true })).toBe(false)
    expect(showsBusyBadge({ stale: false, slow: false, slowPredicted: false })).toBe(false)
  })
})
