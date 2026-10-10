// Every change goes through commit so it can be undone. The rules for adjusting related fields live in convert.ts.

import { maxLevel } from '../../../data/gameData.ts'
import type { EnchantmentId, ItemTypeId } from '../../../data/types.ts'
import { defaultAnvilUses } from '../../../engine/index.ts'
import type { EnchantLevels } from '../../../engine/index.ts'
import { planMaxAll } from '../../data/enchantmentGroups.ts'
import { enchText, itemText, listText, msg, romanText, type Text } from '../../i18n/text.ts'
import {
  canHaveSpares,
  changeExisting,
  changeItem,
  createUid,
  deselectWanted,
  EXAMPLE_INPUT,
  existingConflicts,
  mergeOwnedBook,
  type OwnedBookDraft,
  sameLevels,
  selectWanted,
  sortedLevels,
} from '../convert.ts'
import type { SliceCreator } from '../store.ts'
import { type AnvilUsesOverride, DEFAULT_INPUT, type ExtraItem, type InputState } from '../types.ts'

export interface ExtraItemDraft {
  readonly enchantments: EnchantLevels
  readonly anvilUsesOverride: AnvilUsesOverride | null
}

export interface InputSlice {
  readonly input: InputState
  /** Anything removed as a result is reported in a toast with Undo. */
  setItem(item: ItemTypeId): void
  /** Wanted enchantments removed because they conflict with the new existing ones are reported in a toast. */
  setExisting(existing: EnchantLevels): void
  setAnvilUsesOverride(next: AnvilUsesOverride | null, options?: { readonly toast?: boolean }): void
  /** level defaults to the max. A level at or below the existing one removes the entry. */
  selectWanted(id: EnchantmentId, level?: number): void
  deselectWanted(id: EnchantmentId): void
  selectAllMax(options?: { readonly onChange?: (picked: readonly EnchantmentId[]) => void }): void
  /** A book identical to an existing row raises its count instead. Returns the uid of the row. */
  addOwnedBook(draft: OwnedBookDraft): string
  /** Merges into another row if they become identical. Returns the uid of the resulting row. */
  updateOwnedBook(uid: string, draft: OwnedBookDraft): string
  /** With a label, shows toast.deleted with Undo. */
  removeOwnedBook(uid: string, options?: { readonly label?: Text }): void
  addExtraItem(draft: ExtraItemDraft): string
  updateExtraItem(uid: string, draft: ExtraItemDraft): void
  removeExtraItem(uid: string, options?: { readonly label?: Text }): void
  setRename(rename: boolean): void
  loadExample(): void
}

