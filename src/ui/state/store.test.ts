import { describe, expect, it } from 'vitest'
import { createTranslator } from '../i18n/render.ts'
import { msg } from '../i18n/text.ts'
import { EXAMPLE_INPUT } from './convert.ts'
import { selectRedoLabel, selectUndoLabel, solveInputOf } from './selectors.ts'
import { HISTORY_LIMIT } from './slices/history.ts'
import { memoryStorage, wrapStorage } from './storage.ts'
import { createAppStore } from './store.ts'
import type { InputState } from './types.ts'

const ja = createTranslator({ lang: 'ja', edition: 'java' })

function setup() {
  const raw = memoryStorage()
  const storage = wrapStorage(raw)
  const store = createAppStore({ storage })
  return { store, storage, raw, get: () => store.getState() }
}

const toastText = (state: ReturnType<ReturnType<typeof setup>['get']>) => (state.toast ? ja.text(state.toast.message) : null)

/** Checks that a merged book has no existing enchantments, anvil uses or spares, and that wanted levels exceed existing ones. */
function expectInvariants(input: InputState) {
  if (input.item === 'enchanted_book') {
    expect(input.existing).toEqual({})
    expect(input.anvilUsesOverride).toBeNull()
    expect(input.extraItems).toEqual([])
  }
  for (const [id, level] of Object.entries(input.wanted)) {
    expect(level).toBeGreaterThan((input.existing as Record<string, number>)[id] ?? 0)
  }
}

describe('input history', () => {
  it('records each change and moves through them with undo and redo', () => {
    const { get } = setup()
    get().setItem('boots')
    get().selectWanted('protection')
    expect(get().input.wanted).toEqual({ protection: 4 })
    expect(ja.text(selectUndoLabel(get())!)).toBe('ダメージ軽減を選ぶ')

    expect(get().undo()).toBe(true)
    expect(get().input.wanted).toEqual({})
    expect(ja.text(selectRedoLabel(get())!)).toBe('ダメージ軽減を選ぶ')
    expect(get().redo()).toBe(true)
    expect(get().input.wanted).toEqual({ protection: 4 })
  })

  it('records every input action as one undoable entry', () => {
    const { get } = setup()
    const steps: [string, () => void][] = [
      ['item', () => get().setItem('pickaxe')],
      ['existing', () => get().setExisting({ unbreaking: 3 })],
      ['uses', () => get().setAnvilUsesOverride(3)],
      ['wanted', () => get().selectWanted('efficiency', 5)],
      ['maxAll', () => get().selectAllMax()],
      ['book', () => void get().addOwnedBook({ enchantments: { mending: 1 }, count: 1, anvilUsesOverride: null })],
      ['extra', () => void get().addExtraItem({ enchantments: { efficiency: 3 }, anvilUsesOverride: null })],
      ['rename', () => get().setRename(true)],
    ]
    const snapshots: InputState[] = [get().input]
    for (const [name, run] of steps) {
      run()
      expect(get().input, name).not.toBe(snapshots.at(-1))
      snapshots.push(get().input)
      expectInvariants(get().input)
    }
    for (let i = snapshots.length - 2; i >= 0; i--) {
      expect(get().undo()).toBe(true)
      expect(get().input).toBe(snapshots[i])
    }
  })

  it('clears redo entries on a new change', () => {
    const { get } = setup()
    get().setItem('boots')
    get().undo()
    get().setItem('sword')
    expect(get().redo()).toBe(false)
  })

  it('does not record actions that change nothing', () => {
    const { get } = setup()
    get().setItem('boots')
    get().setItem('boots')
    get().deselectWanted('protection')
    expect(get().history.past).toHaveLength(1)
  })

  it(`keeps up to ${HISTORY_LIMIT} entries`, () => {
    const { get } = setup()
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) get().setRename(i % 2 === 0)
    expect(get().history.past).toHaveLength(HISTORY_LIMIT)
  })

  it('blocks input changes while a shared plan is shown', () => {
    const { get } = setup()
    get().showSharedPlan({ input: EXAMPLE_INPUT, settings: { edition: 'java', levelCap: 39, objective: 'levels', rename: false }, hash: '#v=1' })
    get().setItem('sword')
    expect(get().input.item).toBeNull()
    expect(get().undo()).toBe(false)
  })
})

