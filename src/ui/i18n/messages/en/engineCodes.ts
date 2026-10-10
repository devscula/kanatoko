import type { engineCodes as ja } from '../ja/engineCodes.ts'

export const engineCodes = {
  'reason.goalNotInEdition': "{name} doesn't exist in {edition}.",
  'reason.goalNotApplicable': "{name} can't go on the {item}.",
  'reason.goalEnchantmentMissing': 'You have no {name} book.',
  'reason.goalConflict': "{a} and {b} can't be combined. Remove one from the goal.",
  'reason.goalConflictsWithTarget': "{name} conflicts with {existing} on the {item} (an anvil can't remove enchantments).",
  'reason.goalLevelUnreachable': 'You can only reach {name} {reachable}, not {required}.',
  'reason.targetPenaltyTooHigh': 'With a prior work penalty of {p}, every step on the {item} costs 40+ levels in Survival.',
  'reason.cannotUseAllInputs':
    'Not every book and spare can be used. Can\'t use: {list}.',
  'reason.noPlan': 'No working order was found for this input. Check your input.',

  'issue.itemNotInEdition': "{item} doesn't exist in {edition}.",
  'issue.enchantmentNotInEdition': "{name} doesn't exist in {edition}.",
  'issue.levelOutOfRange': '{name} goes up to {max}.',
  'issue.inputSelfConflict': "This has both {a} and {b}, which can't be combined.",
  'issue.notApplicableOnItemInput': "{name} can't be on the {item}.",
  'issue.emptyBook': 'This book has no enchantments.',
  'issue.anvilUsesOutOfRange': 'Anvil uses must be 0 to 10.',
  'issue.countOutOfRange': 'Copies must be 1 to 32.',
  'issue.targetIsBook': 'Choose Enchanted Book (merge books only) instead.',
  'issue.extraItemsWithoutTarget': 'Spare items need an item to enchant.',
  'issue.extraItemNotCombinable': "This item ({item}) has no durability, so two can't be combined.",
  'issue.duplicateSimpleEnchantment': '{name} is listed twice.',
  'issue.generic': 'Something in the input needs fixing.',

  'fix.reselectItem': 'Choose another item',
  'fix.remove': 'Remove',
  'fix.setLevel': 'Set to {max}',
  'fix.removeOne': 'Remove {b}',
  'fix.delete': 'Delete',
  'fix.setUses': 'Set to 10',
  'fix.setCount': 'Set to 32',
  'fix.reselect': 'Choose again',
  'fix.keepOne': 'Keep one',
} as const satisfies Record<keyof typeof ja, string>
