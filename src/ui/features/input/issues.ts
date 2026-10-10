import type { EnchantmentId } from '../../../data/types.ts'
import type { ValidationIssue } from '../../../engine/index.ts'
import type { BuiltProblem } from '../../state/buildProblem.ts'
import type { InputState } from '../../state/types.ts'

export interface InputIssues {
  readonly item: readonly ValidationIssue[]
  readonly wanted: ReadonlyMap<EnchantmentId, readonly ValidationIssue[]>
  /** Keyed by the uid of the owned book or spare row. */
  readonly rows: ReadonlyMap<string, readonly ValidationIssue[]>
  readonly count: number
}

export const NO_ISSUES: InputIssues = { item: [], wanted: new Map(), rows: new Map(), count: 0 }

function push<K>(map: Map<K, ValidationIssue[]>, key: K, issue: ValidationIssue) {
  const list = map.get(key) ?? []
  list.push(issue)
  map.set(key, list)
}

export function sortIssues(issues: readonly ValidationIssue[], built: BuiltProblem, input: InputState): InputIssues {
  const item: ValidationIssue[] = []
  const wanted = new Map<EnchantmentId, ValidationIssue[]>()
  const rows = new Map<string, ValidationIssue[]>()
  const { problem, inputSources } = built
  const hasTarget = inputSources[0]?.kind === 'target'
  const extrasCount = problem.mode === 'advanced' ? problem.extraItems.length : 0
  // inputSources lists the target, then the spares, then every copy of every book.
  const bookSource = (index: number) => {
    if (problem.mode !== 'advanced') return undefined
    let offset = (hasTarget ? 1 : 0) + extrasCount
    for (let i = 0; i < index; i++) offset += problem.books[i]?.count ?? 1
    return inputSources[offset]
  }
  for (const issue of issues) {
    const where = 'where' in issue ? issue.where : null
    if (where === null || where.part === 'item' || where.part === 'target') {
      item.push(issue)
      continue
    }
    if (where.part === 'goal' || where.part === 'simple') {
      push(wanted, where.enchantment, issue)
      continue
    }
    const source = where.part === 'extraItem' ? inputSources[(hasTarget ? 1 : 0) + where.index] : bookSource(where.index)
    const uid =
      source?.kind === 'owned' ? input.ownedBooks[source.index]?.uid : source?.kind === 'extra' ? input.extraItems[source.index]?.uid : undefined
    if (uid === undefined) item.push(issue)
    else push(rows, uid, issue)
  }
  return { item, wanted, rows, count: issues.length }
}
