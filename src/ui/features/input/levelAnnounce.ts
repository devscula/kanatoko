// A row's checkbox is named after the enchantment alone, so a level change from the keyboard changes neither its name nor
// its state and would go unannounced. Level chips don't need this; their own name and checked state are read.

import type { EnchantmentId } from '../../../data/types.ts'
import { enchText, msg } from '../../i18n/text.ts'
import { getAppStore } from '../../state/store.ts'

export function announceLevel(id: EnchantmentId, level: number): void {
  getAppStore().getState().announce(msg('a11y.enchantLevel', { name: enchText(id), n: level }))
}
