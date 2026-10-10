// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { solveSync, type SolveOk, type SolveResult } from '../../../engine/index.ts'
import { getFixture, type FixtureName } from '../../dev/fixtures.ts'
import { createTranslator } from '../../i18n/render.ts'
import { INITIAL_VIEW } from '../../solver/controller.ts'
import { createPlaceholderBackend } from '../../solver/placeholderBackend.ts'
import type { SolveActions, SolveOutcome, SolveView } from '../../solver/types.ts'
import { startSolver, stopSolver } from '../../solver/useSolveResult.ts'
import { buildProblem, planIdOf } from '../../state/buildProblem.ts'
import { EXAMPLE_INPUT } from '../../state/convert.ts'
import { DEFAULT_INPUT, DEFAULT_SESSION, type InputState } from '../../state/types.ts'
import { memoryStorage, wrapStorage } from '../../state/storage.ts'
import { selectUndoLabel } from '../../state/selectors.ts'
import { createAppStore, getAppStore, setAppStore } from '../../state/store.ts'
import { bookImage } from '../../icons/bookImages.ts'
import { itemImage } from '../../icons/itemImages.ts'
import { displayPlanFromResult } from '../../plan/displayPlan.ts'
import { INPUT_IDS } from '../input/ids.ts'
import { INPUT_COLUMN_ID } from '../shell/inputColumn.ts'
import { MatchLine } from './MatchLine.tsx'
import { resetResultAnchor } from './resultAnchor.ts'
import { ResultBar } from './ResultBar.tsx'
import { ResultPanel, ResultView } from './ResultPanel.tsx'

// These tests only check where the share actions go
vi.mock('../share/index.tsx', () => ({
  ShareActions: () => <div data-testid="share-actions" />,
}))

const state = () => getAppStore().getState()
const ja = createTranslator({ lang: 'ja', edition: 'java' })
// Turns the no-break space between an enchantment name and its level into a plain space
const plain = (text: string | null) => text?.replaceAll('\u00a0', ' ') ?? null

function outcomeOf(name: FixtureName, result: SolveResult = getFixture(name).result): SolveOutcome {
  const fixture = getFixture(name)
  if (result.status === 'empty' && name === 'empty') return { kind: 'empty', reason: 'noEnchantments' }
  if (result.status === 'cancelled') throw new Error('cancelled results never reach the screen')
  // Without built, the display plan takes sources from the origin of each engine input
  return {
    kind: 'result',
    result,
    problem: fixture.problem,
    settings: fixture.settings,
    input: DEFAULT_INPUT,
    planId: planIdOf(fixture.problem, fixture.settings),
  } as unknown as SolveOutcome
}

function viewOf(outcome: SolveOutcome | null, patch: Partial<SolveView> = {}): SolveView & SolveActions {
  return { ...INITIAL_VIEW, outcome, ...patch, cancel: vi.fn(), retry: vi.fn() }
}

function okOf(name: FixtureName): SolveOk {
  const result = getFixture(name).result
  if (result.status !== 'ok') throw new Error(name)
  return result
}

const cardOf = (no: number) => document.getElementById(`step-${no}`)!

function visibleTextOf(el: Element): string {
  const copy = el.cloneNode(true) as Element
  for (const hidden of copy.querySelectorAll('.visually-hidden')) hidden.remove()
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}

beforeEach(() => {
  setAppStore(createAppStore({ storage: wrapStorage(memoryStorage()) }))
})

afterEach(() => {
  stopSolver()
  resetResultAnchor()
  vi.restoreAllMocks()
})