export const createInputSlice: SliceCreator<InputSlice> = (_set, get) => {
  const edition = () => get().session.edition
  const owned = () => msg('history.owned')
  const commitInput = (label: Text, patch: (input: InputState) => InputState | null): boolean =>
    get().commit(label, (s) => {
      const next = patch(s.input)
      return next === null || next === s.input ? null : { input: next }
    })

  return {
    input: DEFAULT_INPUT,

    setItem(item) {
      const state = get()
      if (state.input.item === item) return
      const { next, removed, sparesRemoved } = changeItem(state.input, edition(), item)
      const committed = state.commit(msg('history.item', { item: itemText(item) }), () => ({ input: next }))
      if (!committed) return
      if (removed.length > 0) {
        get().showToast(msg('toast.itemChangedRemoved', { item: itemText(item), list: listText(removed.map((id) => enchText(id))) }), {
          undo: true,
          area: 'input',
        })
      } else if (sparesRemoved) {
        get().showToast(msg('toast.itemChangedSpares', { item: itemText(state.input.item ?? item) }), { undo: true, area: 'input' })
      }
    },

    setExisting(existing) {
      const state = get()
      const { next, removedByConflict } = changeExisting(state.input, edition(), existing)
      if (sameLevels(next.existing, state.input.existing) && sameLevels(next.wanted, state.input.wanted)) return
      const committed = state.commit(msg('history.existing'), () => ({ input: next }))
      if (committed && removedByConflict.length > 0) {
        const conflicting = [...new Set(removedByConflict.flatMap((id) => existingConflicts(edition(), next.existing, id)))]
        get().showToast(
          msg('toast.wantedRemovedByExisting', {
            list: listText(removedByConflict.map((id) => enchText(id))),
            existing: listText(conflicting.map((id) => enchText(id))),
          }),
          { undo: true, area: 'input' },
        )
      }
    },

    setAnvilUsesOverride(next, options = {}) {
      const state = get()
      if (state.input.anvilUsesOverride === next) return
      const committed = commitInput(msg('history.uses'), (input) => ({ ...input, anvilUsesOverride: next }))
      if (committed && options.toast && state.input.item !== null) {
        const { item, existing } = state.input
        const value =
          next === null
            ? msg('uses.summary.auto', { n: defaultAnvilUses(edition(), item, existing) })
            : msg('uses.summary.entered', { n: next })
        get().showToast(msg('toast.usesChanged', { target: itemText(state.input.item), value }), { undo: true, area: 'input' })
      }
    },

    selectWanted(id, level) {
      const state = get()
      const result = selectWanted(state.input, edition(), id, level ?? maxLevel(id))
      if (result === null) return
      const label =
        state.input.wanted[id] !== undefined
          ? msg('history.level', { name: enchText(id), level: romanText(level ?? maxLevel(id)) })
          : msg('history.select', { name: enchText(id) })
      const committed = state.commit(label, () => ({ input: result.next }))
      if (committed && result.replaced.length > 0) {
        get().showToast(msg('toast.conflictReplaced', { list: listText(result.replaced.map((r) => enchText(r))) }), {
          undo: true,
          area: 'input',
        })
      }
    },

    deselectWanted(id) {
      commitInput(msg('history.deselect', { name: enchText(id) }), (input) => deselectWanted(input, id))
    },

    selectAllMax(options = {}) {
      const state = get()
      const plan = planMaxAll(state.input, edition())
      if (!plan.changed) return
      const committed = state.commit(msg('history.maxAll'), () => ({ input: plan.next }))
      if (!committed || plan.picked.length === 0) return
      const { onChange } = options
      get().showToast(msg('toast.maxAllPicked', { list: listText(plan.picked.map((id) => enchText(id))) }), {
        actions: onChange === undefined ? [] : [{ label: msg('toast.change'), run: () => onChange(plan.picked) }],
        undo: true,
        area: 'input',
      })
    },

    addOwnedBook(draft) {
      let uid = ''
      commitInput(owned(), (input) => {
        const merged = mergeOwnedBook(input.ownedBooks, draft)
        uid = merged.uid
        return { ...input, ownedBooks: merged.books }
      })
      return uid
    },

    updateOwnedBook(uid, draft) {
      let result = uid
      commitInput(owned(), (input) => {
        const index = input.ownedBooks.findIndex((b) => b.uid === uid)
        if (index < 0) return null
        const current = input.ownedBooks[index]
        if (
          sameLevels(current.enchantments, draft.enchantments) &&
          current.count === draft.count &&
          current.anvilUsesOverride === draft.anvilUsesOverride
        ) {
          return null
        }
        // Keep the row in place unless it merges into another row
        const others = input.ownedBooks.filter((b) => b.uid !== uid)
        const merged = mergeOwnedBook(others, draft, uid)
        result = merged.uid
        const books = merged.uid === uid ? [...others.slice(0, index), merged.books.at(-1)!, ...others.slice(index)] : merged.books
        return { ...input, ownedBooks: books }
      })
      return result
    },

    removeOwnedBook(uid, options = {}) {
      const committed = commitInput(owned(), (input) =>
        input.ownedBooks.some((b) => b.uid === uid) ? { ...input, ownedBooks: input.ownedBooks.filter((b) => b.uid !== uid) } : null,
      )
      if (committed && options.label !== undefined) get().showToast(msg('toast.deleted', { label: options.label }), { undo: true, area: 'input' })
    },

    addExtraItem(draft) {
      const uid = createUid()
      commitInput(owned(), (input) =>
        canHaveSpares(input.item)
          ? { ...input, extraItems: [...input.extraItems, { uid, enchantments: sortedLevels(draft.enchantments), anvilUsesOverride: draft.anvilUsesOverride }] }
          : null,
      )
      return uid
    },

    updateExtraItem(uid, draft) {
      commitInput(owned(), (input) => {
        const current = input.extraItems.find((x) => x.uid === uid)
        if (current === undefined) return null
        if (sameLevels(current.enchantments, draft.enchantments) && current.anvilUsesOverride === draft.anvilUsesOverride) return null
        const next: ExtraItem = { uid, enchantments: sortedLevels(draft.enchantments), anvilUsesOverride: draft.anvilUsesOverride }
        return { ...input, extraItems: input.extraItems.map((x) => (x.uid === uid ? next : x)) }
      })
    },

    removeExtraItem(uid, options = {}) {
      const committed = commitInput(owned(), (input) =>
        input.extraItems.some((x) => x.uid === uid) ? { ...input, extraItems: input.extraItems.filter((x) => x.uid !== uid) } : null,
      )
      if (committed && options.label !== undefined) get().showToast(msg('toast.deleted', { label: options.label }), { undo: true, area: 'input' })
    },

    setRename(rename) {
      commitInput(msg('history.rename'), (input) => (input.rename === rename ? null : { ...input, rename }))
    },

    loadExample() {
      const committed = commitInput(msg('history.example'), (input) => ({ ...EXAMPLE_INPUT, rename: input.rename }))
      if (committed) get().showToast(msg('toast.example'), { undo: true, area: 'input' })
    },
  }
}
