import { describe, expect, it } from 'vitest'
import { xpAtLevel } from '../../engine/index.ts'
import type { Plan, PlanSummary, SolveResult } from '../../engine/index.ts'
import { listProblemInputs } from '../plan/inputs.ts'
import { DEFAULT_SETTINGS, findFixture, getFixture, getFixtures, simCombine, simRenameOnly } from './fixtures.ts'

const keys = (s: PlanSummary) => [s.totalLevels, s.maxStepLevels, s.xpPoints, s.finalPriorWorkPenalty]

function okOf(result: SolveResult) {
  if (result.status !== 'ok') throw new Error(`status ${result.status}`)
  return result
}

/** Plan invariants the fixtures can check: step references, cost sums and summary values. */
function checkPlanShape(plan: Plan, summary: PlanSummary) {
  let cumulative = 0
  const consumed = new Map<number, number>()
  for (const step of plan.steps) {
    const c = step.cost
    const sum = c.leftPenalty + c.rightPenalty + c.enchantments.reduce((a, l) => a + l.cost, 0) + c.conflictPenalty + c.rename
    expect(c.clampedFrom === null ? c.total : 39).toBe(c.clampedFrom === null ? sum : c.total)
    cumulative += c.total
    expect(step.cumulativeLevels).toBe(cumulative)
    expect(step.xpPoints).toBe(xpAtLevel(c.total))
    for (const ref of [step.left, step.right]) {
      if (ref?.kind === 'step') {
        expect(ref.step).toBeLessThan(step.index)
        consumed.set(ref.step, step.index)
      }
    }
  }
  for (const step of plan.steps) expect(step.consumedBy).toBe(consumed.get(step.index) ?? null)
  expect(plan.steps.filter((s) => s.consumedBy === null)).toHaveLength(plan.steps.length === 0 ? 0 : 1)
  expect(summary.totalLevels).toBe(cumulative)
  expect(summary.xpPoints).toBe(plan.steps.reduce((a, s) => a + s.xpPoints, 0))
  expect(summary.finalPriorWorkPenalty).toBe(2 ** plan.final.anvilUses - 1)
}

describe('fixture values', () => {
  it('gives [66, 16, 1246, 15] for boots and seven max-level books, and 65 levels at the seventh book one at a time', () => {
    const r = okOf(getFixture('bootsSevenBooks').result)
    expect(keys(r.summary)).toEqual([66, 16, 1246, 15])
    expect(r.summary.finalAnvilUses).toBe(4)
    expect(r.baseline).toMatchObject({
      stepCosts: [12, 13, 9, 11, 19, 34, 65],
      totalLevels: 163,
      firstTooExpensiveStep: 7,
      comparable: false,
      savedLevels: null,
    })
  })

  it('gives [67, 16, 1253, 15] over 8 steps with rename', () => {
    const r = okOf(getFixture('bootsRename').result)
    expect(keys(r.summary)).toEqual([67, 16, 1253, 15])
    expect(r.plan.steps[0]).toMatchObject({ kind: 'rename', right: null })
    expect(r.plan.final.named).toBe(true)
  })

  it('gives the same values plus bedrock-rules-from-wiki in Bedrock Edition', () => {
    const r = okOf(getFixture('bootsBedrock').result)
    expect(keys(r.summary)).toEqual([66, 16, 1246, 15])
    expect(r.warnings).toContainEqual({ code: 'bedrock-rules-from-wiki' })
    expect(r.assumptions.rulesBasis).toBe('bedrock-26.5x-wiki')
  })

  it('gives [49, 12, 793, 15] for books only, with an apply cost of 58 that is too expensive', () => {
    const r = okOf(getFixture('bookOnly').result)
    expect(keys(r.summary)).toEqual([49, 12, 793, 15])
    expect(r.summary.applyToFreshItem).toEqual({ cost: 58, tooExpensive: true })
    expect(r.warnings).toContainEqual({ code: 'final-book-too-expensive-to-apply', cost: 58 })
  })

  it('gives [26, 12, 448, 15] in advanced mode, against 38 one book at a time', () => {
    const r = okOf(getFixture('advancedUnused').result)
    expect(keys(r.summary)).toEqual([26, 12, 448, 15])
    expect(r.plan.unusedInputs).toEqual([4, 5])
    expect(r.baseline).toMatchObject({ stepCosts: [9, 12, 17], totalLevels: 38, comparable: true, savedLevels: 12 })
    expect(r.warnings).toContainEqual({ code: 'inputs-unused', inputs: [4, 5] })
  })

  it('reports 55 in total and 47 at most without a cap when infeasible, and suggests dropping fortune for 41 and 39', () => {
    const r = getFixture('infeasible').result
    if (r.status !== 'infeasible' || r.reference === null) throw new Error('expected an infeasible result with a reference')
    expect(r.reasons[0]).toMatchObject({ code: 'too-expensive', uncappedTotal: 55, uncappedMaxStep: 47, minAchievableMaxStep: 47 })
    expect(keys(r.reference.summary).slice(0, 2)).toEqual([55, 47])
    expect(r.reference.plan.steps.map((s) => s.tooExpensive)).toEqual([false, false, true])
    expect(r.suggestions).toEqual([{ code: 'drop-goal-enchantment', enchantment: 'fortune', totalLevels: 41, maxStepLevels: 39 }])
  })

  it('has a 47-level step and steps-over-survival-limit in Creative', () => {
    const r = okOf(getFixture('creative40').result)
    expect(r.summary.maxStepLevels).toBe(47)
    expect(r.warnings).toContainEqual({ code: 'steps-over-survival-limit', steps: [3] })
  })

  it('covers the too-complex, invalid and empty results', () => {
    expect(getFixture('tooComplex').result).toMatchObject({ status: 'too-complex', cause: 'complexity-limit', reference: null })
    expect(getFixture('invalid').result).toMatchObject({ status: 'invalid' })
    expect(getFixture('empty').result).toEqual({ status: 'empty' })
  })
})

