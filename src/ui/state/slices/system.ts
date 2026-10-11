import { msg } from '../../i18n/text.ts'
import { isInputEmpty } from '../convert.ts'
import { readBackup, writeBackup } from '../persistIo.ts'
import type { StoreDeps, SliceCreator } from '../store.ts'
import { DEFAULT_INPUT } from '../types.ts'
import { selectDoc } from './history.ts'

/** The shared plan banner belongs to the share slice and cannot be dismissed. */
export type DismissibleBanner = 'linkUnreadable' | 'dataDropped' | 'storageUnavailable' | 'storageCorrupt'

export interface SystemState {
  /** Becomes false after any failed write */
  readonly storageAvailable: boolean
  /** The storage banner is shown only once per page load */
  readonly storageBannerShown: boolean
  readonly hasBackup: boolean
  readonly banners: {
    readonly linkUnreadable: boolean
    /** IDs not in the current data; null hides the banner */
    readonly dataDropped: readonly string[] | null
    readonly storageUnavailable: boolean
    readonly storageCorrupt: boolean
  }
}

export interface SystemSlice {
  readonly system: SystemState
  /** Shows the storage banner, but only the first time. */
  reportStorageFailure(): void
  showLinkUnreadable(): void
  showDataDropped(names: readonly string[]): void
  dismissBanner(kind: DismissibleBanner): void
  saveBackup(): void
  restoreBackup(): void
  /** Backs up first; the caller asks for confirmation. */
  clearAllInput(): void
}

export const DEFAULT_SYSTEM: SystemState = {
  storageAvailable: true,
  storageBannerShown: false,
  hasBackup: false,
  banners: {
    linkUnreadable: false,
    dataDropped: null,
    storageUnavailable: false,
    storageCorrupt: false,
  },
}

export const createSystemSlice =
  (deps: StoreDeps): SliceCreator<SystemSlice> =>
  (set, get) => {
    const patchBanners = (patch: Partial<SystemState['banners']>) => {
      const { system } = get()
      set({ system: { ...system, banners: { ...system.banners, ...patch } } })
    }
    return {
      system: DEFAULT_SYSTEM,

      reportStorageFailure() {
        const { system } = get()
        if (system.storageBannerShown) {
          if (system.storageAvailable) set({ system: { ...system, storageAvailable: false } })
          return
        }
        set({
          system: {
            ...system,
            storageAvailable: false,
            storageBannerShown: true,
            banners: { ...system.banners, storageUnavailable: true },
          },
        })
      },

      showLinkUnreadable: () => patchBanners({ linkUnreadable: true }),

      showDataDropped(names) {
        if (names.length === 0) return
        const current = get().system.banners.dataDropped ?? []
        patchBanners({ dataDropped: [...new Set([...current, ...names])] })
      },

      dismissBanner(kind) {
        patchBanners(kind === 'dataDropped' ? { dataDropped: null } : { [kind]: false })
      },

      saveBackup() {
        const ok = writeBackup(deps.storage, selectDoc(get()))
        if (ok) set({ system: { ...get().system, hasBackup: true } })
        else get().reportStorageFailure()
      },

      restoreBackup() {
        const doc = readBackup(deps.storage)
        if (doc === null) {
          set({ system: { ...get().system, hasBackup: false } })
          return
        }
        const committed = get().commit(msg('history.restore'), () => doc)
        if (committed) get().showToast(msg('toast.restored'), { undo: true })
      },

      clearAllInput() {
        // Clearing an already empty input would overwrite the backup of the last real input with nothing
        if (isInputEmpty(get().input)) return
        get().saveBackup()
        const committed = get().commit(msg('history.clear'), (s) => ({ input: { ...DEFAULT_INPUT, rename: s.input.rename } }))
        if (committed) get().showToast(msg('toast.cleared'), { undo: true })
      },
    }
  }
