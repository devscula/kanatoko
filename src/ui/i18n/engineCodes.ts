// Warning codes are not mapped here: the result components that hold their values pick the messages
// (features/result/notices.ts, StepCard, InfeasiblePanel).

import { maxLevel } from '../../data/gameData.ts'
import type { Edition, ItemTypeId } from '../../data/types.ts'
import type { FailureReason, ValidationIssue } from '../../engine/index.ts'
import type { MessageKey } from './messages/index.ts'
import { dynamicMsg, editionText, enchText, itemText, listText, msg, romanText, type Text, type TextArg } from './text.ts'

export const VALIDATION_ISSUE_KEYS = {
  'item-not-in-edition': 'issue.itemNotInEdition',
  'enchantment-not-in-edition': 'issue.enchantmentNotInEdition',
  'level-out-of-range': 'issue.levelOutOfRange',
  'input-self-conflict': 'issue.inputSelfConflict',
  'not-applicable-on-item-input': 'issue.notApplicableOnItemInput',
  'empty-book': 'issue.emptyBook',
  'anvil-uses-out-of-range': 'issue.anvilUsesOutOfRange',
  'count-out-of-range': 'issue.countOutOfRange',
  'target-is-book': 'issue.targetIsBook',
  'extra-items-without-target': 'issue.extraItemsWithoutTarget',
  'extra-item-not-combinable': 'issue.extraItemNotCombinable',
  'duplicate-simple-enchantment': 'issue.duplicateSimpleEnchantment',
} as const satisfies Record<ValidationIssue['code'], MessageKey>

export const VALIDATION_FIX_KEYS = {
  'item-not-in-edition': 'fix.reselectItem',
  'enchantment-not-in-edition': 'fix.remove',
  'level-out-of-range': 'fix.setLevel',
  'input-self-conflict': 'fix.removeOne',
  'not-applicable-on-item-input': 'fix.remove',
  'empty-book': 'fix.delete',
  'anvil-uses-out-of-range': 'fix.setUses',
  'count-out-of-range': 'fix.setCount',
  'target-is-book': 'fix.reselect',
  'extra-items-without-target': 'fix.delete',
  'extra-item-not-combinable': 'fix.delete',
  'duplicate-simple-enchantment': 'fix.keepOne',
} as const satisfies Record<ValidationIssue['code'], MessageKey | null>

export interface ReasonContext {
  readonly edition: Edition
  /** Null when merging books only */
  readonly itemType: ItemTypeId | null
  /** Takes an index into NormalizedProblem.inputs */
  readonly inputLabel: (input: number) => TextArg
}

const itemArg = (itemType: ItemTypeId | null): TextArg => (itemType === null ? itemText('enchanted_book') : itemText(itemType))

export function describeFailureReason(reason: FailureReason, ctx: ReasonContext): Text {
  switch (reason.code) {
    case 'goal-not-in-edition':
      return msg('reason.goalNotInEdition', { name: enchText(reason.enchantment), edition: editionText(ctx.edition) })
    case 'goal-not-applicable':
      return msg('reason.goalNotApplicable', { name: enchText(reason.enchantment), item: itemArg(ctx.itemType) })
    case 'goal-enchantment-missing':
      return msg('reason.goalEnchantmentMissing', { name: enchText(reason.enchantment) })
    case 'goal-conflict':
      return msg('reason.goalConflict', { a: enchText(reason.a), b: enchText(reason.b) })
    case 'goal-conflicts-with-target':
      return msg('reason.goalConflictsWithTarget', {
        item: itemArg(ctx.itemType),
        existing: enchText(reason.existing),
        name: enchText(reason.enchantment),
      })
    case 'goal-level-unreachable':
      return msg('reason.goalLevelUnreachable', {
        name: enchText(reason.enchantment),
        reachable: romanText(reason.reachable),
        required: romanText(reason.required),
      })
    case 'target-penalty-too-high':
      return msg('reason.targetPenaltyTooHigh', { item: itemArg(ctx.itemType), p: reason.priorWorkPenalty })
    case 'too-expensive':
      return reason.minAchievableMaxStep === null
        ? msg('infeasible.tooExpensive.noValue')
        : msg('infeasible.tooExpensive', { c: reason.minAchievableMaxStep })
    case 'cannot-use-all-inputs':
      return msg('reason.cannotUseAllInputs', { list: listText(reason.unusable.map(ctx.inputLabel)) })
    case 'no-plan':
      return msg('reason.noPlan')
    default:
      return msg('reason.noPlan')
  }
}

export interface IssueContext {
  readonly edition: Edition
  /** The target, a spare item, or the new item in simple mode, whichever input has the issue */
  readonly itemType: ItemTypeId | null
}

export function describeValidationIssue(issue: ValidationIssue, ctx: IssueContext): Text {
  switch (issue.code) {
    case 'item-not-in-edition':
      return msg('issue.itemNotInEdition', { item: itemText(issue.itemType), edition: editionText(ctx.edition) })
    case 'enchantment-not-in-edition':
      return msg('issue.enchantmentNotInEdition', { name: enchText(issue.enchantment), edition: editionText(ctx.edition) })
    case 'level-out-of-range':
      return msg('issue.levelOutOfRange', { name: enchText(issue.enchantment), max: romanText(issue.maxLevel) })
    case 'input-self-conflict':
      return msg('issue.inputSelfConflict', { a: enchText(issue.a), b: enchText(issue.b) })
    case 'not-applicable-on-item-input':
      return msg('issue.notApplicableOnItemInput', { name: enchText(issue.enchantment), item: itemArg(ctx.itemType) })
    case 'extra-item-not-combinable':
      return msg('issue.extraItemNotCombinable', { item: itemText(issue.itemType) })
    case 'duplicate-simple-enchantment':
      return msg('issue.duplicateSimpleEnchantment', { name: enchText(issue.enchantment) })
    case 'empty-book':
    case 'anvil-uses-out-of-range':
    case 'count-out-of-range':
    case 'target-is-book':
    case 'extra-items-without-target':
      return dynamicMsg(VALIDATION_ISSUE_KEYS[issue.code])
    default:
      return msg('issue.generic')
  }
}

export function validationFixLabel(issue: ValidationIssue): Text | null {
  switch (issue.code) {
    case 'level-out-of-range':
      return msg('fix.setLevel', { max: romanText(Math.min(issue.maxLevel, maxLevel(issue.enchantment))) })
    case 'input-self-conflict':
      return msg('fix.removeOne', { b: enchText(issue.b) })
    default: {
      const key: MessageKey | undefined = VALIDATION_FIX_KEYS[issue.code]
      return key === undefined ? null : dynamicMsg(key)
    }
  }
}
