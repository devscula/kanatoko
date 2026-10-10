import type { Edition, EnchantmentId, ItemTypeId } from '../../../data/types.ts'
import type { Objective } from '../../../engine/index.ts'
import { objectiveName } from '../../i18n/settingNames.ts'
import { editionText, enchText, itemText, listText, msg, type TextArg } from '../../i18n/text.ts'
import { removeNotInEdition } from '../convert.ts'
import type { SliceCreator } from '../store.ts'
import { DEFAULT_SESSION, type SessionState } from '../types.ts'

export interface SessionSlice {
  readonly session: SessionState
  /** Removes enchantments and items the new edition lacks from the input, with a toast if there were any. */
  setEdition(edition: Edition): void
  /** 39 = Survival, null = Creative */
  setLevelCap(levelCap: 39 | null, options?: { readonly toast?: boolean }): void
  setObjective(objective: Objective, options?: { readonly toast?: boolean }): void
}

export const createSessionSlice: SliceCreator<SessionSlice> = (_set, get) => ({
  session: DEFAULT_SESSION,

  setEdition(edition) {
    const state = get()
    if (state.session.edition === edition) return
    const removal = removeNotInEdition(state.input, edition)
    const committed = state.commit(msg('history.edition', { edition: editionText(edition) }), (s) => ({
      input: removal.next,
      session: { ...s.session, edition },
    }))
    if (!committed) return
    const { removed } = removal
    const names: TextArg[] = [
      ...removed.items.map((id: ItemTypeId) => itemText(id)),
      ...removed.enchantments.map((id: EnchantmentId) => enchText(id)),
    ]
    if (names.length > 0) {
      get().showToast(msg('toast.editionRemoved', { list: listText(names), edition: editionText(edition) }), {
        undo: true,
        area: 'input',
      })
    }
  },

  setLevelCap(levelCap, options = {}) {
    const committed = get().commit(msg('history.gameMode'), (s) =>
      s.session.levelCap === levelCap ? null : { session: { ...s.session, levelCap } },
    )
    if (committed && options.toast) {
      get().showToast(msg(levelCap === null ? 'toast.creativeOn' : 'toast.survivalOn'), { undo: true })
    }
  },

  setObjective(objective, options = {}) {
    const committed = get().commit(msg('history.objective'), (s) =>
      s.session.objective === objective ? null : { session: { ...s.session, objective } },
    )
    if (committed && options.toast) {
      get().showToast(msg('toast.objectiveChanged', { name: objectiveName(objective) }), { undo: true })
    }
  },
})
