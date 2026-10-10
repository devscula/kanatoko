// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../../App.tsx'
import { stopSolver } from '../../solver/useSolveResult.ts'
import { memoryStorage, wrapStorage } from '../../state/storage.ts'
import { createAppStore, getAppStore, setAppStore } from '../../state/store.ts'
import { DEFAULT_PREFS } from '../../state/types.ts'
import { INPUT_COLUMN_ID } from './inputColumn.ts'
import { MESSAGES } from '../../i18n/messages/index.ts'
import { BOOK_IMAGE_PACK } from '../../icons/bookImageTable.ts'
import { readBackup, STORAGE_KEYS } from '../../state/persistIo.ts'
import { EXAMPLE_INPUT } from '../../state/convert.ts'
import { DEFAULT_INPUT, type InputState } from '../../state/types.ts'
import { AppErrorBoundary } from './AppErrorBoundary.tsx'
import { AppHeader } from './AppHeader.tsx'
import { BannerArea } from './BannerArea.tsx'
import { applyPrefsToDocument } from './documentPrefs.ts'
import { PROJECT } from './projectInfo.ts'
import { SettingsSheet } from './SettingsSheet.tsx'
import { handleGlobalKeyDown } from './shortcuts.ts'

const originalMatchMedia = window.matchMedia

function useWideScreen() {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('min-width'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

beforeEach(() => {
  setAppStore(createAppStore({ storage: wrapStorage(memoryStorage()) }))
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
  stopSolver()
})

const state = () => getAppStore().getState()

describe('AppHeader', () => {
  it('shows the app name as h1, a labeled edition select and a settings button on narrow screens', async () => {
    render(<AppHeader />)
    expect(screen.getByRole('heading', { level: 1, name: 'Kanatoko' })).toBeInTheDocument()
    const select = screen.getByRole('combobox', { name: 'エディション' })
    await userEvent.selectOptions(select, 'bedrock')
    expect(state().session.edition).toBe('bedrock')
    await userEvent.click(screen.getByRole('button', { name: '設定' }))
    expect(state().ui.settingsOpen).toBe(true)
  })

  it('uses the same app name in Japanese and English', () => {
    expect(MESSAGES.ja['app.name']).toBe('Kanatoko')
    expect(MESSAGES.en['app.name']).toBe('Kanatoko')
    render(<AppHeader />)
    expect(screen.getByRole('heading', { level: 1, name: 'Kanatoko' })).toBeInTheDocument()
    act(() => state().setLang('en'))
    expect(screen.getByRole('heading', { level: 1, name: 'Kanatoko' })).toBeInTheDocument()
  })

  it('shows edition and language switches and names the action on undo and redo on wide screens', async () => {
    useWideScreen()
    render(<AppHeader />)
    const edition = screen.getByRole('radiogroup', { name: 'エディション' })
    await userEvent.click(within(edition).getByRole('radio', { name: '統合版' }))
    expect(state().session.edition).toBe('bedrock')
    expect(screen.getByRole('button', { name: '元に戻す: エディションを統合版にする' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: '元に戻す: エディションを統合版にする' }))
    expect(state().session.edition).toBe('java')
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '言語' })).getByRole('radio', { name: 'English' }))
    expect(state().prefs.lang).toBe('en')
  })
})