describe('result panel', () => {
  it('renders the h2#results heading and the summary figures, without the optimality or one-book-at-a-time lines', () => {
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    const heading = screen.getByRole('heading', { level: 2, name: '手順' })
    expect(heading).toHaveAttribute('id', 'results')
    expect(heading).toHaveAttribute('tabindex', '-1')
    const summary = screen.getByRole('region', { name: '要約' })
    const figures = within(summary).getAllByRole('definition').map((dd) => dd.textContent)
    expect(figures.slice(0, 3)).toEqual(['66レベル', '16レベル', '7'])
    expect(summary).toHaveTextContent('1回の手順にかかるのは多くても16レベルです。続けてすべて行うと、合計66レベルを使います。')
    expect(summary).toHaveTextContent('1,246')
    expect(summary).toHaveTextContent('金床使用回数 4回')
    expect(summary).not.toHaveTextContent('最も少なくなる順番')
    expect(summary).not.toHaveTextContent('1冊ずつ付けると')
  })

  it('opens the info explanations on press and closes them on Esc (WCAG 1.4.13)', async () => {
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    const info = screen.getByRole('button', { name: '経験値ポイントの説明' })
    expect(info).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(info)
    expect(info).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: '経験値ポイントの説明' })).toHaveTextContent('必要なレベルちょうどで各手順を行ったときの合計')
    await userEvent.keyboard('{Escape}')
    expect(info).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists the steps in display order without section headings and names merged books A to C', () => {
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    expect(screen.queryByRole('region', { name: '材料の本を作る' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'ブーツに付ける' })).toBeNull()
    const costs = [1, 2, 3, 4, 5, 6, 7].map((no) => within(cardOf(no)).getByText(/^\d+$/, { selector: 'p span' }).textContent)
    expect(costs).toEqual(['12', '2', '16', '4', '14', '3', '15'])
    expect([...document.querySelectorAll('li[id^="step-"]')].map((li) => li.id)).toEqual(['step-1', 'step-2', 'step-3', 'step-4', 'step-5', 'step-6', 'step-7'])
    expect(within(cardOf(2)).getByText('結果', { selector: 'dt' }).nextElementSibling?.textContent).toBe('本A')
    expect(cardOf(1)).toHaveTextContent('ブーツ（新品）')
    expect(visibleTextOf(cardOf(3))).toContain('本A（ソウルスピード III、修繕）')
    // Screen readers get levels as numbers
    expect(cardOf(3)).toHaveTextContent('ソウルスピード レベル3')
    expect(cardOf(7)).toHaveTextContent('ブーツ（完成）')
    expect(cardOf(1)).toHaveTextContent('金床に「エンチャントのコスト：12レベル」と表示されれば、置き方は合っています。')
    expect(cardOf(1).querySelector('[aria-hidden="true"] [data-slot-size="72"]')).not.toBeNull()
    expect(screen.getByTestId('share-actions')).toBeInTheDocument()
  })

  it('draws a single-enchantment book with its own image and a merged book with the plain book image', () => {
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    const fixture = getFixture('bootsSevenBooks')
    const plan = displayPlanFromResult(okOf('bootsSevenBooks'), fixture.problem, fixture.settings)
    const official = itemImage('enchanted_book').src
    const srcs = new Set<string>()
    for (const step of plan.steps) {
      const slots = [step.left, step.right, step.result].filter((slot) => slot !== null)
      const expected = slots.map((slot) => (slot.item === 'enchanted_book' ? (bookImage(slot.contents)?.src ?? official) : itemImage(slot.item).src))
      const shown = [...cardOf(step.no).querySelectorAll('[data-slot-size] img')].map((img) => img.getAttribute('src'))
      expect(shown, `step ${step.no}`).toEqual(expected)
      for (const src of shown) srcs.add(src!)
    }
    expect([...srcs].some((src) => src.endsWith('/books/soul_speed_3.png'))).toBe(true)
    expect(srcs.has(official)).toBe(true)
  })

  it('gives every step card the same shape, with only the breakdown and mismatch buttons', () => {
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    const card1 = cardOf(1)
    expect(within(card1).getByRole('heading', { level: 4 })).toHaveTextContent('手順 1 ブーツに本（棘の鎧 レベル3）を付ける')
    expect(within(card1).getByText('結果', { selector: 'dt' }).nextElementSibling?.textContent).toBe('ブーツ')
    expect(card1).toHaveTextContent('金床に「エンチャントのコスト：12レベル」と表示されれば、置き方は合っています。')
    for (const no of [1, 2, 3, 4, 5, 6, 7]) {
      expect(within(cardOf(no)).getAllByRole('button').map((button) => button.textContent)).toEqual(['内訳', 'コストが違うとき'])
    }
  })

  it('marks the previous result during a calculation with aria-busy, both badges and stale cards', () => {
    const { container } = render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'), { stale: true, pending: true })} />)
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('計算中')).toBeInTheDocument()
    expect(screen.getByText('前の結果')).toBeInTheDocument()
    expect(cardOf(1).querySelector('article')).toHaveAttribute('data-stale')
  })

  it('shows progress and a stop button after 1.5 s, and a retry button after stopping', async () => {
    const solve = viewOf(outcomeOf('bootsSevenBooks'), { stale: true, slow: true })
    const { rerender } = render(<ResultView solve={solve} computeProgress={0.4} />)
    const bar = screen.getByRole('progressbar', { name: '計算中' })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByText('組み合わせが多いので、時間がかかっています。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '中止' }))
    expect(solve.cancel).toHaveBeenCalled()
    rerender(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'), { stale: true, slow: true })} computeProgress={null} />)
    expect(screen.getByRole('progressbar', { name: '計算中' })).not.toHaveAttribute('aria-valuenow')
    const cancelled = viewOf(outcomeOf('bootsSevenBooks'), { cancelled: true })
    rerender(<ResultView solve={cancelled} />)
    expect(screen.getByText('計算を中止しました。表示は前の結果のままです。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'もう一度計算する' }))
    expect(cancelled.retry).toHaveBeenCalled()
  })

  it('breaks the cost down into multiplier x level per enchantment, prior work penalties, total and experience points', async () => {
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    const toggle = within(cardOf(3)).getByRole('button', { name: '内訳' })
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const table = within(cardOf(3)).getByRole('table', { name: '内訳' })
    const rows = within(table)
      .getAllByRole('row')
      .map((row) => Array.from(row.children).map((cell) => plain(cell.textContent)))
    expect(rows).toEqual([
      ['エンチャント', '', '14'],
      ['ソウルスピード III', '4 x 3', '12'],
      ['修繕', '2 x 1', '2'],
      ['左の累積作業費用', '', '1'],
      ['右の累積作業費用', '', '1'],
      ['合計', '', '16'],
    ])
    expect(within(table).getAllByRole('rowheader')[0]).toHaveTextContent('エンチャント')
    expect(cardOf(3)).toHaveTextContent('この手順の経験値ポイント352')
    expect(cardOf(3)).toHaveTextContent('合成後の累積作業費用（金床使用回数 2回）3')
    const wiki = within(cardOf(3)).getByRole('link', { name: /用語の説明/ })
    expect(wiki).toHaveAttribute('target', '_blank')
    expect(wiki).toHaveTextContent('（新しいタブで開きます）')
  })

  it('numbers only the mismatch checks that apply to the step', async () => {
    render(<ResultView solve={viewOf(outcomeOf('bootsBedrock'))} />)
    await userEvent.click(within(cardOf(3)).getByRole('button', { name: 'コストが違うとき' }))
    const dialog = screen.getByRole('dialog', { name: '金床のコストが16にならないとき' })
    const items = within(dialog).getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toContain('左と右が逆になっていないか')
    expect(items.some((text) => text?.includes('カーソルを合わせて'))).toBe(true)
    expect(items.some((text) => text?.includes('耐久値が減っていないか'))).toBe(false)
    expect(items.at(-1)).toContain('統合版の計算は minecraft.wiki の説明をもとにしているので')
    expect(cardOf(1)).toHaveTextContent('金床に表示されるコストが 12 なら、置き方は合っています。')
  })

  it('sets the anvil uses from the rename cost helper under the prior work check', async () => {
    act(() => getAppStore().setState({ input: EXAMPLE_INPUT }))
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    await userEvent.click(within(cardOf(4)).getByRole('button', { name: 'コストが違うとき' }))
    const dialog = screen.getByRole('dialog')
    const item3 = within(dialog)
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('金床使用回数が0回'))!
    await userEvent.click(within(item3).getByRole('button', { name: '名前を変えるときのコストから調べる' }))
    await userEvent.type(within(item3).getByLabelText('名前を変えるときのコスト'), '4')
    expect(item3).toHaveTextContent('金床使用回数 2回（累積作業費用 +3）')
    await userEvent.click(within(item3).getByRole('button', { name: 'この回数にする' }))
    expect(state().input.anvilUsesOverride).toEqual(2)
    // The steps are recalculated, so the sheet closes
    expect(dialog).not.toBeInTheDocument()
  })

  it('shows a rename-only step with no right slot, the rename hint and the rename chip', () => {
    render(<ResultView solve={viewOf(outcomeOf('bootsRename'))} />)
    const rename = cardOf(1)
    expect(rename).toHaveTextContent('この手順で名前を入力してから取り出してください（+1レベル）')
    expect(within(rename).queryByText('右', { selector: 'dt' })).toBeNull()
    expect(screen.getByRole('button', { name: '名前を付ける' })).toBeInTheDocument()
  })

  it('moves focus from the rename chip to the rename checkbox in the input column', async () => {
    const toggle = document.createElement('input')
    toggle.type = 'checkbox'
    toggle.id = INPUT_IDS.rename
    document.body.append(toggle)
    render(<ResultView solve={viewOf(outcomeOf('bootsRename'))} />)
    await userEvent.click(screen.getByRole('button', { name: '名前を付ける' }))
    expect(toggle).toHaveFocus()
    toggle.remove()
  })
})

describe('match line', () => {
  it('quotes the anvil text without wrapping in Java Edition and shows only the number in Bedrock Edition', () => {
    const { container, rerender } = render(<MatchLine edition="java" cost={16} />)
    expect(container).toHaveTextContent('金床に「エンチャントのコスト：16レベル」と表示されれば、置き方は合っています。')
    expect(screen.getByText('エンチャントのコスト：16レベル').tagName).toBe('SPAN')
    rerender(<MatchLine edition="bedrock" cost={16} />)
    expect(container).toHaveTextContent('金床に表示されるコストが 16 なら、置き方は合っています。')
    act(() => getAppStore().setState({ prefs: { ...state().prefs, lang: 'en' } }))
    rerender(<MatchLine edition="java" cost={2} />)
    expect(container).toHaveTextContent('If the anvil shows \u201cEnchantment Cost: 2\u201d, you placed them right.')
    expect(screen.getByText('Enchantment Cost: 2').tagName).toBe('SPAN')
  })
})

describe('condition chips and assumptions', () => {
  it('opens a dropdown of one setting, applies a pick at once and closes without opening the settings sheet', async () => {
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    await userEvent.click(screen.getByRole('button', { name: '計算の前提' }))
    expect(screen.getByRole('dialog', { name: '計算の前提' })).toHaveTextContent(
      'ブーツは新品の前提で計算しています。用意する本は、まだ金床を使っていない前提です。耐久値は満タンの前提です。',
    )
    await userEvent.keyboard('{Escape}')

    async function choose(chipName: string, title: string, options: readonly RegExp[], checked: number, pick: number) {
      const chip = screen.getByRole('button', { name: chipName })
      expect(chip).toHaveAttribute('aria-haspopup', 'dialog')
      expect(chip).toHaveAttribute('aria-expanded', 'false')
      await userEvent.click(chip)
      expect(chip).toHaveAttribute('aria-expanded', 'true')
      const menu = screen.getByRole('dialog', { name: title })
      const radios = within(menu).getAllByRole('radio')
      expect(radios).toHaveLength(options.length)
      radios.forEach((radio, index) => {
        expect(radio).toHaveAccessibleName(options[index])
        expect(radio).toHaveAttribute('aria-checked', String(index === checked))
      })
      await waitFor(() => expect(radios[checked]).toHaveFocus())
      await userEvent.click(radios[pick])
      expect(menu).not.toBeInTheDocument()
      expect(chip).toHaveAttribute('aria-expanded', 'false')
      expect(chip).toHaveFocus()
      expect(state().ui.settingsOpen).toBe(false)
    }

    await choose('合計レベル優先（押すと設定を開きます）', '優先するもの', [/^合計レベル優先（おすすめ）$/, /^経験値ポイント優先/, /^完成品の累積作業費用優先/], 0, 1)
    expect(state().session.objective).toBe('xp')
    expect(plain(ja.text(state().toast!.message))).toBe('「経験値ポイント優先」に切り替えました')

    await choose('サバイバル（押すと設定を開きます）', 'ゲームモード', [/^サバイバル（1回39レベルまで）$/, /^クリエイティブ（上限なし）$/], 0, 1)
    expect(state().session.levelCap).toBeNull()
    expect(plain(ja.text(state().toast!.message))).toBe('クリエイティブ（上限なし）に切り替えました')

    await choose('Java版 26.3（押すと設定を開きます）', 'エディション', [/^Java版 26\.3$/, /^統合版 26\.52$/], 0, 1)
    expect(state().session.edition).toBe('bedrock')

    // The check follows the saved setting, now Bedrock, not the displayed result, and picking it changes nothing
    const before = state().session
    await choose('Java版 26.3（押すと設定を開きます）', 'エディション', [/^Java版 26\.3$/, /^統合版 26\.52$/], 1, 1)
    expect(state().session).toBe(before)
  })

  it('opens the Bedrock Edition rules sheet from the details button', async () => {
    render(<ResultView solve={viewOf(outcomeOf('bootsBedrock'))} />)
    await userEvent.click(screen.getByRole('button', { name: '詳細' }))
    const sheet = screen.getByRole('dialog', { name: '統合版の計算規則' })
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(8)
  })
})

describe('list and tree', () => {
  it('renders the tree as nested lists, and a node switches to the list, focuses that step card and highlights it', async () => {
    act(() => state().setResultView('tree'))
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    const tree = screen.getByRole('list', { name: '合成のツリー' })
    expect(tree.querySelectorAll('ul')).not.toHaveLength(0)
    // One hidden list item per material; the drawing names a book by its contents
    expect(tree.querySelectorAll('li.visually-hidden')).toHaveLength(8)
    const drawing = tree.closest('[data-layout]')
    expect(drawing && visibleTextOf(drawing)).toContain('棘の鎧 III')
    await userEvent.click(within(tree).getByRole('button', { name: '手順3、16レベル。押すと手順カードへ移ります' }))
    expect(state().ui.resultView).toBe('list')
    await waitFor(() => expect(document.activeElement?.id).toBe('step-3-heading'))
    expect(cardOf(3)).toHaveAttribute('data-revealed')
  })

  it('toggles list and tree with the T key unless single-key shortcuts are off', async () => {
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    const group = screen.getByRole('radiogroup', { name: '手順の表示方法' })
    expect(within(group).getByRole('radio', { name: '一覧' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(document.body, { key: 't' })
    expect(state().ui.resultView).toBe('tree')
    act(() => state().setSingleKeyShortcuts(false))
    fireEvent.keyDown(document.body, { key: 't' })
    expect(state().ui.resultView).toBe('tree')
  })
})

describe('infeasible, Creative and too complex', () => {
  it('explains why the plan cannot be made, with the target penalty, verified suggestions and Creative', async () => {
    act(() => {
      getAppStore().setState({
        input: {
          ...DEFAULT_INPUT,
          item: 'pickaxe',
          existing: { unbreaking: 3 },
          anvilUsesOverride: 5,
          wanted: { efficiency: 5, fortune: 3, mending: 1 },
        },
      })
    })
    render(<ResultView solve={viewOf(outcomeOf('infeasible'))} />)
    expect(screen.getByRole('heading', { name: 'サバイバルでは作れません' })).toBeInTheDocument()
    expect(screen.getByText('どの順番で合成しても、どこかの手順で47レベル以上かかり、金床に「コストが高すぎます！」と表示されます。')).toBeInTheDocument()
    expect(
      screen.getByText('ツルハシの累積作業費用が31あるので、ツルハシに合成するときは、右に置くものの累積作業費用とエンチャントの分を合わせて8レベルまでに抑える必要があります。'),
    ).toBeInTheDocument()
    expect(screen.getByText('金床使用回数は入力した5回で計算しています。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '金床使用回数を確認する' })).toBeInTheDocument()
    const drop = screen.getByText('幸運 III を外す').closest('li')!
    expect(drop).toHaveTextContent('合計 41レベル 1回の最大 39レベル')
    await userEvent.click(within(drop).getByRole('button', { name: '外す' }))
    expect(state().input.wanted).toEqual({ efficiency: 5, mending: 1 })
    expect(state().history.past.at(-1)?.label).toEqual({ t: 'msg', key: 'history.suggestion' })
    expect(state().toast?.message).toMatchObject({ key: 'toast.sug.dropGoal' })
    expect(plain(ja.text(state().toast!.message))).toBe('幸運 III を外しました')
    const creative = screen.getByText('クリエイティブ（上限なし）にする').closest('li')!
    expect(creative).toHaveTextContent('合計 55レベル 1回の最大 47レベル')
    // Only a max step of 40 or more is marked, never a total
    expect(within(creative).getByText('47')).toHaveAttribute('data-over')
    expect(within(creative).getByText('47').querySelector('svg')).not.toBeNull()
    expect(within(drop).getByText('39')).not.toHaveAttribute('data-over')
    await userEvent.click(within(creative).getByRole('button', { name: '切り替える' }))
    expect(state().session.levelCap).toBeNull()
  })

  it('shows reference steps with step.overCap and a gauge at 40 or more', async () => {
    render(<ResultView solve={viewOf(outcomeOf('infeasible'))} />)
    await userEvent.click(screen.getByRole('button', { name: '上限なしの場合の手順（参考）' }))
    expect(screen.getByText('参考用の手順です。サバイバルでは、40レベル以上かかる手順は行えません。')).toBeInTheDocument()
    const over = document.getElementById('ref-step-3')!
    expect(over).toHaveTextContent('40レベル以上なので、サバイバルでは「コストが高すぎます！」と表示されます')
    expect(within(over).getByRole('meter')).toHaveAttribute('aria-valuetext', '47レベル。上限の39レベルを超えています')
    // A Survival anvil shows "Too Expensive!" for that step, so it has no match line
    expect(over).not.toHaveTextContent('エンチャントのコスト')
    expect(document.getElementById('ref-step-1')).toHaveTextContent('金床に「エンチャントのコスト：')
  })

  it('uses the any-input title when a wanted enchantment is missing or unreachable', () => {
    const base = getFixture('infeasible').result
    if (base.status !== 'infeasible') throw new Error('infeasible')
    const missing = {
      ...base,
      reasons: [{ code: 'goal-enchantment-missing', enchantment: 'fortune' }],
      suggestions: [],
      suggestionsComplete: true,
      capExcluded: true,
      reference: null,
    } as const
    const { rerender } = render(<ResultView solve={viewOf(outcomeOf('infeasible', missing))} />)
    expect(screen.getByRole('heading', { name: 'この入力では作れません' })).toBeInTheDocument()
    // With every candidate checked and none working, it can say removing one is not enough
    expect(screen.getByText('どれか1つを外すだけでは作れません。新品のアイテムから作るか、クリエイティブ（上限なし）で手順を見てください。')).toBeInTheDocument()
    const unreachable = { ...missing, reasons: [{ code: 'goal-level-unreachable', enchantment: 'fortune', required: 3, reachable: 2 }] } as const
    rerender(<ResultView solve={viewOf(outcomeOf('infeasible', unreachable))} />)
    expect(screen.getByRole('heading', { name: 'この入力では作れません' })).toBeInTheDocument()
    rerender(<ResultView solve={viewOf(outcomeOf('infeasible'))} />)
    expect(screen.getByRole('heading', { name: 'サバイバルでは作れません' })).toBeInTheDocument()
  })

  it('does not claim removing one is not enough when some suggestions went unchecked', () => {
    const base = getFixture('infeasible').result
    if (base.status !== 'infeasible') throw new Error('infeasible')
    const unchecked = { ...base, reasons: [{ code: 'no-plan' }], suggestions: [], suggestionsComplete: false, capExcluded: false, reference: null } as const
    render(<ResultView solve={viewOf(outcomeOf('infeasible', unchecked))} />)
    expect(screen.getByRole('heading', { name: 'サバイバルでは作れません' })).toBeInTheDocument()
    expect(
      screen.getByText('入力が多いので、それぞれの案で作れるかどうかを確認できませんでした。付けたいエンチャントを減らすか、使わない手持ちの本を外して、もう一度計算してください。'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/1つを外すだけでは作れません/)).toBeNull()
  })

  it('shows the Creative banner, a way back to Survival and gauges on steps of 40 or more', async () => {
    act(() => getAppStore().setState({ session: { ...state().session, levelCap: null } }))
    render(<ResultView solve={viewOf(outcomeOf('creative40'))} />)
    expect(screen.getByText('クリエイティブ（上限なし）で計算しています。40レベル以上かかる手順が1個あります。クリエイティブでは経験値は減りません。')).toBeInTheDocument()
    expect(within(cardOf(3)).getByRole('meter')).toHaveAttribute('aria-valuenow', '47')
    // A Creative anvil shows 47, so the match line stays
    expect(cardOf(3)).toHaveTextContent('金床に「エンチャントのコスト：47レベル」と表示されれば、置き方は合っています。')
    expect(within(cardOf(1)).queryByRole('meter')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'サバイバルに戻す' }))
    expect(state().session.levelCap).toBe(39)
    expect(state().toast?.message).toMatchObject({ key: 'toast.survivalOn' })
  })

  it('shows the work meter and how to shrink the input when too complex', () => {
    render(<ResultView solve={viewOf(outcomeOf('tooComplex'))} />)
    expect(screen.getByRole('heading', { name: '組み合わせが多すぎて計算できません' })).toBeInTheDocument()
    const meter = screen.getByRole('meter', { name: '計算量' })
    expect(meter).toHaveAttribute('aria-valuetext', '上限の約8.9倍')
    expect(meter).toHaveAttribute('aria-valuemax', '360000')
    expect(screen.getByText('中身の違う本をあと2冊減らせば計算できます。使わない手持ちの本を外すか、付けたいエンチャントを減らしてください。同じ本の冊数を減らすだけでも、計算は軽くなります。')).toBeInTheDocument()
  })

  it('removes owned books that books to get already cover when too complex in Bedrock Edition', async () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'pickaxe',
      wanted: { fortune: 3, efficiency: 5, unbreaking: 3, mending: 1 },
      ownedBooks: [{ efficiency: 1 }, { efficiency: 2 }, { efficiency: 3 }, { efficiency: 4 }, { fortune: 1 }, { fortune: 2 }, { unbreaking: 1 }, { unbreaking: 2 }, { mending: 1 }, { silk_touch: 1 }].map(
        (enchantments, i) => ({ uid: `b${i}`, enchantments, count: 1, anvilUsesOverride: null }),
      ),
    }
    const session = { ...DEFAULT_SESSION, edition: 'bedrock' as const }
    act(() => getAppStore().setState({ input, session }))
    const built = buildProblem(input, session)!
    const result = solveSync(built.problem, built.settings)
    expect(result.status).toBe('too-complex')
    const outcome = { kind: 'result', result, problem: built.problem, settings: built.settings, built, firstBuilt: null, input, planId: built.planId } as unknown as SolveOutcome
    render(<ResultView solve={viewOf(outcome)} />)
    await userEvent.click(screen.getByRole('button', { name: '用意する本と重なる手持ちの本（8冊）を外す' }))
    expect(state().input.ownedBooks.map((b) => b.enchantments)).toEqual([{ mending: 1 }, { silk_touch: 1 }])
    expect(state().toast?.message).toMatchObject({ key: 'toast.deleted' })
    expect(ja.text(selectUndoLabel(state())!)).toBe('手持ちの本を外す')
  })

  it('hides the meter and explains the limit on distinct enchantments when the work is within the limit', () => {
    const base = getFixture('tooComplex').result
    if (base.status !== 'too-complex') throw new Error('tooComplex')
    const result = { ...base, complexity: { ...base.complexity, complexity: 177_147, effectiveComplexity: 177_147 } }
    render(<ResultView solve={viewOf(outcomeOf('tooComplex', result))} />)
    expect(screen.getByRole('heading', { name: '組み合わせが多すぎて計算できません' })).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByText('本とアイテムに付いているエンチャントの種類が多すぎます。計算できるのは30種類までです。一度にまとめる本を減らしてください。')).toBeInTheDocument()
  })
})

describe('summary notices and book-only plans', () => {
  it('lists extra enchantments with their levels', () => {
    const base = okOf('bootsSevenBooks')
    const result: SolveOk = { ...base, warnings: [...base.warnings, { code: 'result-has-extra-enchantments', enchantments: ['thorns'] }] }
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks', result))} />)
    expect(screen.getByRole('region', { name: '要約' })).toHaveTextContent('付けたいもの以外にも付くエンチャント: 棘の鎧 III')
  })

  it('warns when applying the finished book would be too expensive and offers to choose an item', async () => {
    // Choosing an item presses the change button on the item row
    const card = document.createElement('div')
    card.innerHTML = `<div id="${INPUT_IDS.itemCard}"><button type="button">Change</button></div>`
    const change = vi.fn()
    card.querySelector('button')!.addEventListener('click', change)
    document.body.append(card)
    render(<ResultView solve={viewOf(outcomeOf('bookOnly'))} />)
    expect(document.getElementById('step-1')).not.toBeNull()
    expect(screen.getByText(/できた本を新品のアイテムに付けると58レベルかかり/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'アイテムを選ぶ' }))
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1))
    card.remove()
  })

})