describe('fixture shape', () => {
  it('keeps cost sums, references and summaries consistent in every plan', () => {
    for (const fixture of Object.values(getFixtures())) {
      const r = fixture.result
      if (r.status === 'ok') checkPlanShape(r.plan, r.summary)
      if ((r.status === 'infeasible' || r.status === 'too-complex') && r.reference) checkPlanShape(r.reference.plan, r.reference.summary)
    }
  })

  it('has no step of 40 levels or more in any Survival ok fixture', () => {
    for (const fixture of Object.values(getFixtures())) {
      if (fixture.result.status === 'ok' && fixture.settings.levelCap === 39) {
        expect(fixture.result.plan.steps.every((s) => s.cost.total <= 39 && !s.tooExpensive)).toBe(true)
      }
    }
  })

  it('splits every input into used or unused', () => {
    for (const fixture of Object.values(getFixtures())) {
      if (fixture.result.status !== 'ok') continue
      const all = listProblemInputs(fixture.problem).map((_, i) => i)
      expect([...fixture.result.plan.usedInputs, ...fixture.result.plan.unusedInputs].sort((a, b) => a - b)).toEqual(all)
    }
  })

  it('finds a fixture by input and settings', () => {
    const boots = getFixture('bootsSevenBooks')
    expect(findFixture(boots.problem, boots.settings)?.name).toBe('bootsSevenBooks')
    expect(findFixture(boots.problem, { ...boots.settings, objective: 'xp' })).toBeNull()
  })
})

describe('anvil rule copy', () => {
  const item = (itemType: 'sword' | 'boots' | 'trident', enchantments = {}, anvilUses = 0) =>
    ({ kind: 'item', itemType, enchantments, anvilUses, named: false }) as const
  const book = (enchantments: Record<string, number>, anvilUses = 0) =>
    ({ kind: 'book', itemType: null, enchantments, anvilUses, named: false }) as const

  it('adds 1 per conflict in Java Edition and nothing in Bedrock Edition', () => {
    const left = item('trident', { loyalty: 3, channeling: 1 })
    const right = book({ riptide: 3, unbreaking: 3 })
    const java = simCombine(DEFAULT_SETTINGS, left, right, false)
    const bedrock = simCombine({ ...DEFAULT_SETTINGS, edition: 'bedrock' }, left, right, false)
    expect(java.ok && java.cost.conflictPenalty).toBe(2)
    expect(java.ok && java.cost.total).toBe(5)
    expect(bedrock.ok && bedrock.cost.total).toBe(3)
  })

  it('raises two equal levels by one, up to the max level', () => {
    const out = simCombine(DEFAULT_SETTINGS, book({ sharpness: 4 }), book({ sharpness: 4 }), false)
    expect(out.ok && out.result.enchantments).toEqual({ sharpness: 5 })
    expect(out.ok && out.cost.total).toBe(5)
  })

  it('refuses an item as the sacrifice for a book and refuses a step over the level cap', () => {
    expect(simCombine(DEFAULT_SETTINGS, book({ mending: 1 }), item('sword'), false).ok).toBe(false)
    expect(simCombine(DEFAULT_SETTINGS, item('boots', {}, 5), book({ thorns: 3 }), false)).toMatchObject({ ok: false, reason: 'too-expensive' })
  })

  it('caps a rename-only step at 39 in Java Edition and refuses it in Bedrock Edition', () => {
    const boots = item('boots', { unbreaking: 3 }, 6)
    const java = simRenameOnly(DEFAULT_SETTINGS, boots)
    expect(java.ok && [java.cost.total, java.cost.clampedFrom]).toEqual([39, 64])
    expect(simRenameOnly({ ...DEFAULT_SETTINGS, edition: 'bedrock' }, boots).ok).toBe(false)
  })
})
