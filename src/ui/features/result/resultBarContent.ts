import type { PlanSummary } from '../../../engine/index.ts'
import { msg, type Text } from '../../i18n/text.ts'
import type { SolveView } from '../../solver/types.ts'
import { infeasibleTitleKey } from '../../solver/infeasibleTitle.ts'

export type ResultBarContent =
  | { readonly kind: 'figures'; readonly summary: Pick<PlanSummary, 'totalLevels' | 'maxStepLevels'>; readonly steps: number }
  | { readonly kind: 'text'; readonly text: Text; readonly action: Text }

export function resultBarContent(view: Pick<SolveView, 'outcome' | 'stale'>): ResultBarContent | null {
  const { outcome } = view
  if (outcome === null || outcome.kind !== 'result') return null
  const { result } = outcome
  if (view.stale) return { kind: 'text', text: msg('compute.busy'), action: msg('resultBar.show') }
  const why = (text: Text): ResultBarContent => ({ kind: 'text', text, action: msg('resultBar.why') })
  switch (result.status) {
    case 'ok':
      return result.plan.steps.length > 0 ? { kind: 'figures', summary: result.summary, steps: result.plan.steps.length } : null
    case 'infeasible':
      return why(msg(infeasibleTitleKey(result)))
    case 'too-complex':
      return why(msg(result.cause === 'complexity-limit' ? 'tooComplex.title' : 'tooComplex.titleTimeout'))
    case 'invalid':
      return why(msg('resultBar.invalid'))
    case 'error':
      return why(msg('resultBar.error'))
    case 'empty':
      return null
  }
}