describe('pressing a read-only input', () => {
  const LOCKED = '共有された手順を表示している間は変えられません。'

  it('shows the locked notice as visible text in the banner, not only to screen readers, until the banner goes', async () => {
    act(() =>
      state().showSharedPlan({ input: { ...DEFAULT_INPUT, item: 'boots', wanted: { mending: 1 } }, settings: { edition: 'java', levelCap: 39, objective: 'levels', rename: false }, hash: '#v=1' }),
    )
    render(<App />)
    const banner = screen.getByRole('region', { name: '共有された手順' })
    expect(banner).not.toHaveTextContent(LOCKED)
    const checkbox = screen.getAllByRole('checkbox')[0] as HTMLInputElement
    expect(checkbox).toHaveAttribute('aria-disabled', 'true')
    const checked = checkbox.checked
    const before = state().input
    await userEvent.click(checkbox)
    expect(checkbox.checked).toBe(checked)
    expect(state().input).toBe(before)
    const note = within(banner).getByText(LOCKED)
    // Visible text: not visually hidden and not inside a live region
    expect(note.closest('.visually-hidden, [role="status"], [aria-live]')).toBeNull()
    expect(screen.getByRole('button', { name: 'この手順を編集する' })).toHaveFocus()
    // Pressing again does not add a second line
    await userEvent.click(checkbox)
    expect(within(banner).getAllByText(LOCKED)).toHaveLength(1)

    // Gone with the banner, and the next shared plan does not show it until an input is pressed
    await userEvent.click(screen.getByRole('button', { name: '自分の入力に戻る' }))
    expect(screen.queryByRole('region', { name: '共有された手順' })).toBeNull()
    expect(state().share.lockedNotice).toBeUndefined()
    act(() =>
      state().showSharedPlan({ input: { ...DEFAULT_INPUT, item: 'sword', wanted: { mending: 1 } }, settings: { edition: 'java', levelCap: 39, objective: 'levels', rename: false }, hash: '#v=1&x' }),
    )
    expect(screen.getByRole('region', { name: '共有された手順' })).not.toHaveTextContent(LOCKED)
  })
})

describe('BannerArea', () => {
  it('replaces the input after confirmation from the shared plan banner', async () => {
    act(() =>
      state().showSharedPlan({ input: { ...DEFAULT_INPUT, item: 'boots', wanted: { mending: 1 } }, settings: { edition: 'java', levelCap: 39, objective: 'levels', rename: false }, hash: '#v=1' }),
    )
    render(<BannerArea />)
    expect(screen.getByRole('region', { name: '共有された手順' })).toHaveTextContent(
      '共有された手順（Java版・ブーツ）を表示しています。自分の入力はそのまま残っています。',
    )
    await userEvent.click(screen.getByRole('button', { name: 'この手順を編集する' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '置き換える' }))
    expect(state().share.active).toBe(false)
    expect(state().input.item).toBe('boots')
    expect(state().system.hasBackup).toBe(true)
  })

  it('moves focus to the first control in the input column, not the top of the page, once the banner is gone (WCAG 2.4.3)', async () => {
    const input: InputState = { ...DEFAULT_INPUT, item: 'pickaxe', wanted: { mending: 1 } }
    const shared = { input, settings: { edition: 'java', levelCap: 39, objective: 'levels', rename: false } as const, hash: '#v=1' }
    act(() => state().showSharedPlan(shared))
    render(
      <>
        <BannerArea />
        <section id={INPUT_COLUMN_ID}>
          <button type="button">Change item</button>
        </section>
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: '自分の入力に戻る' }))
    expect(state().share.active).toBe(false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change item' })).toHaveFocus())

    act(() => state().showSharedPlan(shared))
    await userEvent.click(screen.getByRole('button', { name: 'この手順を編集する' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '置き換える' }))
    expect(state().input.item).toBe('pickaxe')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change item' })).toHaveFocus())
  })

  it('dismisses closable banners with the close button', async () => {
    act(() => {
      getAppStore().setState((s) => ({ system: { ...s.system, banners: { ...s.system.banners, storageCorrupt: true } } }))
      state().showDataDropped(['gone_enchant'])
    })
    render(<BannerArea />)
    expect(screen.getByRole('region', { name: '外したエンチャント' })).toHaveTextContent('gone_enchant')
    const corrupt = screen.getByText('保存されていた入力を読み込めなかったので、空の状態から始めます。').closest('section')!
    await userEvent.click(within(corrupt).getByRole('button', { name: '閉じる' }))
    expect(state().system.banners.storageCorrupt).toBe(false)
  })
})

