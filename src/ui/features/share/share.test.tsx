// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SolveOk } from '../../../engine/index.ts'
import { getFixture } from '../../dev/fixtures.ts'
import { createTranslator } from '../../i18n/render.ts'
import { msg } from '../../i18n/text.ts'
import { displayPlanFromResult } from '../../plan/displayPlan.ts'
import { createPlaceholderBackend } from '../../solver/placeholderBackend.ts'
import { startSolver, stopSolver } from '../../solver/useSolveResult.ts'
import { EXAMPLE_INPUT } from '../../state/convert.ts'
import { DEFAULT_INPUT, type InputState } from '../../state/types.ts'
import { memoryStorage, wrapStorage } from '../../state/storage.ts'
import { createAppStore, getAppStore, setAppStore, type InitialState } from '../../state/store.ts'
import { encodeShareHashPlain, readShareHash } from '../../url/shareHash.ts'
import { formatPlanText } from './formatPlanText.ts'
import { formatPlanAsText, initShare, ShareActions, ShareRoot } from './index.tsx'

const ja = createTranslator({ lang: 'ja', edition: 'java' })
const ORIGIN = `${window.location.origin}${window.location.pathname}`
const BOOTS_FIXTURE = getFixture('bootsSevenBooks')
const PICKAXE: InputState = { ...DEFAULT_INPUT, item: 'pickaxe', wanted: { efficiency: 5 } }
const BOOTS_LINK = { input: EXAMPLE_INPUT, settings: BOOTS_FIXTURE.settings }

const state = () => getAppStore().getState()

function setupStore(initial: InitialState = { input: EXAMPLE_INPUT }) {
  setAppStore(createAppStore({ storage: wrapStorage(memoryStorage()) }, initial))
  startSolver(getAppStore(), createPlaceholderBackend({ delayMs: 0 }))
}

function renderShare() {
  return render(
    <>
      <ShareActions />
      <ShareRoot />
    </>,
  )
}

// Copy as text appears once the solve finishes
const waitForPlan = () => screen.findByRole('button', { name: 'テキストでコピー' }, { timeout: 2000 })

function stubNavigator<K extends 'clipboard' | 'share' | 'canShare'>(key: K, value: unknown) {
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true })
}

let user: UserEvent
beforeEach(() => {
  user = userEvent.setup()
  stubNavigator('share', undefined)
  stubNavigator('canShare', undefined)
})

