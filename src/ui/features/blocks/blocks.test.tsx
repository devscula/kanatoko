// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTranslator } from '../../i18n/render.ts'
import { stopSolver } from '../../solver/useSolveResult.ts'
import { memoryStorage, wrapStorage } from '../../state/storage.ts'
import { createAppStore, getAppStore, setAppStore } from '../../state/store.ts'
import { addBooks, addExtra, chooseItem, clearExisting, clearMaterials, setExisting } from './actions.ts'
import { BlockPanel } from './BlockPanel.tsx'

const state = () => getAppStore().getState()
const ja = createTranslator({ lang: 'ja', edition: 'java' })
const toastText = () => {
  const toast = state().toast
  return toast === null ? null : ja.text(toast.message)
}

function loadHelmet({ extra = true }: { readonly extra?: boolean } = {}) {
  act(() => {
    chooseItem('helmet')
    setExisting({ protection: 4, unbreaking: 3 })
    addBooks([{ mending: 1 }, { respiration: 3 }])
    if (extra) addExtra({ aqua_affinity: 1 })
  })
}

beforeEach(() => {
  setAppStore(createAppStore({ storage: wrapStorage(memoryStorage()) }))
})

afterEach(() => {
  stopSolver()
})

describe('removing all enchantments already on the item', () => {
  it('removes only those enchantments, keeps the books and spares, and undoes from the toast', () => {
    loadHelmet()
    const before = state().input
    act(() => clearExisting())
    expect(state().input.existing).toEqual({})
    expect(state().input.ownedBooks).toBe(before.ownedBooks)
    expect(state().input.extraItems).toBe(before.extraItems)
    expect(toastText()).toBe('すでに付いているエンチャントをすべて外しました')
    act(() => {
      state().undo()
    })
    expect(state().input.existing).toEqual({ protection: 4, unbreaking: 3 })
  })

  it('adds no history entry or toast when there is nothing to remove', () => {
    act(() => chooseItem('helmet'))
    const before = state().input
    act(() => clearExisting())
    expect(state().input).toBe(before)
    expect(state().toast).toBeNull()
  })

  it('shows the button only when the item has enchantments and moves focus to the add button when pressed', async () => {
    loadHelmet()
    render(<BlockPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'すでに付いているエンチャントをすべて外す' }))
    expect(state().input.existing).toEqual({})
    expect(screen.queryByRole('button', { name: 'すでに付いているエンチャントをすべて外す' })).toBeNull()
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    expect(screen.getByRole('button', { name: '付与済みのエンチャントを設定' })).toHaveFocus()
  })
})

describe('removing all books and spares', () => {
  it('keeps the item and its enchantments, empties the wanted enchantments, and undoes', () => {
    loadHelmet()
    const before = state().input
    expect(Object.keys(before.wanted).sort()).toEqual(['aqua_affinity', 'mending', 'respiration'])
    act(() => clearMaterials())
    expect(state().input.ownedBooks).toEqual([])
    expect(state().input.extraItems).toEqual([])
    expect(state().input.wanted).toEqual({})
    expect(state().input.item).toBe('helmet')
    expect(state().input.existing).toEqual({ protection: 4, unbreaking: 3 })
    expect(toastText()).toBe('並べた本とヘルメットをすべて外しました')
    act(() => {
      state().undo()
    })
    expect(state().input.ownedBooks).toEqual(before.ownedBooks)
    expect(state().input.extraItems).toEqual(before.extraItems)
    expect(state().input.wanted).toEqual(before.wanted)
  })

  it('labels the button for books only when there are no spares', () => {
    loadHelmet({ extra: false })
    render(<BlockPanel />)
    expect(screen.queryByRole('button', { name: '並べた本とヘルメットをすべて外す' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '並べた本をすべて外す' }))
    expect(state().input.ownedBooks).toEqual([])
    expect(toastText()).toBe('並べた本をすべて外しました')
  })

  it('shows the button only when there are books or spares and moves focus to the add book button when pressed', async () => {
    loadHelmet()
    render(<BlockPanel />)
    fireEvent.click(screen.getByRole('button', { name: '並べた本とヘルメットをすべて外す' }))
    expect(state().input.ownedBooks).toEqual([])
    expect(state().input.extraItems).toEqual([])
    expect(screen.queryByRole('button', { name: '並べた本とヘルメットをすべて外す' })).toBeNull()
    expect(screen.queryByRole('button', { name: '並べた本をすべて外す' })).toBeNull()
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    expect(screen.getByRole('button', { name: '本を追加' })).toHaveFocus()
  })
})

describe('separators', () => {
  const JAPANESE_PUNCTUATION = /[、。・（）]/

  it('uses English punctuation in book labels and tooltips when the language is English', () => {
    act(() => {
      state().setLang('en')
      chooseItem('helmet')
      addBooks([{ mending: 1, sharpness: 5 }])
    })
    render(<BlockPanel />)
    const book = screen.getByRole('button', { name: /^Enchanted book: / })
    const label = book.getAttribute('aria-label') ?? ''
    expect(label).toMatch(/^Enchanted book: Sharpness\sV, Mending\. Sharpness: /)
    expect(book.getAttribute('data-tip')).toMatch(/^Sharpness: /)
    expect(book.textContent).toMatch(/Sharpness\sV · Mending/)
    expect(screen.getByRole('button', { name: 'Pick enchantments and add books' }).getAttribute('data-tip')).toBe(
      'Pick enchantments and add books (One book per enchantment you pick)',
    )
    for (const text of [label, book.getAttribute('data-tip') ?? '', book.textContent ?? '']) expect(text).not.toMatch(JAPANESE_PUNCTUATION)
  })

  it('keeps Japanese punctuation in Japanese', () => {
    act(() => {
      chooseItem('helmet')
      addBooks([{ mending: 1, sharpness: 5 }])
    })
    render(<BlockPanel />)
    const book = screen.getByRole('button', { name: /^エンチャントの本: / })
    expect(book.getAttribute('aria-label')).toMatch(/^エンチャントの本: ダメージ増加\sV、修繕。ダメージ増加: /)
    expect(book.textContent).toMatch(/ダメージ増加\sV・修繕/)
  })
})
