import { assumptionsFor } from '../../engine/index.ts'
import type { ClientResult, ComplexityEstimate, Settings, SolveOk, SolveTooComplex, Suggestion } from '../../engine/index.ts'
import { compareTooltipOrder } from '../../data/tooltipOrder.ts'
import type { EnchantmentId } from '../../data/types.ts'
import { buildProblem, canFallback, type BuiltProblem } from '../state/buildProblem.ts'
import type { InputState } from '../state/types.ts'
import { msg, type Text } from '../i18n/text.ts'
import type { SolveInput } from '../state/selectors.ts'
import { infeasibleTitleKey } from './infeasibleTitle.ts'
import type { SolveActions, SolveOutcome, SolverBackend, SolveView } from './types.ts'

export const DEBOUNCE_MS = 150
export const STALE_MS = 300
export const SLOW_MS = 1500
export const ANNOUNCE_AFTER_MS = 1000

export const INITIAL_VIEW: SolveView = {
  outcome: null,
  pending: false,
  stale: false,
  slow: false,
  slowPredicted: false,
  cancelled: false,
  failures: 0,
  estimate: null,
  extraSuggestions: null,
  announcement: null,
}

// Limits for the "lower a wanted level by one" suggestions
export const LOWER_LEVEL_MAX_CANDIDATES = 8
export const LOWER_LEVEL_BUDGET_MS = 2000

export function tooComplexFromEstimate(estimate: ComplexityEstimate, settings: Settings): SolveTooComplex {
  return {
    status: 'too-complex',
    complexity: estimate,
    cause: 'complexity-limit',
    reference: null,
    assumptions: assumptionsFor(settings),
    warnings: [],
    stats: { elapsedMs: 0, fastPath: null, exact: null, diagnosticsMs: null },
  }
}

export function announcementFor(outcome: SolveOutcome | null): Text | null {
  if (outcome === null || outcome.kind !== 'result') return null
  const { result } = outcome
  switch (result.status) {
    case 'ok':
      return msg('a11y.resultAnnounce', {
        t: result.summary.totalLevels,
        m: result.summary.maxStepLevels,
        k: result.summary.anvilOperations,
      })
    case 'infeasible':
      // Same text as the heading on screen
      return msg(infeasibleTitleKey(result))
    case 'too-complex':
      return msg('tooComplex.title')
    default:
      return null
  }
}

const keyOf = (input: SolveInput): string => (input.kind === 'ready' ? `${input.planId}:${input.fallback?.planId ?? '-'}` : `empty:${input.reason}`)

function outcomeOf(
  result: Exclude<ClientResult, { readonly status: 'cancelled' }>,
  input: Extract<SolveInput, { kind: 'ready' }>,
  built: BuiltProblem = input.built,
  firstBuilt: BuiltProblem | null = null,
): SolveOutcome {
  return {
    kind: 'result',
    result,
    built,
    firstBuilt,
    input: input.input,
    problem: built.problem,
    settings: built.settings,
    planId: built.planId,
  }
}

type Timer = ReturnType<typeof setTimeout>

export interface SolveControllerOptions {
  readonly backend: SolverBackend
  /** Puts text in the secondary live region */
  readonly announceAssist?: (text: Text) => void
  readonly now?: () => number
}

export class SolveController implements SolveActions {
  readonly #backend: SolverBackend
  readonly #announceAssist: (text: Text) => void
  readonly #now: () => number
  readonly #listeners = new Set<() => void>()
  readonly #progressListeners = new Set<() => void>()
  readonly #disposers: (() => void)[] = []

  #view: SolveView = INITIAL_VIEW
  /** 0 to 1, or null when unknown or idle */
  #progress: number | null = null
  #input: SolveInput | null = null
  #inputKey: string | null = null
  #lastInputAt = 0
  // Answers to replaced or stopped requests carry an old token and are dropped
  #token = 0
  #running = false
  #debounce: Timer | null = null
  #staleTimer: Timer | null = null
  #slowTimer: Timer | null = null
  #announceTimer: Timer | null = null
  #announceSeq = 0
  #announcedKey: string | null = null
  #lastFailureKey: string | null = null

