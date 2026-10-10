// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { msg } from '../../i18n/text.ts'
import { memoryStorage, wrapStorage } from '../../state/storage.ts'
import { createAppStore, getAppStore, setAppStore } from '../../state/store.ts'
import { Button } from './Button.tsx'
import { Checkbox } from './Checkbox.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Disclosure } from './Disclosure.tsx'
import { focusFirstInputIssue, focusWhenReady, INPUT_ISSUE_MARK } from './focus.ts'
import { InfoTip } from './InfoTip.tsx'
import { LevelChips } from './LevelChips.tsx'
import { LiveRegion } from './LiveRegion.tsx'
import { SegmentedControl } from './SegmentedControl.tsx'
import { Sheet } from './Sheet.tsx'
import { Stepper } from './Stepper.tsx'
import { Switch } from './Switch.tsx'
import { TOAST_DURATION_MS, ToastRegion } from './Toast.tsx'
import { prefersReducedMotion } from './useMediaQuery.ts'

beforeEach(() => {
  setAppStore(createAppStore({ storage: wrapStorage(memoryStorage()) }))
})

describe('Button', () => {
  it('ignores clicks but stays focusable when softDisabled', async () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" softDisabled aria-describedby="hint" onClick={onClick}>
        できた
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'できた' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    button.focus()
    expect(button).toHaveFocus()
  })
})

