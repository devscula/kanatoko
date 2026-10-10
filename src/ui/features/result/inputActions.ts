import type { EnchantmentId } from '../../../data/types.ts'
import type { EnchantLevels } from '../../../engine/index.ts'
import { enchText, msg, type Text } from '../../i18n/text.ts'
import type { InputState } from '../../state/types.ts'
import { getAppStore } from '../../state/store.ts'
import { redirectToSharedBanner } from '../shell/readOnly.ts'

/** True if the input changed */
function change(label: Text, toast: Text | null, update: (input: InputState) => InputState | null): boolean {
  const store = getAppStore().getState()
  if (store.share.active) {
    redirectToSharedBanner()
    return false
  }
  const committed = store.commit(label, (s) => {
    const next = update(s.input)
    return next === null || next === s.input ? null : { input: next }
  })
  if (committed && toast !== null) getAppStore().getState().showToast(toast, { undo: true })
  return committed
}

export function dropWanted(id: EnchantmentId, toast: Text = msg('toast.sug.dropGoal', { name: enchText(id) })): boolean {
  return change(msg('history.suggestion'), toast, (input) => {
    if (input.wanted[id] === undefined) return null
    const wanted: Record<string, number> = { ...input.wanted }
    delete wanted[id]
    return { ...input, wanted: wanted as EnchantLevels }
  })
}

export function setWantedLevel(id: EnchantmentId, level: number, toast: Text): boolean {
  return change(msg('history.suggestion'), toast, (input) => {
    if (input.wanted[id] === level) return null
    return { ...input, wanted: { ...input.wanted, [id]: level } }
  })
}

export function keepEnchantments(levels: EnchantLevels): boolean {
  return change(msg('history.suggestion'), null, (input) => {
    const wanted: Record<string, number> = { ...input.wanted }
    for (const [id, level] of Object.entries(levels)) {
      if (level === undefined) continue
      wanted[id] = Math.max(wanted[id] ?? 0, level)
    }
    return { ...input, wanted: wanted as EnchantLevels }
  })
}

export function removeOwnedRows(indexes: readonly number[], label: Text): boolean {
  if (indexes.length === 0) return false
  const drop = new Set(indexes)
  return change(msg('history.removeOwned'), msg('toast.deleted', { label }), (input) => ({
    ...input,
    ownedBooks: input.ownedBooks.filter((_, index) => !drop.has(index)),
  }))
}