describe('input adjustments', () => {
  it('replaces the selected enchantment of an incompatible group and restores it with undo', () => {
    const { get } = setup()
    get().setItem('boots')
    get().selectWanted('protection')
    get().selectWanted('fire_protection')
    expect(get().input.wanted).toEqual({ fire_protection: 4 })
    expect(toastText(get())).toBe('ダメージ軽減を外しました')
    get().undo()
    expect(get().input.wanted).toEqual({ protection: 4 })
  })

  it('drops enchantments that do not fit, all spares and the anvil uses override when the item changes', () => {
    const { get } = setup()
    get().setItem('pickaxe')
    get().setExisting({ unbreaking: 3 })
    get().setAnvilUsesOverride(4)
    get().selectWanted('efficiency', 5)
    get().addExtraItem({ enchantments: {}, anvilUsesOverride: null })
    get().addOwnedBook({ enchantments: { efficiency: 5 }, count: 1, anvilUsesOverride: null })
    get().setItem('sword')
    const { input } = get()
    expect(input.wanted).toEqual({})
    expect(input.existing).toEqual({ unbreaking: 3 })
    expect(input.extraItems).toEqual([])
    expect(input.anvilUsesOverride).toBeNull()
    expect(input.ownedBooks).toHaveLength(1)
    expect(toastText(get())).toBe('剣に付かない効率強化を外しました')
  })

  it('drops existing enchantments and spares but keeps wanted ones when switching to an enchanted book', () => {
    const { get } = setup()
    get().setItem('boots')
    get().setExisting({ unbreaking: 2 })
    get().selectWanted('mending')
    get().addExtraItem({ enchantments: {}, anvilUsesOverride: null })
    get().setItem('enchanted_book')
    expect(get().input.existing).toEqual({})
    expect(get().input.extraItems).toEqual([])
    expect(get().input.wanted).toEqual({ mending: 1 })
    expectInvariants(get().input)
  })

  it('drops conflicting wanted enchantments and those at or below a new existing level, with a toast', () => {
    const { get } = setup()
    get().setItem('boots')
    get().selectWanted('depth_strider', 3)
    get().selectWanted('unbreaking', 2)
    get().setExisting({ frost_walker: 2, unbreaking: 3 })
    expect(get().input.wanted).toEqual({})
    expect(toastText(get())).toBe('付いている氷渡りと競合するので、水中歩行を付けたいエンチャントから外しました')
    get().undo()
    expect(get().input.wanted).toEqual({ depth_strider: 3, unbreaking: 2 })
  })

  it('blocks enchantments incompatible with existing ones and removes an entry set at or below the existing level', () => {
    const { get } = setup()
    get().setItem('boots')
    get().setExisting({ frost_walker: 2, unbreaking: 2 })
    get().selectWanted('depth_strider')
    expect(get().input.wanted).toEqual({})
    get().selectWanted('unbreaking', 3)
    expect(get().input.wanted).toEqual({ unbreaking: 3 })
    get().selectWanted('unbreaking', 2)
    expect(get().input.wanted).toEqual({})
  })

  it('keeps the entered anvil uses when the existing enchantments change', () => {
    const { get } = setup()
    get().setItem('boots')
    get().setAnvilUsesOverride(5)
    get().setExisting({ frost_walker: 2 })
    expect(get().input.anvilUsesOverride).toEqual(5)
  })

  it('shows a toast for Set to 0 and Back to auto', () => {
    const { get } = setup()
    get().setItem('boots')
    get().setExisting({ frost_walker: 2 })
    get().setAnvilUsesOverride(0, { toast: true })
    expect(toastText(get())).toBe('ブーツの金床使用回数を0回（入力）にしました')
    get().setAnvilUsesOverride(null, { toast: true })
    expect(toastText(get())).toBe('ブーツの金床使用回数を1回（自動）にしました')
  })

  it('drops enchantments missing from the new edition and owned books left empty', () => {
    const { get } = setup()
    get().setItem('boots')
    get().selectWanted('soul_speed', 3)
    get().addOwnedBook({ enchantments: { soul_speed: 1 }, count: 1, anvilUsesOverride: null })
    get().setEdition('bedrock')
    // Bedrock Edition has Soul Speed too
    expect(get().input.wanted).toEqual({ soul_speed: 3 })
    get().setItem('mace')
    get().selectWanted('breach', 4)
    get().addOwnedBook({ enchantments: { breach: 1 }, count: 1, anvilUsesOverride: null })
    get().setEdition('java')
    expectInvariants(get().input)
  })

  it('treats a group with an existing enchantment as already chosen when selecting all at max', () => {
    const { get } = setup()
    get().setItem('boots')
    get().setExisting({ frost_walker: 2 })
    get().selectAllMax()
    const { wanted } = get().input
    expect(wanted.depth_strider).toBeUndefined()
    expect(wanted.frost_walker).toBeUndefined()
    expect(wanted.protection).toBe(4)
    expectInvariants(get().input)
  })

  it('merges books with the same enchantments and anvil uses into one row', () => {
    const { get } = setup()
    get().setItem('boots')
    get().addOwnedBook({ enchantments: { mending: 1 }, count: 1, anvilUsesOverride: null })
    get().addOwnedBook({ enchantments: { mending: 1 }, count: 1, anvilUsesOverride: null })
    expect(get().input.ownedBooks).toHaveLength(1)
    expect(get().input.ownedBooks[0].count).toBe(2)
  })

  it('shows a toast when a book is deleted and restores it with undo', () => {
    const { get } = setup()
    get().setItem('boots')
    const uid = get().addOwnedBook({ enchantments: { mending: 1 }, count: 1, anvilUsesOverride: null })
    get().removeOwnedBook(uid, { label: msg('label.book', { list: '修繕' }) })
    expect(get().input.ownedBooks).toEqual([])
    expect(toastText(get())).toBe('本（修繕）を削除しました')
    get().undo()
    expect(get().input.ownedBooks).toHaveLength(1)
  })

  it('does not add spares to an item without durability', () => {
    const { get } = setup()
    get().setItem('enchanted_book')
    get().addExtraItem({ enchantments: {}, anvilUsesOverride: null })
    expect(get().input.extraItems).toEqual([])
  })

  it('loads the example input and empties it again with undo', () => {
    const { get } = setup()
    get().loadExample()
    expect(get().input.item).toBe('boots')
    expect(Object.keys(get().input.wanted)).toHaveLength(7)
    get().undo()
    expect(get().input.item).toBeNull()
  })
})

