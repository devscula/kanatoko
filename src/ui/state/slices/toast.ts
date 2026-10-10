// Timing and pausing are handled by the base/Toast component.

import { msg, type Text } from '../../i18n/text.ts'
import type { SliceCreator } from '../store.ts'

export interface ToastAction {
  readonly label: Text
  readonly run: () => void
}

/** 'input' is for input changes, which wide layouts show under the input pane */
export type ToastArea = 'input' | 'global'

export interface ToastItem {
  readonly id: number
  readonly message: Text
  readonly actions: readonly ToastAction[]
  readonly area: ToastArea
}

export interface ToastOptions {
  /** Placed before Undo */
  readonly actions?: readonly ToastAction[]
  /** Appends an Undo action that reverts the latest input history entry */
  readonly undo?: boolean
  readonly area?: ToastArea
}

export interface ToastSlice {
  readonly toast: ToastItem | null
  /** Replaces any current toast. */
  showToast(message: Text, options?: ToastOptions): number
  /** With an id, dismisses only if that toast is still showing. */
  dismissToast(id?: number): void
}

let nextToastId = 1

export const createToastSlice: SliceCreator<ToastSlice> = (set, get) => ({
  toast: null,

  showToast(message, options = {}) {
    const id = nextToastId++
    const actions: ToastAction[] = [...(options.actions ?? [])]
    if (options.undo) {
      actions.push({
        label: msg('toast.undo'),
        run: () => {
          get().undo()
          get().dismissToast(id)
        },
      })
    }
    set({ toast: { id, message, actions, area: options.area ?? 'global' } })
    return id
  },

  dismissToast(id) {
    const current = get().toast
    if (current === null || (id !== undefined && current.id !== id)) return
    set({ toast: null })
  },
})