afterEach(() => {
  cleanup()
  stopSolver()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('ShareActions', () => {
  it('groups Share and Copy as text, with only Share until the result is ok, and offers no Print', async () => {
    setupStore()
    renderShare()
    const group = screen.getByRole('group', { name: '共有' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['共有'])
    await waitForPlan()
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['共有', 'テキストでコピー'])
  })

  it('disables Share while no item is chosen', () => {
    setupStore({})
    renderShare()
    expect(screen.getByRole('button', { name: '共有' })).toBeDisabled()
  })

  it('passes the title, a one-line summary and the link to the Web Share API without opening the share sheet', async () => {
    setupStore()
    const share = vi.fn(async () => {})
    stubNavigator('share', share)
    stubNavigator('canShare', () => true)
    renderShare()
    await waitForPlan()
    await user.click(screen.getByRole('button', { name: '共有' }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const data = share.mock.calls[0] as unknown as [ShareData]
    expect(data[0].title).toBe('ブーツのエンチャントの順番')
    expect(data[0].text).toBe('合計66レベル、1回の最大16レベル、7手順（Java版）')
    expect(data[0].url?.startsWith(`${ORIGIN}#v=1&e=java&o=levels&cap=39&rn=0&d=`)).toBe(true)
    const read = readShareHash(new URL(data[0].url!).hash)
    expect(read).toMatchObject({ kind: 'ok', link: { settings: BOOTS_FIXTURE.settings } })
    expect(read.kind === 'ok' && read.link.input.item).toBe('boots')
    expect(read.kind === 'ok' && read.link.input.wanted).toEqual(EXAMPLE_INPUT.wanted)
    expect(state().shareSheet.open).toBe(false)
  })

  it('does nothing when the OS share sheet is dismissed (AbortError) and opens the share sheet on any other failure', async () => {
    setupStore()
    stubNavigator('canShare', () => true)
    stubNavigator('share', async () => Promise.reject(new DOMException('closed', 'AbortError')))
    renderShare()
    await user.click(screen.getByRole('button', { name: '共有' }))
    await act(() => new Promise((r) => setTimeout(r, 20)))
    expect(state().shareSheet.open).toBe(false)
    stubNavigator('share', async () => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    await user.click(screen.getByRole('button', { name: '共有' }))
    await waitFor(() => expect(state().shareSheet.open).toBe(true))
  })

  it('copies the plan text and shows the copied toast', async () => {
    setupStore()
    const writeText = vi.fn(async () => {})
    stubNavigator('clipboard', { writeText })
    renderShare()
    await user.click(await waitForPlan())
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = (writeText.mock.calls[0] as unknown as [string])[0]
    const plan = displayPlanFromResult(BOOTS_FIXTURE.result as SolveOk, BOOTS_FIXTURE.problem, BOOTS_FIXTURE.settings)
    const url = text.split('\n').at(-1)!.replace('この手順を開く: ', '')
    expect(text).toBe(formatPlanText(plan, ja, { settings: BOOTS_FIXTURE.settings, url }))
    expect(url.startsWith(`${ORIGIN}#v=1&e=java`)).toBe(true)
    expect(state().toast?.message).toEqual(msg('toast.copied'))
  })

  it('shows the text selected in the share sheet when the clipboard write fails', async () => {
    setupStore()
    stubNavigator('clipboard', { writeText: () => Promise.reject(new Error('denied')) })
    renderShare()
    await user.click(await waitForPlan())
    const dialog = await screen.findByRole('dialog', { name: 'テキストでコピー' })
    const area = within(dialog).getByRole('textbox', { name: 'コピーする文字' }) as HTMLTextAreaElement
    expect(area.value.split('\n')[0]).toBe('ブーツ（Java版 26.3、サバイバル、合計レベル優先）')
    expect(area).toHaveAttribute('readonly')
    expect(within(dialog).getByText('選択した文字をコピーしてください')).toBeInTheDocument()
    await waitFor(() => expect(area).toHaveFocus())
    expect([area.selectionStart, area.selectionEnd]).toEqual([0, area.value.length])
  })
})

describe('ShareSheet', () => {
  async function openSheet() {
    setupStore()
    renderShare()
    await waitForPlan()
    await user.click(screen.getByRole('button', { name: '共有' }))
    return screen.findByRole('dialog', { name: '共有' })
  }

  it('opens without the Web Share API and shows a read-only link field that selects all on focus, plus a note', async () => {
    const dialog = await openSheet()
    const input = within(dialog).getByRole('textbox', { name: 'この手順のリンク' }) as HTMLInputElement
    await waitFor(() => expect(input.value.startsWith(`${ORIGIN}#v=1&e=java`)).toBe(true))
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAccessibleDescription(
      'リンクには、エディション、計算の条件、入力が入ります。言語とテーマは入りません。',
    )
    await waitFor(() => expect(input).toHaveFocus())
    await waitFor(() => expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]))
    expect(within(dialog).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      '閉じる',
      'リンクをコピー',
      'テキストでコピー',
    ])
  })

  it('copies the link, shows "Copied" and announces that the link was copied', async () => {
    const dialog = await openSheet()
    const writeText = vi.fn(async () => {})
    stubNavigator('clipboard', { writeText })
    const input = within(dialog).getByRole('textbox', { name: 'この手順のリンク' }) as HTMLInputElement
    await waitFor(() => expect(input.value).not.toBe(''))
    await user.click(within(dialog).getByRole('button', { name: 'リンクをコピー' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(input.value))
    expect(within(dialog).getByText('コピーしました')).toBeInTheDocument()
    expect(state().ui.assist.text).toEqual(msg('toast.linkCopied'))
  })

  it('selects the field and asks for a manual copy when the clipboard is unavailable', async () => {
    const dialog = await openSheet()
    stubNavigator('clipboard', undefined)
    const input = within(dialog).getByRole('textbox', { name: 'この手順のリンク' }) as HTMLInputElement
    await waitFor(() => expect(input.value).not.toBe(''))
    await user.click(within(dialog).getByRole('button', { name: 'リンクをコピー' }))
    expect(await within(dialog).findByText('選択した文字をコピーしてください')).toBeInTheDocument()
    expect(input).toHaveFocus()
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length])
    expect(state().ui.assist.text).toEqual(msg('share.copyManual'))
  })

  it('closes on Escape and returns focus to the Share button', async () => {
    await openSheet()
    await user.keyboard('{Escape}')
    expect(state().shareSheet.open).toBe(false)
    await waitFor(() => expect(screen.getByRole('button', { name: '共有' })).toHaveFocus())
  })
})

describe('while a shared plan is shown', () => {
  it('shares the hash of the opened link unchanged', async () => {
    const hash = encodeShareHashPlain(BOOTS_LINK)
    setupStore({ input: PICKAXE })
    act(() => state().showSharedPlan({ input: EXAMPLE_INPUT, settings: BOOTS_FIXTURE.settings, hash }))
    renderShare()
    await waitForPlan()
    await user.click(screen.getByRole('button', { name: '共有' }))
    const dialog = await screen.findByRole('dialog', { name: '共有' })
    expect(within(dialog).getByRole('textbox', { name: 'この手順のリンク' })).toHaveValue(`${ORIGIN}${hash}`)
  })
})

describe('formatPlanAsText with two arguments', () => {
  it('uses the settings of the shown plan and the share link in the address bar', () => {
    const hash = encodeShareHashPlain(BOOTS_LINK)
    window.history.replaceState(null, '', `/${hash}`)
    setupStore()
    const plan = displayPlanFromResult(BOOTS_FIXTURE.result as SolveOk, BOOTS_FIXTURE.problem, BOOTS_FIXTURE.settings)
    const lines = formatPlanAsText(plan, ja).split('\n')
    expect(lines[0]).toBe('ブーツ（Java版 26.3、サバイバル、合計レベル優先）')
    expect(lines.at(-1)).toBe(`この手順を開く: ${ORIGIN}${hash}`)
  })
})

describe('initShare', () => {
  it('shows the shared plan from the address bar hash when it differs from the user input, and stops reading once stopped', () => {
    const hash = encodeShareHashPlain(BOOTS_LINK)
    window.history.replaceState(null, '', `/${hash}`)
    const store = createAppStore({ storage: wrapStorage(memoryStorage()) }, { input: PICKAXE })
    const stop = initShare(store)
    expect(store.getState().share.active).toBe(true)
    expect(store.getState().share.plan?.hash).toBe(hash)
    stop()
    window.history.replaceState(null, '', '/#v=99')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(store.getState().system.banners.linkUnreadable).toBe(false)
  })

  it('rereads a pasted link on hashchange', () => {
    const store = createAppStore({ storage: wrapStorage(memoryStorage()) }, { input: PICKAXE })
    const stop = initShare(store)
    window.history.replaceState(null, '', '/#v=99&e=java&d=j.xxx')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(store.getState().system.banners.linkUnreadable).toBe(true)
    stop()
  })
})