  constructor(options: SolveControllerOptions) {
    this.#backend = options.backend
    this.#announceAssist = options.announceAssist ?? (() => {})
    this.#now = options.now ?? (() => Date.now())
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  readonly getView = (): SolveView => this.#view

  readonly subscribeProgress = (listener: () => void): (() => void) => {
    this.#progressListeners.add(listener)
    return () => this.#progressListeners.delete(listener)
  }

  readonly getProgress = (): number | null => this.#progress

  /** An input that yields the same problem does not start a new calculation. */
  setInput(input: SolveInput): void {
    const key = keyOf(input)
    if (key === this.#inputKey) {
      this.#refreshSameProblem(input)
      return
    }
    this.#input = input
    this.#inputKey = key
    this.#lastInputAt = this.#now()
    this.#stopRequest()
    this.#clear('debounce')
    this.#clear('announce')
    if (input.kind === 'empty') {
      this.#update({
        outcome: { kind: 'empty', reason: input.reason },
        extraSuggestions: null,
        pending: false,
        cancelled: false,
        estimate: null,
        slowPredicted: false,
      })
      return
    }
    this.#update({ pending: true, cancelled: false, extraSuggestions: null })
    this.#debounce = setTimeout(() => {
      this.#debounce = null
      this.#dispatch()
    }, DEBOUNCE_MS)
  }

  readonly cancel = (): void => {
    if (!this.#running) return
    this.#stopRequest()
    this.#update({ pending: false, cancelled: true })
  }

  readonly retry = (): void => {
    if (this.#input?.kind !== 'ready') return
    this.#stopRequest()
    this.#clear('debounce')
    this.#update({ pending: true, cancelled: false, extraSuggestions: null })
    this.#dispatch()
  }

  onDispose(dispose: () => void): void {
    this.#disposers.push(dispose)
  }

  dispose(): void {
    this.#stopRequest()
    this.#clear('debounce')
    this.#clear('announce')
    for (const dispose of this.#disposers.splice(0)) dispose()
    this.#listeners.clear()
    this.#progressListeners.clear()
  }

  #dispatch(): void {
    const input = this.#input
    if (input?.kind !== 'ready') return
    const { built, fallback } = input
    const { problem, settings } = built
    const estimate = this.#estimate(built)
    if (estimate?.level === 'too-complex') {
      this.#settle(outcomeOf(tooComplexFromEstimate(estimate, settings), input), estimate)
      return
    }
    const token = ++this.#token
    this.#running = true
    this.#setProgress(null)
    this.#update({ estimate, slowPredicted: estimate?.level === 'slow', stale: false, slow: false })
    this.#staleTimer = setTimeout(() => {
      this.#staleTimer = null
      this.#update({ stale: true })
    }, STALE_MS)
    this.#slowTimer = setTimeout(() => {
      this.#slowTimer = null
      this.#update({ slow: true })
      this.#announceAssist(msg('compute.slowAnnounce'))
    }, SLOW_MS)
    void this.#backend.client
      .solve(problem, settings, (p) => {
        if (token === this.#token) this.#setProgress(p.total > 0 ? Math.min(1, p.done / p.total) : null)
      })
      .then(async (result: ClientResult) => {
        if (token !== this.#token || result.status === 'cancelled') return
        // Retry with new books even for enchantments the owned items could provide, and show that result if it works
        if (result.status === 'infeasible' && fallback !== null) {
          const retry = await this.#solveFallback(fallback, token)
          if (token !== this.#token) return
          if (retry !== null) {
            this.#finish()
            this.#settle(outcomeOf(retry, input, fallback, built), estimate)
            return
          }
        }
        this.#finish()
        this.#settle(outcomeOf(result, input), estimate)
        if (result.status === 'infeasible' && input.built.problem.mode === 'advanced') void this.#lowerLevelSuggestions(input, token)
      })
  }

  /**
   * Re-solves with one wanted level lowered by one, including the fallback retry, and suggests the ones that can be
   * made. Candidates estimated slower than 'ok' are skipped and mark the list incomplete.
   */
  async #lowerLevelSuggestions(input: Extract<SolveInput, { kind: 'ready' }>, token: number): Promise<void> {
    const planId = input.planId
    const session = { edition: input.settings.edition, levelCap: input.settings.levelCap, objective: input.settings.objective }
    const candidates = (Object.entries(input.input.wanted) as [EnchantmentId, number][])
      .filter(([, level]) => level >= 2)
      .sort((a, b) => compareTooltipOrder(a[0], b[0]))
    let complete = candidates.length <= LOWER_LEVEL_MAX_CANDIDATES
    const items: Extract<Suggestion, { code: 'lower-goal-level' }>[] = []
    const publish = (checking: boolean) => {
      if (token !== this.#token) return
      const sorted = [...items].sort((a, b) => a.totalLevels - b.totalLevels)
      this.#update({ extraSuggestions: { planId, checking, complete, items: sorted } })
    }
    if (candidates.length === 0) return
    publish(true)
    const started = this.#now()
    for (const [enchantment, level] of candidates.slice(0, LOWER_LEVEL_MAX_CANDIDATES)) {
      if (token !== this.#token) return
      if (this.#now() - started > LOWER_LEVEL_BUDGET_MS) {
        complete = false
        break
      }
      const lowered: InputState = { ...input.input, wanted: { ...input.input.wanted, [enchantment]: level - 1 } }
      const built = buildProblem(lowered, session)
      if (built === null) continue
      const estimate = this.#estimate(built)
      if (estimate !== null && estimate.level !== 'instant' && estimate.level !== 'ok') {
        complete = false
        continue
      }
      let result = await this.#backend.client.solve(built.problem, built.settings)
      if (token !== this.#token || result.status === 'cancelled') return
      if (result.status === 'infeasible' && canFallback(built)) {
        const fallback = buildProblem(lowered, session, { fallback: true })
        if (fallback !== null) result = (await this.#solveFallback(fallback, token)) ?? result
        if (token !== this.#token) return
      }
      if (result.status === 'ok') {
        items.push({ code: 'lower-goal-level', enchantment, level: level - 1, totalLevels: result.summary.totalLevels, maxStepLevels: result.summary.maxStepLevels })
        publish(true)
      } else if (result.status !== 'infeasible') {
        complete = false
      }
    }
    publish(false)
  }

  /**
   * The input changed without changing the problem, as when an owned book excluded from the calculation is added or
   * removed. Keeps the result but swaps in the new input and BuiltProblem so the unused list stays current.
   */
  #refreshSameProblem(input: SolveInput): void {
    const previous = this.#input
    this.#input = input
    if (input.kind !== 'ready' || previous === input) return
    const { outcome } = this.#view
    if (outcome?.kind !== 'result' || outcome.input === input.input) return
    const built = outcome.firstBuilt === null ? input.built : (input.fallback ?? outcome.built)
    const firstBuilt = outcome.firstBuilt === null ? null : input.built
    this.#update({ outcome: { ...outcome, input: input.input, built, firstBuilt } })
  }

  // A failed estimate does not block the calculation; the Worker checks the problem again.
  #estimate(built: BuiltProblem): ComplexityEstimate | null {
    try {
      return this.#backend.estimateComplexity(built.problem, built.settings)
    } catch {
      return null
    }
  }

  async #solveFallback(fallback: BuiltProblem, token: number): Promise<SolveOk | null> {
    const estimate = this.#estimate(fallback)
    if (estimate?.level === 'too-complex' || token !== this.#token) return null
    const retry = await this.#backend.client.solve(fallback.problem, fallback.settings)
    return retry.status === 'ok' ? retry : null
  }

  #finish(): void {
    this.#running = false
    this.#clear('stale')
    this.#clear('slow')
  }

  #settle(outcome: SolveOutcome, estimate: ComplexityEstimate | null): void {
    let failures = 0
    if (outcome.kind === 'result' && outcome.result.status === 'error') {
      failures = this.#lastFailureKey === this.#inputKey ? this.#view.failures + 1 : 1
      this.#lastFailureKey = this.#inputKey
    } else {
      this.#lastFailureKey = null
    }
    this.#setProgress(null)
    this.#update({ outcome, estimate, pending: false, stale: false, slow: false, cancelled: false, failures })
    this.#scheduleAnnouncement()
  }

  #scheduleAnnouncement(): void {
    this.#clear('announce')
    const key = this.#inputKey
    const text = announcementFor(this.#view.outcome)
    if (text === null || key === null || this.#announcedKey === key) return
    const delay = Math.max(0, this.#lastInputAt + ANNOUNCE_AFTER_MS - this.#now())
    this.#announceTimer = setTimeout(() => {
      this.#announceTimer = null
      if (this.#inputKey !== key || this.#view.pending) return
      this.#announcedKey = key
      this.#update({ announcement: { text, seq: ++this.#announceSeq } })
    }, delay)
  }

  #stopRequest(): void {
    if (this.#running) {
      this.#backend.client.cancel()
      this.#token++
      this.#running = false
    }
    this.#clear('stale')
    this.#clear('slow')
    this.#setProgress(null)
    if (this.#view.stale || this.#view.slow) this.#update({ stale: false, slow: false })
  }

  #clear(which: 'debounce' | 'stale' | 'slow' | 'announce'): void {
    const timers = { debounce: this.#debounce, stale: this.#staleTimer, slow: this.#slowTimer, announce: this.#announceTimer }
    const timer = timers[which]
    if (timer !== null) clearTimeout(timer)
    if (which === 'debounce') this.#debounce = null
    if (which === 'stale') this.#staleTimer = null
    if (which === 'slow') this.#slowTimer = null
    if (which === 'announce') this.#announceTimer = null
  }

  #setProgress(progress: number | null): void {
    if (progress === this.#progress) return
    this.#progress = progress
    for (const listener of this.#progressListeners) listener()
  }

  #update(patch: Partial<SolveView>): void {
    this.#view = { ...this.#view, ...patch }
    for (const listener of this.#listeners) listener()
  }
}
