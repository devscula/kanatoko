// These are saved to storage and kept as history snapshots as is, so they must stay JSON-serializable.

import type { Edition, EnchantmentId, ItemTypeId, Lang } from '../../data/types.ts'
import type { EnchantLevels, Objective } from '../../engine/index.ts'

/** Replaces the automatic value; 0 to LIMITS.maxAnvilUses */
export type AnvilUsesOverride = number

/** Books with the same enchantments and anvil uses share one entry with a count. */
export interface OwnedBook {
  /** UI only; not stored or shared */
  readonly uid: string
  /** At least one, all mutually compatible */
  readonly enchantments: EnchantLevels
  /** 1 to LIMITS.maxStackCount */
  readonly count: number
  readonly anvilUsesOverride: AnvilUsesOverride | null
}

/** Same type and material as the target */
export interface ExtraItem {
  readonly uid: string
  /** Only enchantments that apply to the item, all mutually compatible */
  readonly enchantments: EnchantLevels
  readonly anvilUsesOverride: AnvilUsesOverride | null
}

export interface InputState {
  /** null = nothing picked. 'enchanted_book' = merge books. */
  readonly item: ItemTypeId | null
  readonly existing: EnchantLevels
  readonly anvilUsesOverride: AnvilUsesOverride | null
  /** Never holds a level at or below the existing one */
  readonly wanted: EnchantLevels
  readonly ownedBooks: readonly OwnedBook[]
  readonly extraItems: readonly ExtraItem[]
  readonly rename: boolean
}

export const DEFAULT_INPUT: InputState = {
  item: null,
  existing: {},
  anvilUsesOverride: null,
  wanted: {},
  ownedBooks: [],
  extraItems: [],
  rename: false,
}

/** Settings that change the result */
export interface SessionState {
  readonly edition: Edition
  /** 39 = Survival, null = Creative (no limit) */
  readonly levelCap: 39 | null
  readonly objective: Objective
}

export type ThemePref = 'auto' | 'light' | 'dark'

/** auto follows prefers-reduced-motion and sets no html[data-motion]; the others override it. */
export type MotionPref = 'auto' | 'reduce' | 'full'

/** Per-device preferences, not part of share links */
export interface PrefsState {
  readonly lang: Lang
  readonly theme: ThemePref
  readonly motion: MotionPref
  readonly singleKeyShortcuts: boolean
}

/** As kept by the input history and the backup */
export interface InputDoc {
  readonly input: InputState
  readonly session: SessionState
}

export type EmptyReason = 'noItem' | 'noEnchantments'

export const DEFAULT_SESSION: SessionState = { edition: 'java', levelCap: 39, objective: 'levels' }

export const DEFAULT_PREFS: PrefsState = {
  lang: 'ja',
  theme: 'auto',
  motion: 'auto',
  singleKeyShortcuts: true,
}

/** For lists that need an order, unlike EnchantLevels */
export interface EnchantmentLevel {
  readonly id: EnchantmentId
  readonly level: number
}
