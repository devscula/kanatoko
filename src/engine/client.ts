// Only the answer to the latest request is delivered. A superseded request resolves as cancelled at once and the
// worker is sent a cancel; a worker that does not acknowledge it within clientHardStopMs has a slice that failed to
// yield, so it is recreated and the latest request is posted again. A worker that crashes (out of memory, failed module
// load, clone failure) or trips the watchdog is recreated too, but its request resolves with an error instead of being
// posted again, since it would likely crash again. No promise ever rejects, and each resolves exactly once.

import { LIMITS, type Limits } from './limits.ts'
import type { ClientResult, Problem, Settings, SolverClient, WorkerRequest, WorkerResponse } from './types.ts'

export type { ClientResult, SolverClient } from './types.ts'

export interface SolverWorker {
  postMessage(message: WorkerRequest): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void
  terminate(): void
}

export interface SolverClientOptions {
  readonly createWorker?: () => SolverWorker
  readonly limits?: Partial<Pick<Limits, 'clientHardStopMs' | 'clientWatchdogMarginMs' | 'exactTimeBudgetMs' | 'diagnosticsBudgetMs'>>
}

type ProgressListener = (progress: Extract<WorkerResponse, { type: 'progress' }>) => void
type Timer = ReturnType<typeof setTimeout>

interface LatestRequest {
  readonly request: Extract<WorkerRequest, { type: 'solve' }>
  readonly resolve: (result: ClientResult) => void
  readonly onProgress: ProgressListener | undefined
  watchdog: Timer | null
}

function createModuleWorker(): SolverWorker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
}

/** Creates the worker right away so that it has loaded by the first request. Never throws, even when the worker cannot be created. */
export function createSolverClient(options: SolverClientOptions = {}): SolverClient {
  const createWorker = options.createWorker ?? createModuleWorker
  const limits = { ...LIMITS, ...options.limits }
  const watchdogMs = limits.exactTimeBudgetMs + limits.diagnosticsBudgetMs + limits.clientWatchdogMarginMs

  let worker: SolverWorker | null = null
  // Workers in a row that died before sending any valid message
  let silentCrashes = 0
  let spawnError: unknown = null
  let latest: LatestRequest | null = null
  // Hard-stop timers of cancelled requests the worker has not let go of yet
  const awaitingAck = new Map<number, Timer>()
  let lastId = 0
  let disposed = false

  // null when createWorker throws (CSP worker-src, no Worker support); solve() then fails and the next one tries again
  const spawn = (): SolverWorker | null => {
    let created: SolverWorker
    try {
      created = createWorker()
    } catch (error) {
      spawnError = error
      return null
    }
    spawnError = null
    // After a restart, events from the previous worker are ignored
    created.addEventListener('message', (event) => {
      if (created !== worker || !isWorkerResponse(event.data)) return
      silentCrashes = 0
      onMessage(event.data)
    })
    const onCrash = (event: Event): void => {
      if (created === worker) restart('worker-crashed', crashMessage(event))
    }
    created.addEventListener('error', onCrash)
    created.addEventListener('messageerror', onCrash)
    return created
  }

  const clearAckTimers = (): void => {
    for (const timer of awaitingAck.values()) clearTimeout(timer)
    awaitingAck.clear()
  }

  const settle = (result: ClientResult): void => {
    const current = latest
    if (current === null) return
    latest = null
    if (current.watchdog !== null) clearTimeout(current.watchdog)
    current.resolve(result)
  }

  const startWatchdog = (current: LatestRequest): void => {
    current.watchdog = setTimeout(() => {
      if (latest === current) restart('watchdog', `no answer within ${watchdogMs} ms`)
    }, watchdogMs)
  }

  const send = (message: WorkerRequest): boolean => {
    if (worker === null) return false
    try {
      worker.postMessage(message)
      return true
    } catch (error) {
      // The request could not be cloned (the problem is not plain data). It never reached the worker, so no restart
      if (message.type === 'solve' && latest?.request.id === message.id) {
        settle({ status: 'error', cause: 'worker-crashed', message: describe(error), retryable: true })
      }
      return false
    }
  }

  const supersede = (): void => {
    const current = latest
    if (current === null) return
    settle({ status: 'cancelled' })
    const id = current.request.id
    if (!send({ type: 'cancel', id })) return
    awaitingAck.set(id, setTimeout(hardStop, limits.clientHardStopMs))
  }

  // A slice failed to yield, so the worker never saw the cancel
  const hardStop = (): void => {
    worker?.terminate()
    clearAckTimers()
    worker = spawn()
    const current = latest
    if (current === null) return
    if (current.watchdog !== null) clearTimeout(current.watchdog)
    if (worker === null) settle(spawnFailure())
    else if (send(current.request) && latest === current) startWatchdog(current)
  }

  // If the recreated worker also dies before answering (the module keeps failing to load), recreation waits for the
  // next solve(), so it never loops while idle
  const restart = (cause: 'worker-crashed' | 'watchdog', message: string): void => {
    worker?.terminate()
    clearAckTimers()
    worker = silentCrashes++ === 0 ? spawn() : null
    settle({ status: 'error', cause, message, retryable: true })
  }

  const spawnFailure = (): ClientResult => ({ status: 'error', cause: 'worker-crashed', message: describe(spawnError), retryable: true })

  const onMessage = (message: WorkerResponse): void => {
    const current = latest
    if (current !== null && message.id === current.request.id) {
      if (message.type === 'progress') current.onProgress?.(message)
      else if (message.type === 'result') settle(message.result)
      else settle({ status: 'error', cause: 'engine-exception', message: message.message, retryable: true })
      return
    }
    const timer = awaitingAck.get(message.id)
    if (timer !== undefined && message.type !== 'progress') {
      clearTimeout(timer)
      awaitingAck.delete(message.id)
    }
    // Anything else answers an old request and is dropped
  }

  worker = spawn()

  return {
    solve(problem: Problem, settings: Settings, onProgress?: ProgressListener): Promise<ClientResult> {
      if (disposed) return Promise.resolve({ status: 'cancelled' })
      supersede()
      worker ??= spawn()
      if (worker === null) return Promise.resolve(spawnFailure())
      return new Promise<ClientResult>((resolve) => {
        const request: LatestRequest['request'] = { type: 'solve', id: ++lastId, problem, settings }
        const current: LatestRequest = { request, resolve, onProgress, watchdog: null }
        latest = current
        if (send(request) && latest === current) startWatchdog(current)
      })
    },
    cancel(): void {
      supersede()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      settle({ status: 'cancelled' })
      clearAckTimers()
      worker?.terminate()
      worker = null
    },
  }
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false
  const { type, id } = value as { type?: unknown; id?: unknown }
  return (type === 'progress' || type === 'result' || type === 'error') && typeof id === 'number'
}

function crashMessage(event: Event): string {
  const message = (event as Partial<ErrorEvent>).message
  return typeof message === 'string' && message !== '' ? message : `worker ${event.type} event`
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
