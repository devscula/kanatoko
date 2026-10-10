// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SolveOk } from '../../../engine/index.ts'
import { getFixture } from '../../dev/fixtures.ts'
import { displayPlanFromResult } from '../../plan/displayPlan.ts'
import { stopSolver } from '../../solver/useSolveResult.ts'
import { memoryStorage, wrapStorage } from '../../state/storage.ts'
import { createAppStore, getAppStore, setAppStore } from '../../state/store.ts'
import type { OwnedBook } from '../../state/types.ts'
import { INPUT_IDS } from './ids.ts'
import { InputPanel } from './InputPanel.tsx'
import { OwnedInventory } from './OwnedInventory.tsx'

const state = () => getAppStore().getState()

beforeEach(() => {
  setAppStore(createAppStore({ storage: wrapStorage(memoryStorage()) }))
})

afterEach(() => {
  stopSolver()
})

describe('first screen', () => {
  it('shows the item list and the example button, and focuses the item row once an item is picked', () => {
    render(<InputPanel />)
    expect(screen.getByRole('heading', { name: '何にエンチャントしますか？' })).toBeInTheDocument()
    expect(screen.getByText('アイテムを選び、付けたいエンチャントを選ぶと、金床での手順と必要なレベルが出ます。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ブーツ' }))
    expect(state().input.item).toBe('boots')
    expect(document.activeElement?.id).toBe(INPUT_IDS.itemCard)
  })

  it('loads the shared example from the example button', () => {
    render(<InputPanel />)
    fireEvent.click(screen.getByRole('button', { name: /例を見る/ }))
    expect(Object.keys(state().input.wanted)).toHaveLength(7)
  })
})

