import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientResult, ComplexityEstimate, Problem, Settings, SolveProgress, SolverClient } from '../../engine/index.ts'
import { getFixture } from '../dev/fixtures.ts'
import { createTranslator } from '../i18n/render.ts'
import type { Text } from '../i18n/text.ts'
import type { EnchantmentId } from '../../data/types.ts'
import type { BuiltProblem } from '../state/buildProblem.ts'
import type { SolveInput } from '../state/selectors.ts'
import { DEFAULT_INPUT } from '../state/types.ts'
import { announcementFor, DEBOUNCE_MS, SLOW_MS, SolveController, STALE_MS } from './controller.ts'
import { createPlaceholderBackend, synthesizeResult } from './placeholderBackend.ts'
import type { SolverBackend } from './types.ts'

const ja = createTranslator({ lang: 'ja', edition: 'java' })
const boots = getFixture('bootsSevenBooks')

interface Pending {
  problem: Problem
  resolve: (r: ClientResult) => void
  onProgress?: (p: SolveProgress) => void
}

/** Client whose answers the test resolves by hand. */
function fakeBackend(level: ComplexityEstimate['level'] = 'instant') {
  const calls: Pending[] = []
  let cancels = 0
  const client: SolverClient = {
    solve(problem, _settings, onProgress) {
      return new Promise((resolve) => calls.push({ problem, resolve, onProgress }))
    },
    cancel() {
      cancels++
      calls.at(-1)?.resolve({ status: 'cancelled' })
    },
    dispose() {},
  }
  const backend: SolverBackend = {
    client,
    estimateComplexity: () => ({ complexity: 10, effectiveComplexity: 10, fastPathEligible: true, level, hardLimit: 1_200_000 }),
  }
  return { backend, calls, cancels: () => cancels }
}

const builtOf = (planId: string, problem: Problem, settings: Settings, fallback: readonly EnchantmentId[] = []): BuiltProblem => ({
  problem,
  settings,
  planId,
  inputSources: [],
  supplements: [],
  excluded: [],
  fallback,
  effectiveUses: { item: 0, books: [], extras: [] },
  coverage: {},
})

