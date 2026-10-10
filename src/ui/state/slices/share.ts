import type { Settings } from '../../../engine/index.ts'
import { msg } from '../../i18n/text.ts'
import type { SliceCreator } from '../store.ts'
import { DEFAULT_SESSION, type InputDoc, type InputState, type SessionState } from '../types.ts'

export interface SharedPlan {
  /** rename matches settings.rename */
  readonly input: InputState
  readonly settings: Settings
  /** Hash of the opened link without view, reused as is when sharing again */
  readonly hash: string
}

/**
 * A shared plan is shown read-only, apart from the user's own input and session, which stay untouched. commit refuses
 * changes while it is active.
 */
export interface ShareState {
  readonly active: boolean
  readonly plan: SharedPlan | null
  /** Set once a read-only control is used, so the banner explains why. Missing means false. */
  readonly lockedNotice?: boolean
}

// Kept apart from ShareState, which feeds the solver, so opening the sheet does not recalculate
export interface ShareSheetState {
  readonly open: boolean
  /** Text the clipboard rejected, shown selected in the sheet for the user to copy by hand */
  readonly manualText: string | null
}

export interface ShareSlice {
  readonly share: ShareState
  readonly shareSheet: ShareSheetState
  showSharedPlan(plan: SharedPlan): void
  showSharedLockedNotice(): void
  /** hashSync then rewrites the hash for the user's own input. */
  exitSharedPlan(): void
  /** Backs up the user's input first. */
  replaceWithSharedPlan(): void
  /**
   * Makes a link opened with an empty input the user's own input. record adds an input history entry, for a link
   * pasted after the page loaded. If the settings change, the previous ones are backed up first.
   */
  adoptSharedPlan(link: { readonly input: InputState; readonly settings: Settings }, options?: { readonly record?: boolean }): void
  openShareSheet(options?: { readonly manualText?: string }): void
  closeShareSheet(): void
}

export const DEFAULT_SHARE: ShareState = { active: false, plan: null }
export const DEFAULT_SHARE_SHEET: ShareSheetState = { open: false, manualText: null }

function sessionOf(settings: Settings): SessionState {
  return { edition: settings.edition, levelCap: settings.levelCap, objective: settings.objective }
}

function docWithPlan(input: InputState, settings: Settings): InputDoc {
  return { input: { ...input, rename: settings.rename }, session: sessionOf(settings) }
}

const sameSession = (a: SessionState, b: SessionState) => a.edition === b.edition && a.levelCap === b.levelCap && a.objective === b.objective

export const createShareSlice: SliceCreator<ShareSlice> = (set, get) => ({
  share: DEFAULT_SHARE,
  shareSheet: DEFAULT_SHARE_SHEET,

  showSharedPlan(plan) {
    set({ share: { active: true, plan } })
  },

  showSharedLockedNotice() {
    const { share } = get()
    if (!share.active || share.lockedNotice === true) return
    set({ share: { ...share, lockedNotice: true } })
  },

  exitSharedPlan() {
    if (!get().share.active) return
    set({ share: DEFAULT_SHARE })
  },

  replaceWithSharedPlan() {
    const { plan } = get().share
    if (plan === null) return
    get().saveBackup()
    set({ share: DEFAULT_SHARE })
    get().commit(msg('history.replace'), () => docWithPlan(plan.input, plan.settings))
  },

  adoptSharedPlan({ input, settings }, options = {}) {
    const state = get()
    const doc = docWithPlan(input, settings)
    // The input is empty, so only customized settings can be lost; back up only then
    const customized = !sameSession(state.session, DEFAULT_SESSION)
    if (customized && !sameSession(state.session, doc.session)) state.saveBackup()
    if (options.record) {
      set({ share: DEFAULT_SHARE })
      get().commit(msg('history.replace'), () => doc)
    } else {
      set({ ...doc, share: DEFAULT_SHARE })
    }
  },

  openShareSheet(options = {}) {
    set({ shareSheet: { open: true, manualText: options.manualText ?? null } })
  },

  closeShareSheet() {
    if (!get().shareSheet.open) return
    set({ shareSheet: { ...get().shareSheet, open: false } })
  },
})