describe('left column', () => {
  it('shows a new item as new, with no existing enchantments and 0 anvil uses', () => {
    act(() => state().setItem('boots'))
    render(<InputPanel />)
    expect(screen.getByText('新品')).toBeInTheDocument()
    expect(screen.getByText('すでに付いているエンチャント')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '追加' })).toBeInTheDocument()
    expect(screen.getByText('0回（新品）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '金床使用回数を変更（今は0回（新品））' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('0個')).toBeInTheDocument()
  })

  it('gives boots with Frost Walker II 1 automatic use and lets the uses field switch between an entered 0 and auto', () => {
    act(() => {
      state().setItem('boots')
      state().setExisting({ frost_walker: 2 })
    })
    render(<InputPanel />)
    expect(screen.getByText('1回（自動）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '金床使用回数を変更（今は1回（自動））' }))
    expect(screen.getByText('自動: 氷渡り II の本を1冊付けたときの回数です。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '0回にする' }))
    expect(state().input.anvilUsesOverride).toEqual(0)
    expect(screen.getByText('0回（入力）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '自動に戻す（1回）' }))
    expect(state().input.anvilUsesOverride).toBeNull()
    act(() => {
      state().undo()
    })
    expect(state().input.anvilUsesOverride).toEqual(0)
  })

  it('marks enchantments already on the item and blocks rows that conflict with them', () => {
    act(() => {
      state().setItem('boots')
      state().setExisting({ frost_walker: 2 })
    })
    render(<InputPanel />)
    expect(screen.getByText('付与済み（II）')).toBeInTheDocument()
    expect(screen.getByText('付いている氷渡りと競合するので、付けられません')).toBeInTheDocument()
    const depth = document.getElementById(INPUT_IDS.check('depth_strider'))!
    expect(depth).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(depth)
    expect(state().input.wanted).toEqual({})
  })

  it('notes on the second line whether owned books reach the wanted level', () => {
    act(() => {
      state().setItem('boots')
      state().selectWanted('unbreaking', 3)
      state().selectWanted('protection', 4)
      state().addOwnedBook({ enchantments: { unbreaking: 2 }, count: 2, anvilUsesOverride: null })
      state().addOwnedBook({ enchantments: { protection: 3 }, count: 1, anvilUsesOverride: null })
    })
    render(<InputPanel />)
    expect(screen.getByText('手持ちの本から')).toBeInTheDocument()
    expect(screen.getByText('手持ちでは III まで。IV の本を用意します')).toBeInTheDocument()
  })

  it('summarizes owned books when closed and, when open, shows the rows and add buttons with a uses tag only for non-zero uses', () => {
    act(() => {
      state().setItem('boots')
      state().addOwnedBook({ enchantments: { mending: 1 }, count: 1, anvilUsesOverride: null })
      state().addOwnedBook({ enchantments: { protection: 3, feather_falling: 2 }, count: 1, anvilUsesOverride: null })
    })
    render(<InputPanel />)
    expect(screen.getByText('本2冊')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /手持ちの本・予備のブーツを開く/ }))
    const rows = document.querySelectorAll(`[id^="input-owned-"] li, li[id^="input-owned-"]`)
    expect(rows).toHaveLength(2)
    expect(within(rows[0] as HTMLElement).queryByText(/回$/)).toBeNull()
    expect(within(rows[1] as HTMLElement).getByText('1回')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本を追加' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '同じ種類のブーツを追加' })).toBeInTheDocument()
  })

  it('lists wanted enchantments first in the add-book dialog and adds the book with its count and anvil uses', () => {
    act(() => {
      state().setItem('boots')
      state().selectWanted('unbreaking', 3)
      state().setDisclosure(INPUT_IDS.owned, true)
    })
    render(<InputPanel />)
    fireEvent.click(screen.getByRole('button', { name: '本を追加' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('付けたいエンチャント（1）')).toBeInTheDocument()
    const submit = within(dialog).getByRole('button', { name: /この本を追加する/ })
    expect(submit).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '耐久力' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '冊数を増やす' }))
    expect(within(dialog).getByText('0回（自動）')).toBeInTheDocument()
    fireEvent.click(submit)
    expect(state().input.ownedBooks).toMatchObject([{ enchantments: { unbreaking: 3 }, count: 2, anvilUsesOverride: null }])
  })

  it('changes the input from the existing enchantments dialog, with undo', () => {
    act(() => state().setItem('pickaxe'))
    render(<InputPanel />)
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '耐久力' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'この内容にする' }))
    expect(state().input.existing).toEqual({ unbreaking: 3 })
    expect(screen.getByText('耐久力 III')).toBeInTheDocument()
    act(() => {
      state().undo()
    })
    expect(state().input.existing).toEqual({})
  })

  it('shows a filter field instead of the existing enchantments and anvil uses rows when merging books', () => {
    act(() => state().setItem('enchanted_book'))
    render(<InputPanel />)
    expect(screen.queryByText('すでに付いているエンチャント')).toBeNull()
    expect(screen.queryByText(/金床使用回数/)).toBeNull()
    expect(screen.getByRole('searchbox', { name: /絞り込む/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '同じ種類のエンチャントの本を追加' })).toBeNull()
  })

  it('shows the input of a shared plan and ignores changes to it', () => {
    act(() =>
      state().showSharedPlan({
        input: { item: 'boots', existing: {}, anvilUsesOverride: null, wanted: { mending: 1 }, ownedBooks: [], extraItems: [], rename: false },
        settings: { edition: 'java', levelCap: 39, objective: 'levels', rename: false },
        hash: '#v=1',
      }),
    )
    render(<InputPanel />)
    expect(screen.getByText('1個')).toBeInTheDocument()
    fireEvent.click(document.getElementById(INPUT_IDS.check('mending'))!)
    expect(state().input.item).toBeNull()
  })
})

describe('owned books', () => {
  const original = window.matchMedia

  afterEach(() => {
    window.matchMedia = original
  })

  it.each([
    ['390px', 390],
    ['1440px', 1440],
  ])('shows on the row of an unused owned book why it is not used (%s)', (_, width) => {
    window.matchMedia = ((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query)
      return {
        matches: min !== null && width >= Number(min[1]),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }
    }) as unknown as typeof window.matchMedia
    const fixture = getFixture('advancedUnused')
    const plan = displayPlanFromResult(fixture.result as SolveOk, fixture.problem, fixture.settings)
    const books: OwnedBook[] = [{ efficiency: 4 }, { mending: 1 }, { fortune: 3 }, { silk_touch: 1 }, { unbreaking: 2 }].map((enchantments, i) => ({
      uid: `b${i}`,
      enchantments,
      count: 1,
      anvilUsesOverride: null,
    }))
    act(() => state().setDisclosure(INPUT_IDS.owned, true))
    const none = () => {}
    render(
      <OwnedInventory
        edition="java"
        item="pickaxe"
        existing={{ efficiency: 4, unbreaking: 3 }}
        books={books}
        extras={[]}
        plan={plan}
        capacity={null}
        readOnly={false}
        redirect={none}
        onAddBook={none}
        onAddExtra={none}
        onEditBook={none}
        onEditExtra={none}
      />,
    )
    const silk = document.getElementById(INPUT_IDS.ownedRow('b3'))!
    expect(silk).toHaveTextContent('使わない: シルクタッチは、付けたい幸運と同時に付けられない')
    expect(document.getElementById(INPUT_IDS.ownedRow('b4'))).toHaveTextContent('使わない: ツルハシにもう耐久力 III がある')
  })
})
