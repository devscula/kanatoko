import type { EnchantmentId } from '../../../data/types.ts'
import { enchantmentLayout } from '../../data/enchantmentGroups.ts'
import { selectActiveEdition } from '../../state/selectors.ts'
import { getAppStore } from '../../state/store.ts'
import { INPUT_IDS } from './ids.ts'

export function focusFirstPickedGroup(picked: readonly EnchantmentId[]): void {
  const state = getAppStore().getState()
  const item = state.input.item
  if (item === null) return
  for (const block of enchantmentLayout(selectActiveEdition(state), item).blocks) {
    if (block.kind !== 'group') continue
    const id = block.group.members.find((member) => picked.includes(member))
    if (id === undefined) continue
    document.getElementById(INPUT_IDS.group(block.group.key))?.scrollIntoView({ block: 'start' })
    document.getElementById(INPUT_IDS.check(id))?.focus({ preventScroll: true })
    return
  }
}