const ready = (planId: string, problem: Problem = boots.problem, settings: Settings = boots.settings, fallback: BuiltProblem | null = null): SolveInput => ({
  kind: 'ready',
  built: builtOf(planId, problem, settings),
  fallback,
  input: DEFAULT_INPUT,
  problem,
  settings,
  planId,
})

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('calculation timing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the request 150 ms after the last input', () => {
    const { backend, calls } = fakeBackend()
    const c = new SolveController({ backend })
    c.setInput(ready('a'))
    expect(c.getView().pending).toBe(true)
    vi.advanceTimersByTime(DEBOUNCE_MS - 1)
    expect(calls).toHaveLength(0)
    c.setInput(ready('b'))
    vi.advanceTimersByTime(DEBOUNCE_MS - 1)
    expect(calls).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(calls).toHaveLength(1)
  })

  it('turns stale at 300 ms and slow with an announcement at 1.5 s, then clears both on the result', async () => {
    const { backend, calls } = fakeBackend()
    const assist: Text[] = []
    const c = new SolveController({ backend, announceAssist: (t) => assist.push(t) })
    c.setInput(ready('a'))
    vi.advanceTimersByTime(DEBOUNCE_MS)
    vi.advanceTimersByTime(STALE_MS - 1)
    expect(c.getView().stale).toBe(false)
    vi.advanceTimersByTime(1)
    expect(c.getView().stale).toBe(true)
    // Progress is reported separately so components that read SolveView don't re-render
    let viewChanges = 0
    let progressChanges = 0
    c.subscribe(() => viewChanges++)
    c.subscribeProgress(() => progressChanges++)
    calls[0].onProgress?.({ type: 'progress', id: 1, phase: 'exact', done: 2, total: 5, elapsedMs: 100 })
    expect(c.getProgress()).toBeCloseTo(0.4)
    expect({ viewChanges, progressChanges }).toEqual({ viewChanges: 0, progressChanges: 1 })
    vi.advanceTimersByTime(SLOW_MS - STALE_MS)
    expect(c.getView().slow).toBe(true)
    expect(assist.map((t) => ja.text(t))).toEqual(['計算に時間がかかっています'])

    calls[0].resolve(boots.result)
    await flush()
    expect(c.getView()).toMatchObject({ pending: false, stale: false, slow: false })
    expect(c.getProgress()).toBeNull()
    expect(c.getView().outcome).toMatchObject({ kind: 'result', planId: 'a' })
  })

  it('sets slowPredicted when the estimate is slow', () => {
    const { backend } = fakeBackend('slow')
    const c = new SolveController({ backend })
    c.setInput(ready('a'))
    vi.advanceTimersByTime(DEBOUNCE_MS)
    expect(c.getView().slowPredicted).toBe(true)
  })

  it('skips the request when the estimate is too-complex', () => {
    const { backend, calls } = fakeBackend('too-complex')
    const c = new SolveController({ backend })
    c.setInput(ready('a'))
    vi.advanceTimersByTime(DEBOUNCE_MS)
    expect(calls).toHaveLength(0)
    const outcome = c.getView().outcome
    expect(outcome?.kind === 'result' && outcome.result.status).toBe('too-complex')
    expect(c.getView().pending).toBe(false)
  })

  it('re-solves an infeasible problem once with the fallback and shows that result when it works', async () => {
    const { backend, calls } = fakeBackend()
    const c = new SolveController({ backend })
    const infeasible = getFixture('infeasible')
    const retry = builtOf('b', boots.problem, boots.settings, ['mending'])
    c.setInput(ready('a', infeasible.problem, infeasible.settings, retry))
    vi.advanceTimersByTime(DEBOUNCE_MS)
    calls[0].resolve(infeasible.result)
    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1].problem).toBe(boots.problem)
    calls[1].resolve(boots.result)
    await flush()
    await flush()
    const outcome = c.getView().outcome
    expect(outcome?.kind === 'result' && outcome.result.status).toBe('ok')
    expect(outcome?.kind === 'result' && outcome.built.fallback).toEqual(['mending'])
    expect(outcome?.kind === 'result' && outcome.firstBuilt?.planId).toBe('a')
    expect(outcome?.kind === 'result' && outcome.planId).toBe('b')
  })

  it('shows the first result (owned items preferred) when the fallback is infeasible too', async () => {
    const { backend, calls } = fakeBackend()
    const c = new SolveController({ backend })
    const infeasible = getFixture('infeasible')
    c.setInput(ready('a', infeasible.problem, infeasible.settings, builtOf('b', boots.problem, boots.settings, ['mending'])))
    vi.advanceTimersByTime(DEBOUNCE_MS)
    calls[0].resolve(infeasible.result)
    await flush()
    calls[1].resolve(infeasible.result)
    await flush()
    await flush()
    const outcome = c.getView().outcome
    expect(outcome?.kind === 'result' && outcome.result.status).toBe('infeasible')
    expect(outcome?.kind === 'result' && outcome.planId).toBe('a')
    expect(outcome?.kind === 'result' && outcome.firstBuilt).toBeNull()
  })

  it('swaps in the new input and BuiltProblem without recalculating when the problem is unchanged', async () => {
    const { backend, calls } = fakeBackend()
    const c = new SolveController({ backend })
    c.setInput(ready('a'))
    vi.advanceTimersByTime(DEBOUNCE_MS)
    calls[0].resolve(boots.result)
    await flush()
    const base = ready('a')
    if (base.kind !== 'ready') throw new Error('not ready')
    const next = { ...base, input: { ...DEFAULT_INPUT, rename: true } }
    c.setInput(next)
    expect(calls).toHaveLength(1)
    const outcome = c.getView().outcome
    expect(outcome?.kind === 'result' && outcome.input).toBe(next.input)
    expect(outcome?.kind === 'result' && outcome.built).toBe(next.built)
  })

  it('suggests lowering a wanted level by one when an AdvancedProblem is infeasible', async () => {
    const { backend, calls } = fakeBackend()
    const c = new SolveController({ backend })
    const infeasible = getFixture('infeasible')
    const advanced: Problem = { mode: 'advanced', target: { itemType: 'boots', enchantments: {}, anvilUses: 5 }, extraItems: [], books: [], goal: { soul_speed: 3 }, useOnlyNeeded: true }
    const base = ready('a', advanced, boots.settings)
    if (base.kind !== 'ready') throw new Error('not ready')
    c.setInput({ ...base, input: { ...DEFAULT_INPUT, item: 'boots', existing: { frost_walker: 2 }, anvilUsesOverride: 5, wanted: { soul_speed: 3 } } })
    vi.advanceTimersByTime(DEBOUNCE_MS)
    calls[0].resolve(infeasible.result)
    await flush()
    expect(c.getView().extraSuggestions).toMatchObject({ planId: 'a', checking: true, items: [] })
    expect(calls).toHaveLength(2)
    calls[1].resolve({ ...boots.result, summary: { ...(boots.result as Extract<ClientResult, { status: 'ok' }>).summary, totalLevels: 39, maxStepLevels: 39 } } as ClientResult)
    await flush()
    await flush()
    expect(c.getView().extraSuggestions).toMatchObject({
      checking: false,
      complete: true,
      items: [{ code: 'lower-goal-level', enchantment: 'soul_speed', level: 2, totalLevels: 39, maxStepLevels: 39 }],
    })
  })

  it('shows the empty state right away and stops the running calculation', async () => {
    const { backend, calls, cancels } = fakeBackend()
    const c = new SolveController({ backend })
    c.setInput(ready('a'))
    vi.advanceTimersByTime(DEBOUNCE_MS)
    c.setInput({ kind: 'empty', reason: 'noEnchantments' })
    expect(cancels()).toBe(1)
    expect(c.getView().outcome).toEqual({ kind: 'empty', reason: 'noEnchantments' })
    calls[0].resolve(boots.result)
    await flush()
    expect(c.getView().outcome?.kind).toBe('empty')
  })

  it('stops the previous request on new input and ignores its answer', async () => {
    const { backend, calls } = fakeBackend()
    const c = new SolveController({ backend })
    c.setInput(ready('a'))
    vi.advanceTimersByTime(DEBOUNCE_MS)
    const first = calls[0]
    c.setInput(ready('b'))
    first.resolve(getFixture('bookOnly').result)
    await flush()
    expect(c.getView().outcome).toBeNull()
    vi.advanceTimersByTime(DEBOUNCE_MS)
    calls[1].resolve(boots.result)
    await flush()
    expect(c.getView().outcome).toMatchObject({ planId: 'b' })
  })

  it('keeps the previous result when cancelled and sends a new request on retry', async () => {
    const { backend, calls } = fakeBackend()
    const c = new SolveController({ backend })
    c.setInput(ready('a'))
    vi.advanceTimersByTime(DEBOUNCE_MS)
    calls[0].resolve(boots.result)
    await flush()
    c.setInput(ready('b'))
    vi.advanceTimersByTime(DEBOUNCE_MS + SLOW_MS)
    c.cancel()
    expect(c.getView()).toMatchObject({ cancelled: true, pending: false, stale: false, slow: false })
    expect(c.getView().outcome).toMatchObject({ planId: 'a' })
    c.retry()
    expect(calls).toHaveLength(3)
    expect(c.getView()).toMatchObject({ cancelled: false, pending: true })
  })

  it('counts consecutive failures for the same input', async () => {
    const { backend, calls } = fakeBackend()
    const c = new SolveController({ backend })
    const error: ClientResult = { status: 'error', cause: 'worker-crashed', message: 'x', retryable: true }
    c.setInput(ready('a'))
    vi.advanceTimersByTime(DEBOUNCE_MS)
    calls[0].resolve(error)
    await flush()
    expect(c.getView().failures).toBe(1)
    c.retry()
    calls[1].resolve(error)
    await flush()
    expect(c.getView().failures).toBe(2)
    c.retry()
    calls[2].resolve(boots.result)
    await flush()
    expect(c.getView().failures).toBe(0)
  })

  it('announces once when the result has settled 1 s after the last input', async () => {
    const { backend, calls } = fakeBackend()
    const c = new SolveController({ backend })
    c.setInput(ready('a'))
    vi.advanceTimersByTime(DEBOUNCE_MS + 50)
    calls[0].resolve(boots.result)
    await flush()
    expect(c.getView().announcement).toBeNull()
    vi.advanceTimersByTime(1000 - DEBOUNCE_MS - 50 - 1)
    expect(c.getView().announcement).toBeNull()
    vi.advanceTimersByTime(1)
    const first = c.getView().announcement
    expect(first && ja.text(first.text)).toBe('合計66レベル、1回の最大16レベル、7手順')
    // Another result for the same input is not announced again
    c.retry()
    calls[1].resolve(boots.result)
    await flush()
    vi.advanceTimersByTime(2000)
    expect(c.getView().announcement?.seq).toBe(first?.seq)
  })

  it('does not announce a result when the input changes before it settles', async () => {
    const { backend, calls } = fakeBackend()
    const c = new SolveController({ backend })
    c.setInput(ready('a'))
    vi.advanceTimersByTime(DEBOUNCE_MS)
    calls[0].resolve(boots.result)
    await flush()
    vi.advanceTimersByTime(500)
    c.setInput(ready('b'))
    vi.advanceTimersByTime(2000)
    expect(c.getView().announcement).toBeNull()
  })
})