describe('storage actions in settings', () => {
  it('backs up before clearing all input, undoes the clear, and restores the backup', () => {
    const { get } = setup()
    get().loadExample()
    get().clearAllInput()
    expect(get().input.item).toBeNull()
    expect(ja.text(get().toast!.message)).toBe('入力をすべて消しました')
    get().undo()
    expect(get().input.item).toBe('boots')

    get().clearAllInput()
    get().restoreBackup()
    expect(get().input.item).toBe('boots')
    expect(ja.text(get().toast!.message)).toBe('ひとつ前の入力に戻しました')
  })

  it('shows the storage banner only once when storage cannot be written', () => {
    const storage = wrapStorage(memoryStorage({}, { failWrites: true }))
    const store = createAppStore({ storage })
    store.getState().saveBackup()
    expect(store.getState().system.banners.storageUnavailable).toBe(true)
    store.getState().dismissBanner('storageUnavailable')
    store.getState().saveBackup()
    expect(store.getState().system.banners.storageUnavailable).toBe(false)
    expect(store.getState().system.storageAvailable).toBe(false)
  })
})

describe('game mode and objective', () => {
  it('switches with a toast and switches back with undo', () => {
    const { get } = setup()
    get().setLevelCap(null, { toast: true })
    expect(ja.text(get().toast!.message)).toBe('クリエイティブ（上限なし）に切り替えました')
    get().setObjective('finalPwp', { toast: true })
    expect(ja.text(get().toast!.message)).toBe('「完成品の累積作業費用優先」に切り替えました')
    get().undo()
    get().undo()
    expect(get().session).toMatchObject({ levelCap: 39, objective: 'levels' })
  })
})

