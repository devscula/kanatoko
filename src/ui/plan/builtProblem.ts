// Subsets of BuiltProblem and InputState, so the full objects from src/ui/state are assignable.

import type { ItemTypeId } from '../../data/types.ts'
import type { EnchantLevels } from '../../engine/index.ts'
import type { BuiltProblem } from '../state/buildProblem.ts'

export type { ExcludedReason, InputSource } from '../state/buildProblem.ts'

/** inputSources follows the order of the engine's normalized inputs. */
export type BuiltProblemView = Pick<BuiltProblem, 'inputSources' | 'supplements' | 'excluded' | 'fallback'> & { readonly planId?: string }

export interface InputView {
  readonly item: ItemTypeId | null
  readonly existing: EnchantLevels
  readonly wanted: EnchantLevels
  readonly ownedBooks: readonly { readonly enchantments: EnchantLevels; readonly count: number }[]
  readonly extraItems: readonly { readonly enchantments: EnchantLevels }[]
}