describe('SettingsSheet', () => {
  it('applies changes immediately', async () => {
    act(() => state().openSettings())
    render(<SettingsSheet />)
    const dialog = screen.getByRole('dialog', { name: '設定' })
    await userEvent.click(within(dialog).getByRole('radio', { name: 'クリエイティブ（上限なし）' }))
    expect(state().session.levelCap).toBeNull()
    await userEvent.click(within(dialog).getByRole('radio', { name: '経験値ポイント優先' }))
    expect(state().session.objective).toBe('xp')
    expect(dialog).toHaveTextContent('必要なレベルちょうどで各手順を行ったときに減る経験値ポイントを少なくします。')
    expect(dialog).toHaveTextContent('経験値ポイントが同じ順番がいくつかあるときは')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'ダーク' }))
    expect(state().prefs.theme).toBe('dark')
    expect(within(dialog).getByRole('button', { name: '元に戻す: 優先するものを変える' })).toBeEnabled()
  })

  it('offers the same three motion choices as the theme and can return to auto after an explicit choice', async () => {
    const { unmount } = render(<App />)
    act(() => state().openSettings())
    const dialog = await screen.findByRole('dialog', { name: '設定' })
    const motion = within(dialog).getByRole('radiogroup', { name: '動きを減らす' })
    expect(within(motion).getAllByRole('radio').map((r) => r.textContent)).toEqual(['自動（OS の設定に従う）', '減らす', '減らさない'])
    expect(within(motion).getByRole('radio', { name: '自動（OS の設定に従う）' })).toHaveAttribute('aria-checked', 'true')
    const root = document.documentElement
    await userEvent.click(within(motion).getByRole('radio', { name: '減らす' }))
    expect(state().prefs.motion).toBe('reduce')
    expect(root.dataset.motion).toBe('reduce')
    await userEvent.click(within(motion).getByRole('radio', { name: '減らさない' }))
    expect(state().prefs.motion).toBe('full')
    expect(root.dataset.motion).toBe('full')
    await userEvent.click(within(motion).getByRole('radio', { name: '自動（OS の設定に従う）' }))
    expect(state().prefs.motion).toBe('auto')
    expect(root.dataset.motion).toBeUndefined()
    unmount()
  })

  it('focuses the selected option of the setting when opened from a condition chip', () => {
    act(() => state().openSettings('objective'))
    render(<SettingsSheet />)
    expect(screen.getByRole('radio', { name: '合計レベル優先（おすすめ）' })).toHaveFocus()
  })

  it('clears all input after confirmation and enables restoring the previous input', async () => {
    act(() => {
      state().loadExample()
      state().openSettings()
    })
    render(<SettingsSheet />)
    expect(screen.getByRole('button', { name: 'ひとつ前の入力に戻す' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '入力をすべて消す' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '消す' }))
    expect(state().input.item).toBeNull()
    expect(screen.getByRole('button', { name: 'ひとつ前の入力に戻す' })).toBeEnabled()
  })

  it('disables settings that change the result while viewing a shared plan', () => {
    act(() => {
      state().showSharedPlan({ input: { ...DEFAULT_INPUT, item: 'boots' }, settings: { edition: 'java', levelCap: 39, objective: 'levels', rename: false }, hash: '#v=1' })
      state().openSettings()
    })
    render(<SettingsSheet />)
    expect(screen.getByRole('radio', { name: 'クリエイティブ（上限なし）' })).toBeDisabled()
    expect(screen.getByRole('dialog')).toHaveTextContent('共有された手順を表示している間は変えられません。')
  })
})

