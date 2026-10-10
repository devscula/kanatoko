import type { Text } from '../../i18n/text.ts'
import type { SliceCreator } from '../store.ts'

/** Setting to focus when a condition chip opens the settings sheet */
export type SettingsFocus = 'gameMode' | 'objective' | 'edition'

export type ResultView = 'list' | 'tree'

export interface UiState {
  readonly settingsOpen: boolean
  readonly settingsFocus: SettingsFocus | null
  readonly aboutOpen: boolean
  readonly keysOpen: boolean
  /** Not saved, so reopening the page shows the list again */
  readonly resultView: ResultView
  /** seq makes a repeated text announce again */
  readonly assist: { readonly text: Text | null; readonly seq: number }
  /** By disclosure id; missing means closed */
  readonly disclosures: Readonly<Record<string, boolean>>
}

export interface UiSlice {
  readonly ui: UiState
  openSettings(focus?: SettingsFocus): void
  closeSettings(): void
  openAbout(): void
  closeAbout(): void
  openKeys(): void
  closeKeys(): void
  setResultView(view: ResultView): void
  announce(text: Text): void
  setDisclosure(id: string, open: boolean): void
  toggleDisclosure(id: string): void
}

export const DEFAULT_UI: UiState = {
  settingsOpen: false,
  settingsFocus: null,
  aboutOpen: false,
  keysOpen: false,
  resultView: 'list',
  assist: { text: null, seq: 0 },
  disclosures: {},
}

export const createUiSlice: SliceCreator<UiSlice> = (set, get) => {
  const update = (patch: Partial<UiState>) => set({ ui: { ...get().ui, ...patch } })
  return {
    ui: DEFAULT_UI,
    openSettings: (focus) => update({ settingsOpen: true, settingsFocus: focus ?? null }),
    closeSettings: () => update({ settingsOpen: false, settingsFocus: null }),
    openAbout: () => update({ aboutOpen: true }),
    closeAbout: () => update({ aboutOpen: false }),
    openKeys: () => update({ keysOpen: true }),
    closeKeys: () => update({ keysOpen: false }),
    setResultView: (resultView) => update({ resultView }),
    announce: (text) => update({ assist: { text, seq: get().ui.assist.seq + 1 } }),
    setDisclosure: (id, open) => {
      if ((get().ui.disclosures[id] ?? false) !== open) update({ disclosures: { ...get().ui.disclosures, [id]: open } })
    },
    toggleDisclosure: (id) => update({ disclosures: { ...get().ui.disclosures, [id]: !(get().ui.disclosures[id] ?? false) } }),
  }
}