describe('result announcement', () => {
  const infeasible = getFixture('infeasible')
  const base = infeasible.result as Extract<ClientResult, { status: 'infeasible' }>
  const announce = (result: ClientResult, levelCap: 39 | null) => {
    const settings = { ...infeasible.settings, levelCap }
    const text = announcementFor({
      kind: 'result',
      built: builtOf('x', infeasible.problem, settings),
      firstBuilt: null,
      input: DEFAULT_INPUT,
      problem: infeasible.problem,
      settings,
      planId: 'x',
      result: result as Exclude<ClientResult, { status: 'cancelled' }>,
    })
    return text === null ? null : ja.text(text)
  }

  it('uses the result column heading for infeasible results', () => {
    // Infeasible in Creative (the engine sets capExcluded when there is no cap)
    expect(announce({ ...base, reasons: [{ code: 'goal-enchantment-missing', enchantment: 'fortune' }], capExcluded: true }, null)).toBe('この入力では作れません')
    // Survival, with only a reason unrelated to the cap (goal-conflict)
    expect(announce({ ...base, reasons: [{ code: 'goal-conflict', a: 'sharpness', b: 'smite' }], capExcluded: true }, 39)).toBe('この入力では作れません')
    // Survival, too-expensive
    expect(announce(base, 39)).toBe('サバイバルでは作れません')
  })
})

