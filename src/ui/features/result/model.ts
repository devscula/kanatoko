import type { Edition, Lang } from '../../../data/types.ts'
import { SURVIVAL_LEVEL_CAP } from '../../../engine/index.ts'
import type { ObjectState, Plan, Problem, StepCost, Warning, WarningCode } from '../../../engine/index.ts'
import { enchText, msg, type Text } from '../../i18n/text.ts'
import type { DisplayPlan, DisplayStep } from '../../plan/displayPlan.ts'

/** Also the number of gauge cells */
export const LEVEL_CAP = SURVIVAL_LEVEL_CAP

export const GAUGE_FROM = 30

export function findWarning<C extends WarningCode>(warnings: readonly Warning[], code: C): Extract<Warning, { readonly code: C }> | undefined {
  return warnings.find((w): w is Extract<Warning, { readonly code: C }> => w.code === code)
}

// The display plan does not carry the state after a step, so it comes from the engine plan
export function stepAfter(plan: Plan, step: DisplayStep): ObjectState | null {
  return plan.steps[step.engineIndex - 1]?.after ?? null
}

export function isFinalStep(plan: DisplayPlan, step: DisplayStep): boolean {
  return step.no === plan.steps.length
}

export function extraEnchantmentTexts(plan: DisplayPlan): Text[] {
  return plan.extraEnchantments.map((id) => enchText(id, plan.summary.finalEnchantments[id]))
}

/** Only mismatch.priorWork takes values */
export type MismatchKey =
  | 'mismatch.swap'
  | 'mismatch.wrongBook'
  | 'mismatch.priorWork'
  | 'mismatch.renameTyped'
  | 'mismatch.renameMissing'
  | 'mismatch.repair'
  | 'mismatch.bedrock'

export function mismatchKeys(step: DisplayStep, mode: Problem['mode'], edition: Edition): MismatchKey[] {
  const keys: MismatchKey[] = ['mismatch.swap']
  if (step.right !== null && !step.rightIsItem) keys.push('mismatch.wrongBook')
  // The anvil uses check reads the same for every input mode
  void mode
  keys.push('mismatch.priorWork')
  keys.push(step.renameHere ? 'mismatch.renameMissing' : 'mismatch.renameTyped')
  if (step.rightIsItem) keys.push('mismatch.repair')
  if (edition === 'bedrock') keys.push('mismatch.bedrock')
  return keys
}

export function showsGauge(step: DisplayStep): boolean {
  return step.cost.total >= GAUGE_FROM || step.tooExpensive
}

export function gaugeNote(cost: number): Text | null {
  if (cost === LEVEL_CAP) return msg('gauge.exact')
  if (cost >= 35 && cost < LEVEL_CAP) return msg('gauge.near', { n: LEVEL_CAP - cost })
  return null
}

export function enchantmentCost(cost: StepCost): number {
  return cost.enchantments.reduce((sum, line) => sum + line.cost, 0)
}

export function complexityRatio(effective: number, hardLimit: number): number {
  const ratio = effective / hardLimit
  return ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10
}

// Each distinct book removed cuts the work to roughly a third
export function booksToRemove(effective: number, hardLimit: number): number {
  // Without the offset, floating-point error can round an exact power of 3 up by one book
  return Math.max(1, Math.ceil(Math.log(effective / hardLimit) / Math.log(3) - 1e-9))
}

// The badge by the heading is enough unless ComputeStatus shows its card
export function showsBusyBadge(solve: { readonly stale: boolean; readonly slow: boolean; readonly slowPredicted: boolean }): boolean {
  return solve.stale && !solve.slow && !solve.slowPredicted
}

/** Reference steps use 'ref-step' */
export const STEP_ID_PREFIX = 'step'

export const stepCardId = (idPrefix: string, no: number): string => `${idPrefix}-${no}`

export const stepHeadingId = (idPrefix: string, no: number): string => `${stepCardId(idPrefix, no)}-heading`

export const WIKI_URLS: Readonly<Record<Lang, string>> = {
  ja: 'https://ja.minecraft.wiki/w/%E9%87%91%E5%BA%8A%E3%81%AE%E4%BB%95%E7%B5%84%E3%81%BF',
  en: 'https://minecraft.wiki/w/Anvil_mechanics',
}