describe('Switch', () => {
  it('exposes role="switch" with aria-checked and toggles from anywhere on the row', async () => {
    function Harness() {
      const [on, setOn] = useState(false)
      return <Switch label="動きを減らす" checked={on} onChange={setOn} description="補足" />
    }
    render(<Harness />)
    const sw = screen.getByRole('switch', { name: '動きを減らす' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(sw).toHaveAccessibleDescription('補足')
    await userEvent.click(screen.getByText('動きを減らす'))
    expect(sw).toHaveAttribute('aria-checked', 'true')
  })
})

describe('SegmentedControl', () => {
  function Harness({ readOnly = false, onReadOnly = () => {} }: { readOnly?: boolean; onReadOnly?: () => void }) {
    const [value, setValue] = useState<'auto' | 'light' | 'dark'>('auto')
    return (
      <SegmentedControl<'auto' | 'light' | 'dark'>
        label="テーマ"
        value={value}
        onChange={setValue}
        readOnly={readOnly}
        onReadOnlyActivate={onReadOnly}
        options={[
          { value: 'auto', label: '自動' },
          { value: 'light', label: 'ライト' },
          { value: 'dark', label: 'ダーク' },
        ]}
      />
    )
  }

  it('selects as the arrow keys move, jumps with Home and End, and keeps only the selected option in the tab order', async () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: 'テーマ' })
    const [auto, light, dark] = screen.getAllByRole('radio')
    expect(auto).toHaveAttribute('tabindex', '0')
    expect(light).toHaveAttribute('tabindex', '-1')
    auto.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(light).toHaveAttribute('aria-checked', 'true')
    expect(light).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(dark).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{ArrowRight}')
    expect(auto).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{ArrowLeft}')
    expect(dark).toHaveAttribute('aria-checked', 'true')
    expect(group).toBeInTheDocument()
  })

  it('calls onReadOnlyActivate instead of selecting when read-only', async () => {
    const onReadOnly = vi.fn()
    render(<Harness readOnly onReadOnly={onReadOnly} />)
    await userEvent.click(screen.getByRole('radio', { name: 'ダーク' }))
    expect(onReadOnly).toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: '自動' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('Disclosure', () => {
  it('sets aria-expanded and aria-controls and keeps the closed panel inert', async () => {
    render(
      <Disclosure summary="内訳">
        <button type="button">中のボタン</button>
      </Disclosure>,
    )
    const trigger = screen.getByRole('button', { name: '内訳' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!
    expect(panel).toHaveAttribute('inert')
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(panel).not.toHaveAttribute('inert')
  })
})

describe('InfoTip', () => {
  it('opens its explanation on press, never on hover, and closes on a second press or Esc', async () => {
    render(<InfoTip label="経験値ポイントの説明">必要なレベルちょうどで各手順を行ったときの合計</InfoTip>)
    const info = screen.getByRole('button', { name: '経験値ポイントの説明' })
    await userEvent.hover(info)
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(info)
    expect(screen.getByRole('dialog', { name: '経験値ポイントの説明' })).toHaveTextContent('必要なレベルちょうどで各手順を行ったときの合計')
    await userEvent.click(info)
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(info)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(info).toHaveFocus()
  })
})

describe('Checkbox', () => {
  it('toggles from its label and stays unchanged when read-only', async () => {
    const onChange = vi.fn()
    const onReadOnly = vi.fn()
    const { rerender } = render(<Checkbox label="名前を付ける（+1レベル）" checked={false} onChange={onChange} />)
    await userEvent.click(screen.getByText('名前を付ける（+1レベル）'))
    expect(onChange).toHaveBeenCalledWith(true)
    rerender(<Checkbox label="名前を付ける（+1レベル）" checked={false} onChange={onChange} readOnly onReadOnlyActivate={onReadOnly} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onReadOnly).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('Sheet', () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <div id="app">
        <button type="button" onClick={() => setOpen(true)}>
          開く
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} title="設定">
          <button type="button">最初の操作</button>
          <button type="button">最後の操作</button>
        </Sheet>
      </div>
    )
  }

  it('opens as a modal dialog, focuses the first control and makes the background inert', async () => {
    const { container } = render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '開く' }))
    const dialog = screen.getByRole('dialog', { name: '設定' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: '最初の操作' })).toHaveFocus()
    expect(container).toHaveAttribute('inert')
  })

  it('cycles Tab inside and closes on Esc with focus back on the opener', async () => {
    const { container } = render(<Harness />)
    const opener = screen.getByRole('button', { name: '開く' })
    await userEvent.click(opener)
    await userEvent.tab()
    expect(screen.getByRole('button', { name: '最後の操作' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: '最後の操作' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(opener).toHaveFocus()
    expect(container).not.toHaveAttribute('inert')
  })

  it('stays open when a control inside handles Esc first', async () => {
    function Consumer() {
      const [open, setOpen] = useState(true)
      return (
        <Sheet open={open} onClose={() => setOpen(false)} title="本を追加">
          <input aria-label="名前で探す" onKeyDown={(e) => e.key === 'Escape' && e.preventDefault()} />
        </Sheet>
      )
    }
    render(<Consumer />)
    screen.getByRole('textbox').focus()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('puts the toast controls in the Tab cycle between the end of the sheet and its start', async () => {
    function WithToast() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            開く
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} title="本を追加">
            <button type="button">最初の操作</button>
            <button type="button">最後の操作</button>
          </Sheet>
          <ToastRegion />
        </>
      )
    }
    render(<WithToast />)
    await userEvent.click(screen.getByRole('button', { name: '開く' }))
    act(() => {
      getAppStore().getState().showToast(msg('toast.copied'), { undo: true })
    })
    const last = screen.getByRole('button', { name: '最後の操作' })
    last.focus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: '元に戻す' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: '通知を閉じる' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: '通知を閉じる' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    await userEvent.tab({ shift: true })
    expect(last).toHaveFocus()
  })

  it('leaves hidden (display: none) and tabindex="-1" controls out of the Tab cycle', async () => {
    // jsdom does not render, so stub checkVisibility to look for a display: none ancestor
    const shown = (el: HTMLElement | null): boolean => el === null || (el.style.display !== 'none' && shown(el.parentElement))
    const visible = vi.fn(function (this: HTMLElement) {
      return shown(this)
    })
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', { value: visible, configurable: true, writable: true })
    try {
      render(
        <Sheet open onClose={() => {}} title="本を追加">
          <button type="button" tabIndex={-1}>
            冊数を減らす
          </button>
          <button type="button">わからないとき</button>
          <div style={{ display: 'none' }}>
            <button type="button">やめる</button>
          </div>
        </Sheet>,
      )
      const visibleLast = screen.getByRole('button', { name: 'わからないとき' })
      // The tabindex="-1" button is skipped as the first control
      expect(visibleLast).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus()
      await userEvent.tab({ shift: true })
      expect(visibleLast).toHaveFocus()
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'checkVisibility')
    }
  })

  it('makes an overflowing body without controls a focusable region so the keyboard can scroll it', async () => {
    const sizes = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('data-long') !== null || this.querySelector('[data-long]') !== null ? 1000 : 0
    })
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
    try {
      render(
        <Sheet open onClose={() => {}} title="キーボード操作">
          <p data-long="">長い表</p>
        </Sheet>,
      )
      // With no controls, focus goes to the heading
      expect(screen.getByRole('heading', { name: 'キーボード操作' })).toHaveFocus()
      const region = screen.getByRole('region', { name: 'キーボード操作' })
      expect(region).toHaveAttribute('tabindex', '0')
      await userEvent.tab()
      expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus()
      await userEvent.tab()
      expect(region).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus()
    } finally {
      sizes.mockRestore()
      client.mockRestore()
    }
  })

  it('leaves the body as is when it has controls or does not overflow', () => {
    render(
      <Sheet open onClose={() => {}} title="このツールについて">
        <p>短い文</p>
      </Sheet>,
    )
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('opens ConfirmDialog as an alertdialog with focus on the cancel button', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog open message="入力をすべて消します。" confirmLabel="消す" tone="danger" onConfirm={onConfirm} onCancel={() => {}} />)
    expect(screen.getByRole('alertdialog', { name: '入力をすべて消します。' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'やめる' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: '消す' }))
    expect(onConfirm).toHaveBeenCalled()
  })
})