describe('page-level error boundary', () => {
  function Broken(): never {
    throw new Error('cannot render')
  }

  it('shows an error screen instead of a blank page, and the reset button backs up the input, clears it and reloads', async () => {
    const raw = memoryStorage({
      [STORAGE_KEYS.input]: JSON.stringify({ ...EXAMPLE_INPUT, ownedBooks: [], extraItems: [] }),
      [STORAGE_KEYS.prefs]: JSON.stringify({ ...DEFAULT_PREFS, theme: 'dark' }),
    })
    const storage = wrapStorage(raw)
    setAppStore(createAppStore({ storage }, { input: EXAMPLE_INPUT }))
    const reload = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <AppErrorBoundary storage={storage} reload={reload}>
          <Broken />
        </AppErrorBoundary>,
      )
      expect(screen.getByRole('heading', { level: 1, name: '表示に失敗しました' })).toBeInTheDocument()
      expect(error).toHaveBeenCalledWith('Rendering failed', expect.any(Error), expect.anything())
      await userEvent.click(screen.getByRole('button', { name: '入力を消して開き直す' }))
      expect(reload).toHaveBeenCalledTimes(1)
      // The cleared input is backed up, so restoring the previous input in Settings brings it back
      expect(readBackup(storage)?.input.item).toBe(EXAMPLE_INPUT.item)
      expect(raw.data.has(STORAGE_KEYS.input)).toBe(false)
      // Preferences are kept
      expect(raw.data.has(STORAGE_KEYS.prefs)).toBe(true)
      expect(state().input.item).toBeNull()
    } finally {
      error.mockRestore()
    }
  })
})

describe('page-wide keyboard shortcuts', () => {
  const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: target })
    handleGlobalKeyDown(event)
    return event
  }

  it('undoes with Ctrl+Z, redoes with Ctrl+Shift+Z and Ctrl+Y, and leaves text fields to the browser', () => {
    state().loadExample()
    press({ key: 'z', ctrlKey: true })
    expect(state().input.item).toBeNull()
    press({ key: 'Z', ctrlKey: true, shiftKey: true })
    expect(state().input.item).toBe('boots')
    press({ key: 'z', metaKey: true })
    press({ key: 'y', ctrlKey: true })
    expect(state().input.item).toBe('boots')
    const input = document.createElement('input')
    const event = press({ key: 'z', ctrlKey: true }, input)
    expect(event.defaultPrevented).toBe(false)
    expect(state().input.item).toBe('boots')
  })

  it('opens the shortcut list with ? unless turned off in settings or while typing', () => {
    state().setSingleKeyShortcuts(false)
    press({ key: '?' })
    expect(state().ui.keysOpen).toBe(false)
    state().setSingleKeyShortcuts(true)
    press({ key: '?' }, document.createElement('textarea'))
    expect(state().ui.keysOpen).toBe(false)
    press({ key: '?' })
    expect(state().ui.keysOpen).toBe(true)
  })
})

describe('applying preferences to the document', () => {
  it('sets the theme, reduced motion, language, title and description', () => {
    applyPrefsToDocument({ ...DEFAULT_PREFS, theme: 'dark', motion: 'reduce', lang: 'en' })
    const root = document.documentElement
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.motion).toBe('reduce')
    expect(root.lang).toBe('en')
    expect(document.title).toBe('Kanatoko')
    // An explicit choice not to reduce motion overrides the OS setting
    applyPrefsToDocument({ ...DEFAULT_PREFS, motion: 'full' })
    expect(root.dataset.motion).toBe('full')
    applyPrefsToDocument(DEFAULT_PREFS)
    expect(root.dataset.theme).toBeUndefined()
    expect(root.dataset.motion).toBeUndefined()
    expect(root.lang).toBe('ja')
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      '金床でエンチャントの本を合成するとき、必要なレベルが最も少なくなる順番を計算します。',
    )
  })
})

