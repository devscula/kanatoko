// Focus targets, also used by the result panel. Fixed ids are safe because a page has only one input panel.

import type { EnchantmentId } from '../../../data/types.ts'

export const INPUT_IDS = {
  heading: 'input-heading',
  itemHeading: 'input-item-heading',
  itemCard: 'input-item-card',
  usesDisclosure: 'input-uses',
  usesStepper: 'input-uses-stepper',
  wantedHeading: 'input-wanted-heading',
  wantedSearch: 'input-wanted-search',
  groupSr: 'input-group-sr',
  maxAllDone: 'input-max-all-done',
  owned: 'input-owned',
  addBook: 'input-add-book',
  rename: 'input-rename',
  check: (id: EnchantmentId) => `input-ench-${id}`,
  name: (id: EnchantmentId) => `input-ench-name-${id}`,
  note: (id: EnchantmentId) => `input-ench-note-${id}`,
  /** key is the group's first member. */
  group: (key: EnchantmentId) => `input-group-${key}`,
  ownedRow: (uid: string) => `input-owned-${uid}`,
} as const

