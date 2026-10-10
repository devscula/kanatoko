import type { Lang } from '../../../data/types.ts'
import type { SliceCreator } from '../store.ts'
import { DEFAULT_PREFS, type MotionPref, type PrefsState, type ThemePref } from '../types.ts'

export interface PrefsSlice {
  readonly prefs: PrefsState
  setLang(lang: Lang): void
  setTheme(theme: ThemePref): void
  setMotion(motion: MotionPref): void
  setSingleKeyShortcuts(on: boolean): void
}

export const createPrefsSlice: SliceCreator<PrefsSlice> = (set, get) => {
  const update = (patch: Partial<PrefsState>) => set({ prefs: { ...get().prefs, ...patch } })
  return {
    prefs: DEFAULT_PREFS,
    setLang: (lang) => update({ lang }),
    setTheme: (theme) => update({ theme }),
    setMotion: (motion) => update({ motion }),
    setSingleKeyShortcuts: (singleKeyShortcuts) => update({ singleKeyShortcuts }),
  }
}