describe('App layout', () => {
  it('has the heading hierarchy, input and steps columns, live regions and a skip link', async () => {
    act(() => state().loadExample())
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: '入力' }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('region', { name: '手順' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(within(screen.getByRole('contentinfo')).getByRole('button', { name: 'このツールについて' })).toBeInTheDocument()
    // The result announcer, the assist announcer and the toast region are present from the start
    expect(screen.getAllByRole('status', { hidden: true }).length).toBeGreaterThanOrEqual(3)
    await userEvent.click(screen.getByRole('link', { name: '手順へ移動' }))
    expect(screen.getByRole('heading', { level: 2, name: '手順' })).toHaveFocus()
  })

  it('keeps only the buttons in the footer and shows the disclaimer, data versions and item image credit in the About dialog', async () => {
    render(<App />)
    for (const lang of ['ja', 'en'] as const) {
      act(() => state().setLang(lang))
      const footer = screen.getByRole('contentinfo')
      expect(footer).not.toHaveTextContent(MESSAGES[lang]['about.disclaimer'])
      await userEvent.click(within(footer).getByRole('button', { name: MESSAGES[lang]['footer.about'] }))
      const about = await screen.findByRole('dialog', { name: MESSAGES[lang]['about.title'] })
      expect(about).toHaveTextContent(MESSAGES[lang]['about.disclaimer'])
      expect(about).toHaveTextContent(MESSAGES[lang]['about.dataVersion'])
      expect(about).toHaveTextContent(MESSAGES[lang]['about.itemImages'])
      act(() => state().closeAbout())
    }
    expect(MESSAGES.ja['about.itemImages']).toBe('アイテムの画像: Minecraft（© Mojang Studios）')
    expect(MESSAGES.en['about.disclaimer']).toBe('NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.')
  })

  it('credits the book images with title, author and license and links to their page and license in the About dialog', async () => {
    render(<App />)
    for (const lang of ['ja', 'en'] as const) {
      act(() => state().setLang(lang))
      act(() => state().openAbout())
      const about = await screen.findByRole('dialog', { name: MESSAGES[lang]['about.title'] })
      expect(about).toHaveTextContent(MESSAGES[lang]['about.bookImages'])
      for (const part of [BOOK_IMAGE_PACK.title, BOOK_IMAGE_PACK.author, BOOK_IMAGE_PACK.license]) expect(about).toHaveTextContent(part)
      const page = within(about).getByRole('link', { name: new RegExp(MESSAGES[lang]['about.bookImagesPage']) })
      expect(page).toHaveAttribute('href', BOOK_IMAGE_PACK.page)
      expect(page).toHaveAttribute('target', '_blank')
      expect(page).toHaveAttribute('rel', 'noopener noreferrer')
      expect(within(about).getByRole('link', { name: new RegExp(MESSAGES[lang]['about.bookImagesLicense']) })).toHaveAttribute('href', BOOK_IMAGE_PACK.licenseUrl)
      act(() => state().closeAbout())
    }
  })

  it('shows the author and a link to GitHub Issues in the About dialog in both languages', async () => {
    render(<App />)
    for (const lang of ['ja', 'en'] as const) {
      act(() => state().setLang(lang))
      act(() => state().openAbout())
      const about = await screen.findByRole('dialog', { name: MESSAGES[lang]['about.title'] })
      expect(about).toHaveTextContent(MESSAGES[lang]['about.contact'].replace('{owner}', PROJECT.owner))
      const issues = within(about).getByRole('link', { name: new RegExp(MESSAGES[lang]['about.contactLink']) })
      expect(issues).toHaveAttribute('href', PROJECT.issuesUrl)
      expect(issues).toHaveAttribute('target', '_blank')
      expect(issues).toHaveAttribute('rel', 'noopener noreferrer')
      act(() => state().closeAbout())
    }
  })

  it('shows only the item picker, without columns, before an item is chosen', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '何にエンチャントしますか？' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '手順' })).toBeNull()
    expect(screen.queryByRole('link', { name: '手順へ移動' })).toBeNull()
  })

  it('shows placeholder results after loading the example', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '例を見る（ブーツに本7冊）' }))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(await screen.findByText('ブーツに本Aを付ける')).toBeInTheDocument()
    expect(screen.getByText('1回の手順にかかるのは多くても16レベルです。続けてすべて行うと、合計66レベルを使います。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(state().input.item).toBeNull()
    vi.useRealTimers()
  })
})