describe('placeholder solver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the fixture result for matching input', async () => {
    const backend = createPlaceholderBackend({ delayMs: 50 })
    const promise = backend.client.solve(boots.problem, boots.settings)
    vi.advanceTimersByTime(50)
    const result = await promise
    expect(result.status === 'ok' && result.summary.totalLevels).toBe(66)
  })

  it('resolves the previous request as cancelled when a new one arrives', async () => {
    const backend = createPlaceholderBackend({ delayMs: 50 })
    const first = backend.client.solve(boots.problem, boots.settings)
    const second = backend.client.solve(boots.problem, boots.settings)
    expect(await first).toEqual({ status: 'cancelled' })
    vi.advanceTimersByTime(50)
    expect((await second).status).toBe('ok')
  })

  it('builds a valid plan for input without a fixture', () => {
    const problem: Problem = {
      mode: 'simple',
      item: 'sword',
      enchantments: [
        { id: 'sharpness', level: 5 },
        { id: 'looting', level: 3 },
        { id: 'unbreaking', level: 3 },
        { id: 'mending', level: 1 },
      ],
    }
    const result = synthesizeResult(problem, boots.settings)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.plan.steps.every((s) => s.cost.total <= 39)).toBe(true)
      expect(result.summary.finalEnchantments).toEqual({ looting: 3, mending: 1, sharpness: 5, unbreaking: 3 })
    }
  })

  it('reports input that cannot reach the goal as infeasible', () => {
    const problem: Problem = {
      mode: 'advanced',
      target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
      extraItems: [],
      books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0, count: 3 }],
      goal: { unbreaking: 3 },
      useOnlyNeeded: true,
    }
    const result = synthesizeResult(problem, boots.settings)
    expect(result.status === 'infeasible' && result.reasons[0].code).toBe('goal-level-unreachable')
  })
})