describe('ToastRegion', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('announces only the message through a status region present from the start, and dismisses after 10 seconds unless hovered', () => {
    render(<ToastRegion />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    act(() => {
      getAppStore().getState().showToast(msg('toast.copied'), { undo: true })
    })
    act(() => {
      vi.advanceTimersByTime(60)
    })
    expect(region).toHaveTextContent('コピーしました')
    expect(region).not.toHaveTextContent('元に戻す')
    expect(region).not.toHaveTextContent('通知を閉じる')
    // The visible toast, buttons included, sits outside the live region
    expect(screen.getByRole('button', { name: '元に戻す' }).closest('[role="status"]')).toBeNull()
    const toast = screen.getByText('コピーしました', { selector: 'p' }).parentElement!
    fireEvent.mouseEnter(toast)
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 1000)
    })
    expect(getAppStore().getState().toast).not.toBeNull()
    fireEvent.mouseLeave(toast)
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS)
    })
    expect(getAppStore().getState().toast).toBeNull()
  })

  it('sets --toast-bottom on html while a toast is shown and removes it afterwards', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, window.innerHeight - 88, 390, 88))
    try {
      render(<ToastRegion />)
      const html = document.documentElement
      expect(html.style.getPropertyValue('--toast-bottom')).toBe('')
      act(() => {
        getAppStore().getState().showToast(msg('toast.copied'))
      })
      expect(html.style.getPropertyValue('--toast-bottom')).toBe('88px')
      fireEvent.click(screen.getByRole('button', { name: '通知を閉じる' }))
      expect(html.style.getPropertyValue('--toast-bottom')).toBe('')
    } finally {
      rect.mockRestore()
    }
  })

  it('returns focus to the element focused before the toast when a toast button dismisses it', () => {
    render(
      <>
        <button type="button">前の操作</button>
        <ToastRegion />
      </>,
    )
    const before = screen.getByRole('button', { name: '前の操作' })
    act(() => {
      getAppStore().getState().showToast(msg('toast.copied'))
    })
    before.focus()
    act(() => {
      screen.getByRole('button', { name: '通知を閉じる' }).focus()
    })
    fireEvent.click(screen.getByRole('button', { name: '通知を閉じる' }))
    expect(getAppStore().getState().toast).toBeNull()
    expect(before).toHaveFocus()
  })

  it('falls back to the results heading when no modal is open', () => {
    render(
      <>
        <h2 id="results" tabIndex={-1}>
          results
        </h2>
        <ToastRegion />
      </>,
    )
    act(() => {
      getAppStore().getState().showToast(msg('toast.copied'))
    })
    act(() => {
      screen.getByRole('button', { name: '通知を閉じる' }).focus()
    })
    fireEvent.keyDown(screen.getByRole('button', { name: '通知を閉じる' }), { key: 'Escape' })
    expect(getAppStore().getState().toast).toBeNull()
    expect(screen.getByRole('heading', { name: 'results' })).toHaveFocus()
  })

  it('reverts the last input change from Undo and dismisses from the close button', () => {
    render(<ToastRegion />)
    act(() => {
      getAppStore().getState().loadExample()
    })
    expect(getAppStore().getState().input.item).toBe('boots')
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(getAppStore().getState().input.item).toBeNull()
    act(() => {
      getAppStore().getState().showToast(msg('toast.copied'))
    })
    fireEvent.click(screen.getByRole('button', { name: '通知を閉じる' }))
    expect(getAppStore().getState().toast).toBeNull()
  })
})

