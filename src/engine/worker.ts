import { LIMITS } from './limits.ts'
import { createSolveTask, type SolveTask } from './solve.ts'
import type { Problem, Settings, SolveOptions, WorkerRequest, WorkerResponse } from './types.ts'

export interface SolverScope {
  postMessage(message: WorkerResponse): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

export interface SolverHostOptions {
  readonly yieldToEventLoop?: () => Promise<void>
  readonly createTask?: (problem: Problem, settings: Settings, options: SolveOptions) => SolveTask
  readonly now?: () => number
}

interface Job {
  readonly id: number
  readonly problem: Problem
  readonly settings: Settings
  readonly options: SolveOptions
  cancelled: boolean
}

/**
 * One request runs at a time. A new solve stops the running task at its next slice boundary and replaces the pending
 * request. Every superseded or cancelled request is still answered with { status: 'cancelled' }, which the client uses
 * as an acknowledgement. Slices are separated by a yield to the event loop so that a cancel can get through.
 */
export function startSolverHost(scope: SolverScope, options: SolverHostOptions = {}): void {
  const yieldToEventLoop = options.yieldToEventLoop ?? messageChannelYield()
  const makeTask = options.createTask ?? createSolveTask
  const clock = options.now ?? (() => performance.now())
  let running: Job | null = null
  let pending: Job | null = null

  const post = (message: WorkerResponse): void => {
    try {
      scope.postMessage(message)
    } catch (error) {
      // The answer could not be cloned, but every request must get an answer
      if (message.type === 'progress') return
      scope.postMessage({ type: 'error', id: message.id, message: `could not send the answer: ${describe(error)}` })
    }
  }
  const cancelled = (id: number): void => post({ type: 'result', id, result: { status: 'cancelled' } })

  const execute = async (job: Job): Promise<void> => {
    const limits = { ...LIMITS, ...job.options.limits }
    let lastProgress = clock()
    try {
      const task = makeTask(job.problem, job.settings, job.options)
      for (;;) {
        if (job.cancelled) task.cancel()
        if (task.run(limits.sliceMs)) break
        const time = clock()
        if (time - lastProgress >= limits.progressIntervalMs) {
          lastProgress = time
          post({ type: 'progress', id: job.id, ...task.progress })
        }
        await yieldToEventLoop()
      }
      post({ type: 'result', id: job.id, result: task.result() })
    } catch (error) {
      post({ type: 'error', id: job.id, message: describe(error) })
    }
  }

  const drain = async (): Promise<void> => {
    while (pending !== null) {
      running = pending
      pending = null
      await execute(running)
      running = null
    }
  }

  scope.addEventListener('message', (event) => {
    const request = event.data
    if (!isWorkerRequest(request)) return   // unknown messages have no id to answer
    if (request.type === 'solve') {
      if (running !== null) running.cancelled = true
      if (pending !== null) cancelled(pending.id)
      pending = { id: request.id, problem: request.problem, settings: request.settings, options: request.options ?? {}, cancelled: false }
      if (running === null) void drain()
      return
    }
    if (running?.id === request.id) {
      running.cancelled = true
    } else if (pending?.id === request.id) {
      cancelled(pending.id)
      pending = null
    }
    // Any other id was already answered or is unknown
  })
}

/** A MessageChannel round trip lets queued messages such as cancel run first, without setTimeout's minimum delay. */
function messageChannelYield(): () => Promise<void> {
  const channel = new MessageChannel()
  const waiting: Array<() => void> = []
  channel.port1.onmessage = () => waiting.shift()?.()
  return () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve)
      channel.port2.postMessage(null)
    })
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false
  const { type, id } = value as { type?: unknown; id?: unknown }
  return (type === 'solve' || type === 'cancel') && typeof id === 'number'
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

// Attach to self only inside a worker; loading this module in tests or on the main thread does nothing
const workerScope = globalThis as { WorkerGlobalScope?: abstract new () => unknown }
if (typeof workerScope.WorkerGlobalScope === 'function' && globalThis instanceof workerScope.WorkerGlobalScope) {
  startSolverHost(globalThis as unknown as SolverScope)
}