describe('empty, invalid and error states', () => {
  it('shows the anvil outline and loads the example when nothing is picked', async () => {
    render(<ResultView solve={viewOf({ kind: 'empty', reason: 'noItem' })} />)
    expect(screen.getByText('上からアイテムと付けたいエンチャントを選んでください。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '例を見る（ブーツに本7冊）' }))
    expect(state().input).toMatchObject({ item: EXAMPLE_INPUT.item })
    // The pressed button disappears, so focus moves to the result heading rather than falling back to body
    await waitFor(() => expect(document.getElementById('results')).toHaveFocus())
    expect(screen.queryByRole('radiogroup', { name: '手順の表示方法' })).toBeNull()
  })

  it('asks for enchantments when none are picked', () => {
    render(<ResultView solve={viewOf({ kind: 'empty', reason: 'noEnchantments' })} />)
    expect(screen.getByText('上から付けたいエンチャントを選んでください。')).toBeInTheDocument()
    expect(screen.getByText('迷ったら「競合しないものをすべて最大で選ぶ」から始めてみてください。')).toBeInTheDocument()
  })

  it('points to the left column instead of above when the layout has two columns', () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = (query: string) =>
      ({
        matches: query === '(min-width: 880px)',
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
    try {
      const { unmount } = render(<ResultView solve={viewOf({ kind: 'empty', reason: 'noItem' })} />)
      expect(screen.getByText('左からアイテムと付けたいエンチャントを選んでください。')).toBeInTheDocument()
      unmount()
      render(<ResultView solve={viewOf({ kind: 'empty', reason: 'noEnchantments' })} />)
      expect(screen.getByText('左から付けたいエンチャントを選んでください。')).toBeInTheDocument()
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('shows the issue count with a button to the first issue, and the single-book message for a plan with no steps', async () => {
    // The input column puts data-input-issue on the row with the issue
    const panel = document.createElement('div')
    panel.id = INPUT_COLUMN_ID
    panel.innerHTML = '<button type="button">Other</button><div data-input-issue=""><p>Efficiency does not go on boots.</p><button type="button">Remove</button></div>'
    document.body.append(panel)
    const { rerender } = render(<ResultView solve={viewOf(outcomeOf('invalid'))} />)
    expect(screen.getByText('入力に直すところが1か所あります。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '直すところへ移動' }))
    expect(within(panel).getByRole('button', { name: 'Remove' })).toHaveFocus()
    panel.remove()
    const trivial: SolveOk = { ...okOf('advancedUnused'), method: 'trivial', plan: { ...okOf('advancedUnused').plan, steps: [], finalRef: { kind: 'input', input: 0 } } }
    rerender(<ResultView solve={viewOf(outcomeOf('advancedUnused', trivial))} />)
    expect(screen.getByText(/1冊に付けたいエンチャントがそろっているので、金床は使いません。/)).toBeInTheDocument()
  })

  it('offers a retry on failure and a reload hint after repeated failures', async () => {
    const failed = { status: 'error', cause: 'worker-crashed', message: 'x', retryable: true } as const
    const outcome: SolveOutcome = { ...(outcomeOf('bootsSevenBooks') as Extract<SolveOutcome, { kind: 'result' }>), result: failed }
    const solve = viewOf(outcome, { failures: 2 })
    render(<ResultView solve={solve} />)
    expect(screen.getByText(/計算できませんでした。入力はそのまま残っています。/)).toBeInTheDocument()
    expect(screen.getByText('何度やってもうまくいかないときは、ページを読み込み直してください。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'もう一度計算する' }))
    expect(solve.retry).toHaveBeenCalled()
  })
})

describe('connected to the solver', () => {
  it('renders the result for the input and shows the result bar while the summary is below the viewport', async () => {
    class FakeObserver {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    act(() => getAppStore().setState({ input: EXAMPLE_INPUT }))
    startSolver(getAppStore(), createPlaceholderBackend({ delayMs: 1 }))
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    rect.mockReturnValue({ top: 5000, bottom: 5600, left: 0, right: 0, width: 0, height: 600, x: 0, y: 5000, toJSON: () => ({}) })
    render(
      <>
        <ResultPanel />
        <ResultBar />
      </>,
    )
    await waitFor(() => expect(document.getElementById('step-7')).not.toBeNull())
    const bar = await screen.findByRole('button', { name: '手順を見る' })
    expect(bar.parentElement).toHaveTextContent('合計 66 最大 16 7手順')
    expect(document.documentElement).toHaveAttribute('data-result-bar')
    expect(document.getElementById(bar.getAttribute('aria-describedby')!)).toHaveTextContent('結果の要約へ移動')
    await userEvent.click(bar)
    expect(document.activeElement).toHaveTextContent('要約')
    vi.unstubAllGlobals()
  })
})

describe('result panel reuse', () => {
  it('keeps step card elements, open breakdowns and focus for a new result of the same plan', async () => {
    const { rerender } = render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    const article = cardOf(1).querySelector('article')
    const toggle = within(cardOf(1)).getByRole('button', { name: '内訳' })
    await userEvent.click(toggle)
    expect(toggle).toHaveFocus()
    // The same plan arrives as a new object, e.g. after changing the input and changing it back
    rerender(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks', { ...okOf('bootsSevenBooks') }))} />)
    expect(cardOf(1).querySelector('article')).toBe(article)
    expect(within(cardOf(1)).getByRole('button', { name: '内訳' })).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveFocus()
  })

  it('shows the error state when rendering fails and recovers with the next result', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const base = getFixture('tooComplex').result
    if (base.status !== 'too-complex') throw new Error('tooComplex')
    // Rendering throws without complexity data
    const broken = { ...base, complexity: undefined } as unknown as SolveResult
    const { rerender } = render(<ResultView solve={viewOf(outcomeOf('tooComplex', broken))} />)
    expect(screen.getByText(/計算できませんでした/)).toBeInTheDocument()
    rerender(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    expect(screen.queryByText(/計算できませんでした/)).toBeNull()
    expect(screen.getByRole('region', { name: '要約' })).toBeInTheDocument()
    error.mockRestore()
  })

  it('shows the new plan in the cards with the same numbers when the result changes', () => {
    const { rerender } = render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    expect(cardOf(1)).toHaveTextContent('金床に「エンチャントのコスト：12レベル」と表示されれば、置き方は合っています。')
    rerender(<ResultView solve={viewOf(outcomeOf('bootsRename'))} />)
    expect(cardOf(1)).toHaveTextContent('この手順で名前を入力してから取り出してください（+1レベル）')
  })
})

describe('result bar for failures', () => {
  it('shows the heading and a "See why" button for a too-complex result below the viewport, and focuses that heading', async () => {
    class FakeObserver {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    act(() => getAppStore().setState({ input: EXAMPLE_INPUT }))
    startSolver(getAppStore(), createPlaceholderBackend({ fixture: 'tooComplex', delayMs: 1 }))
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    rect.mockReturnValue({ top: 5000, bottom: 5600, left: 0, right: 0, width: 0, height: 600, x: 0, y: 5000, toJSON: () => ({}) })
    render(
      <>
        <ResultPanel />
        <ResultBar />
      </>,
    )
    const bar = await screen.findByRole('button', { name: '理由を見る' })
    expect(bar.parentElement).toHaveTextContent('組み合わせが多すぎて計算できません')
    await userEvent.click(bar)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '組み合わせが多すぎて計算できません' }))
    vi.unstubAllGlobals()
  })
})

describe('result column at 880px and up', () => {
  const originalMatchMedia = window.matchMedia
  // A 1200px wide (1440px when wide), 900px tall screen with a mouse
  function twoColumns(wide = false) {
    const widths = wide ? /min-width: (880|600|1024|1360)px/ : /min-width: (880|600|1024)px/
    window.matchMedia = ((query: string) => ({
      matches: widths.test(query) || query.includes('pointer: fine'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('renders rows of number, formula and cost, named after the step and its operands, with checks behind the number', async () => {
    twoColumns()
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    const summary = screen.getByRole('region', { name: '要約' })
    expect(summary).toHaveTextContent('66')
    expect(summary).not.toHaveTextContent('1冊ずつ付けると')
    expect(screen.queryByRole('region', { name: '材料の本を作る' })).toBeNull()
    expect([...document.querySelectorAll('li[id^="step-"]')].map((li) => li.id)).toEqual(['step-1', 'step-2', 'step-3', 'step-4', 'step-5', 'step-6', 'step-7'])
    const row1 = cardOf(1)
    expect(visibleTextOf(row1)).toBe('1ブーツ＋棘の鎧 III＝ブーツ12レベル')
    const costs = [1, 2, 3, 4, 5, 6, 7].map((no) => visibleTextOf(cardOf(no)).match(/^(\d+)\D.*?(\d+)レベル$/)?.slice(1))
    expect(costs).toEqual([
      ['1', '12'],
      ['2', '2'],
      ['3', '16'],
      ['4', '4'],
      ['5', '14'],
      ['6', '3'],
      ['7', '15'],
    ])
    const formula = within(row1).getByRole('group', { name: /^手順1 ブーツに本を付ける:/ })
    expect(plain(formula.getAttribute('aria-label'))).toBe('手順1 ブーツに本を付ける: ブーツ ＋ 棘の鎧 III ＝ ブーツ')
    // Input books are named by their contents, merged books as Book A plus their contents
    expect(visibleTextOf(formula)).toMatch(/ブーツ＋.*棘の鎧 III＝.*ブーツ$/)
    expect(visibleTextOf(within(cardOf(2)).getByRole('group', { name: /^手順2 本Aを作る:/ }))).toMatch(/ソウルスピード III＋.*修繕＝.*本A.*ソウルスピード III、修繕$/)
    expect(visibleTextOf(within(cardOf(3)).getByRole('group', { name: /^手順3 ブーツに本Aを付ける:/ }))).toMatch(/ブーツ＋.*本A.*ソウルスピード III、修繕＝.*ブーツ$/)
    expect(visibleTextOf(within(cardOf(7)).getByRole('group', { name: /^手順7 / }))).toMatch(/＝.*ブーツ（完成）$/)
    for (const no of [1, 2, 3, 4, 5, 6, 7]) {
      const buttons = within(cardOf(no)).getAllByRole('button')
      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([`手順${no}の確認方法と内訳`])
      expect(buttons[0]).toHaveAttribute('aria-expanded', 'false')
      expect(within(cardOf(no)).queryAllByRole('checkbox')).toHaveLength(0)
    }
    expect(screen.queryByRole('button', { name: 'コストが違うとき' })).toBeNull()
    const toggle = within(row1).getByRole('button', { name: '手順1の確認方法と内訳' })
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(row1).toHaveTextContent('金床に「エンチャントのコスト：12レベル」と表示されれば、置き方は合っています。')
    expect(within(row1).getByRole('button', { name: 'コストが違うとき' })).toBeInTheDocument()
    // Pressing elsewhere on the row closes it
    await userEvent.click(formula)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'コストが違うとき' })).toBeNull()
    expect(screen.getByRole('button', { name: '詳細' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('names the formula with ASCII operators in English', () => {
    twoColumns()
    act(() => getAppStore().getState().setLang('en'))
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    const formula = within(cardOf(1)).getByRole('group', { name: /^Step 1 / })
    expect(plain(formula.getAttribute('aria-label'))).toMatch(/: Boots \+ Thorns III = Boots$/)
    expect(formula.getAttribute('aria-label')).not.toMatch(/[＋＝（）]/)
  })

  it.each([
    ['1200px (880 to 1359px)', false],
    ['1440px (1360px and up)', true],
  ])('%s: places details below the step list', (_, wide) => {
    twoColumns(wide)
    act(() => getAppStore().setState({ input: EXAMPLE_INPUT }))
    render(<ResultView solve={viewOf(outcomeOf('bootsSevenBooks'))} />)
    const details = screen.getByRole('button', { name: '詳細' })
    expect(details).toHaveAttribute('aria-expanded', 'false')
    expect(cardOf(7).compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