describe('LiveRegion', () => {
  it('clears and refills to announce the same text again', () => {
    vi.useFakeTimers()
    const { rerender } = render(<LiveRegion text="合計66レベル" seq={1} />)
    const region = screen.getByRole('status')
    act(() => {
      vi.advanceTimersByTime(60)
    })
    expect(region).toHaveTextContent('合計66レベル')
    rerender(<LiveRegion text="合計66レベル" seq={2} />)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(region).toBeEmptyDOMElement()
    act(() => {
      vi.advanceTimersByTime(60)
    })
    expect(region).toHaveTextContent('合計66レベル')
    vi.useRealTimers()
  })
})

describe('announcements while a sheet is open', () => {
  it('keeps the live regions and the toast region from becoming inert', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            開く
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} title="共有">
            <button type="button">リンクをコピー</button>
          </Sheet>
          <LiveRegion id="assist" text="コピーしました" seq={1} />
          <ToastRegion />
        </>
      )
    }
    const { container } = render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '開く' }))
    expect(container).toHaveAttribute('inert')
    expect(document.getElementById('assist')).not.toHaveAttribute('inert')
    expect(document.getElementById('assist')?.closest('[inert]')).toBeNull()
    for (const region of document.querySelectorAll('[data-modal-exempt]')) expect(region).not.toHaveAttribute('inert')
  })
})

