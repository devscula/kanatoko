import { useEffect } from 'react'
import { isSingleKeyAllowed } from '../shell/shortcuts.ts'

export function useSlashFocus(inputId: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented || !isSingleKeyAllowed(event)) return
      const input = document.getElementById(inputId)
      if (input === null || input.closest('[inert]') !== null) return
      event.preventDefault()
      input.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [inputId, enabled])
}
