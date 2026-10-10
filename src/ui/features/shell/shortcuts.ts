import { useEffect } from 'react'
import { getAppStore } from '../../state/store.ts'

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'number', 'password', 'tel', 'url', ''])

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type)
  return false
}

/** Single-key shortcuts must be possible to turn off and must not fire while typing (WCAG 2.1.4). */
export function isSingleKeyAllowed(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  if (isTypingTarget(event.target)) return false
  return getAppStore().getState().prefs.singleKeyShortcuts
}

export function handleGlobalKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  const state = getAppStore().getState()
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  // Undo: Ctrl+Z or Cmd+Z. Redo: Ctrl+Shift+Z, Cmd+Shift+Z or Ctrl+Y.
  const isUndo = mod && !event.altKey && key === 'z' && !event.shiftKey
  const isRedo =
    mod && !event.altKey && ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey))
  if (isUndo || isRedo) {
    // Text fields keep the browser's own undo
    if (isTypingTarget(event.target)) return
    event.preventDefault()
    if (isRedo) state.redo()
    else state.undo()
    return
  }
  if (event.key === '?' && isSingleKeyAllowed(event)) {
    event.preventDefault()
    state.openKeys()
  }
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])
}
