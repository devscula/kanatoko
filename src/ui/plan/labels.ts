import type { Problem } from '../../engine/index.ts'
import { itemText, msg, type Text } from '../i18n/text.ts'
import type { InputView } from './builtProblem.ts'
import { isBookOnlyProblem, targetItemOf } from './displayPlan.ts'

/** Whether the item's anvil uses were inferred or entered */
export type UsesHow = 'auto' | 'entered'

export interface AssumptionContext {
  readonly anvilUsesOverride?: number | null
  readonly hasSupplements: boolean
}

export function usesHowOf(input: Pick<InputView, 'item'> & { readonly anvilUsesOverride?: number | null } | null): UsesHow {
  return input?.anvilUsesOverride == null ? 'auto' : 'entered'
}

/** The caller adds assume.bedrock for Bedrock Edition. */
export function assumptionParts(problem: Problem, context: AssumptionContext): Text[] {
  const parts: Text[] = []
  const item = targetItemOf(problem)
  if (isBookOnlyProblem(problem) || item === null) {
    parts.push(msg('assume.simpleBook'))
  } else {
    const target = problem.mode === 'advanced' ? problem.target : null
    const uses = target?.anvilUses ?? 0
    const fresh = uses === 0 && Object.keys(target?.enchantments ?? {}).length === 0
    if (fresh) parts.push(msg('assume.fresh', { item: itemText(item) }))
    else parts.push(msg('assume.uses', { item: itemText(item), n: uses, how: msg(`assume.how.${usesHowOf({ item, anvilUsesOverride: context.anvilUsesOverride })}`) }))
  }
  if (context.hasSupplements) parts.push(msg('assume.books'))
  parts.push(msg('assume.durability'))
  return parts
}

/** Without a context, books to get are assumed only for a simple problem. */
export function assumptionText(problem: Problem, context?: AssumptionContext): Text[] {
  return assumptionParts(problem, context ?? { hasSupplements: problem.mode === 'simple' })
}