describe('toasts', () => {
  it('replaces the previous toast and puts Change before Undo', () => {
    const { get } = setup()
    const first = get().showToast(msg('toast.copied'))
    get().showToast(msg('toast.example'), { actions: [{ label: msg('toast.change'), run: () => {} }], undo: true })
    expect(ja.text(get().toast!.message)).toBe('例を入れました')
    expect(get().toast!.actions.map((a) => ja.text(a.label))).toEqual(['変える', '元に戻す'])
    get().dismissToast(first)
    expect(get().toast).not.toBeNull()
    get().dismissToast()
    expect(get().toast).toBeNull()
  })
})

describe('solver input', () => {
  it('returns the reason when there is nothing to solve', () => {
    const { get } = setup()
    expect(solveInputOf(get())).toMatchObject({ kind: 'empty', reason: 'noItem' })
    get().setItem('boots')
    expect(solveInputOf(get())).toMatchObject({ kind: 'empty', reason: 'noEnchantments' })
    get().setRename(true)
    expect(solveInputOf(get())).toMatchObject({ kind: 'empty', reason: 'noEnchantments' })
  })

  it('gives the same plan ID regardless of selection order and includes the BuiltProblem and solved input', () => {
    const a = setup()
    a.get().setItem('boots')
    a.get().selectWanted('mending')
    a.get().selectWanted('protection')
    const b = setup()
    b.get().setItem('boots')
    b.get().selectWanted('protection')
    b.get().selectWanted('mending')
    const x = solveInputOf(a.get())
    const y = solveInputOf(b.get())
    if (x.kind !== 'ready' || y.kind !== 'ready') throw new Error('not ready')
    expect(x.planId).toBe(y.planId)
    expect(x.built.supplements).toHaveLength(2)
    expect(x.input).toBe(a.get().input)
    expect(x.fallback).toBeNull()
  })

  it('changes the plan ID when the settings change', () => {
    const { get } = setup()
    get().loadExample()
    const before = solveInputOf(get())
    get().setLevelCap(null)
    const after = solveInputOf(get())
    if (before.kind !== 'ready' || after.kind !== 'ready') throw new Error('not ready')
    expect(before.planId).not.toBe(after.planId)
  })

  it('builds the fallback problem when owned items reach a wanted enchantment', () => {
    const { get } = setup()
    get().setItem('boots')
    get().selectWanted('mending')
    get().addOwnedBook({ enchantments: { mending: 1 }, count: 1, anvilUsesOverride: 5 })
    const input = solveInputOf(get())
    if (input.kind !== 'ready') throw new Error('not ready')
    expect(input.fallback?.fallback).toEqual(['mending'])
  })

  it('solves the shared plan while it is shown', () => {
    const { get } = setup()
    get().showSharedPlan({ input: EXAMPLE_INPUT, settings: { edition: 'java', levelCap: 39, objective: 'levels', rename: false }, hash: '#v=1' })
    expect(solveInputOf(get())).toMatchObject({ kind: 'ready', problem: { mode: 'simple', item: 'boots' } })
  })
})