describe('LevelChips', () => {
  function Harness({ initial = null, readOnly = false, onReadOnlyActivate }: { initial?: number | null; readOnly?: boolean; onReadOnlyActivate?: () => void }) {
    const [value, setValue] = useState<number | null>(initial)
    return <LevelChips id="protection" value={value} onChange={setValue} readOnly={readOnly} onReadOnlyActivate={onReadOnlyActivate} />
  }
  const radio = (n: number) => screen.getByRole('radio', { name: `ダメージ軽減 レベル${n}` })

  it('renders a named radiogroup with one radio per level up to the max, and only I in the tab order when nothing is selected', () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: 'ダメージ軽減のレベル' })
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(4)
    expect([1, 2, 3, 4].map((n) => radio(n).tabIndex)).toEqual([0, -1, -1, -1])
    expect([1, 2, 3, 4].every((n) => radio(n).getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('selects as the arrow keys move, wraps around at the ends, and jumps with Home and End', async () => {
    render(<Harness initial={1} />)
    radio(1).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(radio(4)).toHaveFocus()
    expect(radio(4)).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{ArrowRight}')
    expect(radio(1)).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{End}')
    expect(radio(4)).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{Home}')
    expect(radio(1)).toHaveAttribute('aria-checked', 'true')
    expect([1, 2, 3, 4].map((n) => radio(n).tabIndex)).toEqual([0, -1, -1, -1])
  })

  it('calls onReadOnlyActivate instead of selecting when read-only', async () => {
    const onReadOnlyActivate = vi.fn()
    render(<Harness initial={2} readOnly onReadOnlyActivate={onReadOnlyActivate} />)
    await userEvent.click(radio(3))
    expect(onReadOnlyActivate).toHaveBeenCalledTimes(1)
    expect(radio(2)).toHaveAttribute('aria-checked', 'true')
    expect(radio(3)).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('Stepper', () => {
  function Harness({ readOnly = false, onReadOnlyActivate }: { readOnly?: boolean; onReadOnlyActivate?: () => void }) {
    const [value, setValue] = useState(2)
    return (
      <Stepper
        value={value}
        min={0}
        max={10}
        onChange={setValue}
        label="冊数"
        valueText={`${value}冊`}
        decrementLabel="減らす"
        incrementLabel="増やす"
        pageStep={5}
        readOnly={readOnly}
        onReadOnlyActivate={onReadOnlyActivate}
      />
    )
  }

  it('steps with the arrow keys, PageUp/PageDown by pageStep and Home/End without leaving the range', async () => {
    render(<Harness />)
    const spin = screen.getByRole('spinbutton', { name: '冊数' })
    spin.focus()
    await userEvent.keyboard('{ArrowUp}{ArrowRight}')
    expect(spin).toHaveAttribute('aria-valuenow', '4')
    await userEvent.keyboard('{ArrowDown}{ArrowLeft}')
    expect(spin).toHaveAttribute('aria-valuenow', '2')
    await userEvent.keyboard('{PageUp}')
    expect(spin).toHaveAttribute('aria-valuenow', '7')
    await userEvent.keyboard('{PageUp}')
    expect(spin).toHaveAttribute('aria-valuenow', '10')
    expect(spin).toHaveAttribute('aria-valuetext', '10冊')
    expect(screen.getByRole('button', { name: '増やす' })).toBeDisabled()
    await userEvent.keyboard('{Home}')
    expect(spin).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByRole('button', { name: '減らす' })).toBeDisabled()
    await userEvent.keyboard('{End}')
    expect(spin).toHaveAttribute('aria-valuenow', '10')
  })

  it('keeps the [−] and [+] buttons out of the tab order and steps by one when they are pressed', async () => {
    render(<Harness />)
    const plus = screen.getByRole('button', { name: '増やす' })
    expect(plus).toHaveAttribute('tabindex', '-1')
    await userEvent.click(plus)
    expect(screen.getByRole('spinbutton', { name: '冊数' })).toHaveAttribute('aria-valuenow', '3')
  })

  it('calls onReadOnlyActivate instead of changing the value when read-only', async () => {
    const onReadOnlyActivate = vi.fn()
    render(<Harness readOnly onReadOnlyActivate={onReadOnlyActivate} />)
    const spin = screen.getByRole('spinbutton', { name: '冊数' })
    expect(spin).toHaveAttribute('aria-readonly', 'true')
    spin.focus()
    await userEvent.keyboard('{ArrowUp}')
    await userEvent.click(screen.getByRole('button', { name: '増やす' }))
    expect(onReadOnlyActivate).toHaveBeenCalledTimes(2)
    expect(spin).toHaveAttribute('aria-valuenow', '2')
  })
})

describe('focus helpers', () => {
  it('focusFirstInputIssue moves to the fix button of the first issue, or else to the first control in its row', () => {
    render(
      <ul>
        <li>
          <input type="checkbox" aria-label="修繕" />
        </li>
        <li>
          <input type="checkbox" aria-label="幸運" />
          <div {...INPUT_ISSUE_MARK}>
            <p>幸運は統合版にありません。</p>
          </div>
        </li>
        <li>
          <div {...INPUT_ISSUE_MARK}>
            <button type="button">外す</button>
          </div>
        </li>
      </ul>,
    )
    expect(focusFirstInputIssue()).toBe(true)
    expect(screen.getByRole('checkbox', { name: '幸運' })).toHaveFocus()
    const last = screen.getAllByRole('listitem')[2]
    expect(focusFirstInputIssue(last)).toBe(true)
    expect(screen.getByRole('button', { name: '外す' })).toHaveFocus()
  })

  it('focusFirstInputIssue does nothing when there is no issue', () => {
    render(<button type="button">ほか</button>)
    expect(focusFirstInputIssue()).toBe(false)
    expect(document.body).toHaveFocus()
  })

  it('focusWhenReady waits for the element to render and then focuses it', async () => {
    const button = document.createElement('button')
    let ready = false
    focusWhenReady(() => (ready ? button : null))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    document.body.append(button)
    ready = true
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(button).toHaveFocus()
    button.remove()
  })
})

describe('prefersReducedMotion', () => {
  const originalMatchMedia = window.matchMedia
  const osReduces = (reduce: boolean) => {
    window.matchMedia = (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  }
  afterEach(() => {
    window.matchMedia = originalMatchMedia
    delete document.documentElement.dataset.motion
  })

  it('prefers the in-app setting (html[data-motion]) and follows the OS only when none is chosen', () => {
    osReduces(true)
    expect(prefersReducedMotion()).toBe(true)
    document.documentElement.dataset.motion = 'full'
    expect(prefersReducedMotion()).toBe(false)
    osReduces(false)
    document.documentElement.dataset.motion = 'reduce'
    expect(prefersReducedMotion()).toBe(true)
    delete document.documentElement.dataset.motion
    expect(prefersReducedMotion()).toBe(false)
  })
})

describe('modalStack', () => {
  it('does not leave the page inert when the top entry has been detached', async () => {
    const { pushModal, isTopModal, topModal } = await import('./modalStack.ts')
    const page = document.createElement('div')
    const outer = document.createElement('div')
    const inner = document.createElement('div')
    document.body.append(page, outer)
    outer.append(inner)
    const releaseOuter = pushModal(outer)
    pushModal(inner)
    expect(page.inert).toBe(true)
    expect(isTopModal(inner)).toBe(true)
    // Closing the outer view detaches the inner one in the same render, and the outer cleanup runs first
    outer.remove()
    releaseOuter()
    expect(page.inert).toBe(false)
    expect(topModal()).toBeNull()
    page.remove()
  })
})
