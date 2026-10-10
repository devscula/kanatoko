import { useCallback } from 'react'
import { msg } from '../../i18n/text.ts'
import { selectReadOnly } from '../../state/selectors.ts'
import { getAppStore, useAppStore } from '../../state/store.ts'

export const SHARED_EDIT_BUTTON_ID = 'shared-plan-edit'

export function redirectToSharedBanner(): void {
  const state = getAppStore().getState()
  // Also shown in the banner: after a mouse click there is no focus ring, so nothing else would explain the jump.
  state.showSharedLockedNotice()
  document.getElementById(SHARED_EDIT_BUTTON_ID)?.focus()
  state.announce(msg('banner.shared.locked'))
}

export function useReadOnly(): { readonly readOnly: boolean; readonly redirect: () => void } {
  const readOnly = useAppStore(selectReadOnly)
  const redirect = useCallback(() => redirectToSharedBanner(), [])
  return { readOnly, redirect }
}
