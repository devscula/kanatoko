import { createSolverClient, type SolverWorker } from './client.ts'
import { LIMITS } from './limits.ts'
import { startSolverHost, type SolverScope } from './worker.ts'
import type { AdvancedProblem, ClientResult, Settings, SolveResult, WorkerRequest, WorkerResponse } from './types.ts'

const JAVA: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
const PROBLEM: AdvancedProblem = {
  mode: 'advanced',
  target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
  extraItems: [],
  books: [{ enchantments: { mending: 1 }, anvilUses: 0 }],
  goal: null,
  useOnlyNeeded: true,
}
const EMPTY: SolveResult = { status: 'empty' }
const WATCHDOG_MS = LIMITS.exactTimeBudgetMs + LIMITS.diagnosticsBudgetMs + LIMITS.clientWatchdogMarginMs

class FakeWorker implements SolverWorker {
  readonly received: WorkerRequest[] = []
  terminated = false
  throwOnPost = false
  private readonly listeners = new Map<string, Array<(event: never) => void>>()

  postMessage(message: WorkerRequest): void {
    if (this.throwOnPost) throw new Error('DataCloneError: could not clone')
    this.received.push(message)
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  terminate(): void {
    this.terminated = true
  }

  reply(message: WorkerResponse): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data: message } as never)
  }

  fire(type: 'error' | 'messageerror', message = ''): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ type, message } as never)
  }

  lastSolve(): Extract<WorkerRequest, { type: 'solve' }> {
    const solve = this.received.filter((m): m is Extract<WorkerRequest, { type: 'solve' }> => m.type === 'solve').at(-1)
    if (solve === undefined) throw new Error('no solve was posted')
    return solve
  }
}

/** A rejection fails the test. */
function track(promise: Promise<ClientResult>): { readonly value: () => ClientResult | undefined; readonly settled: () => boolean } {
  let value: ClientResult | undefined
  let count = 0
  promise.then(
    (result) => {
      value = result
      count++
    },
    (error: unknown) => {
      throw new Error(`the client promise rejected: ${String(error)}`)
    },
  )
  return { value: () => value, settled: () => count === 1 }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function setup() {
  const workers: FakeWorker[] = []
  const client = createSolverClient({
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
  })
  return { client, workers, current: () => workers[workers.length - 1] }
}

describe('solver client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('posts solve with strictly increasing ids and resolves with the result; progress goes to onProgress', async () => {
    const { client, current } = setup()
    const onProgress = vi.fn()
    const first = track(client.solve(PROBLEM, JAVA, onProgress))
    const request = current().lastSolve()
    expect(request).toEqual({ type: 'solve', id: 1, problem: PROBLEM, settings: JAVA })
    current().reply({ type: 'progress', id: 1, phase: 'exact', done: 5, total: 10, elapsedMs: 120 })
    expect(onProgress).toHaveBeenCalledWith({ type: 'progress', id: 1, phase: 'exact', done: 5, total: 10, elapsedMs: 120 })
    current().reply({ type: 'result', id: 1, result: EMPTY })
    await flush()
    expect(first.value()).toEqual(EMPTY)
    const second = track(client.solve(PROBLEM, JAVA))
    expect(current().lastSolve().id).toBe(2)
    current().reply({ type: 'result', id: 2, result: EMPTY })
    await flush()
    expect(second.settled()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)   // the answer clears the watchdog
  })

  it('ignores malformed messages from the worker', async () => {
    const { client, current } = setup()
    const promise = track(client.solve(PROBLEM, JAVA))
    for (const data of [null, 'result', { type: 'result' }, { type: 'other', id: 1 }]) current().reply(data as unknown as WorkerResponse)
    await flush()
    expect(promise.settled()).toBe(false)
    current().reply({ type: 'result', id: 1, result: EMPTY })
    await flush()
    expect(promise.value()).toEqual(EMPTY)
  })

  it('an engine error from the worker resolves with engine-exception (retryable)', async () => {
    const { client, current } = setup()
    const promise = track(client.solve(PROBLEM, JAVA))
    current().reply({ type: 'error', id: 1, message: 'PlanBuildError: boom' })
    await flush()
    expect(promise.value()).toEqual({ status: 'error', cause: 'engine-exception', message: 'PlanBuildError: boom', retryable: true })
  })

  it('a superseded promise resolves immediately with cancelled; the late cancelled reply changes nothing', async () => {
    const { client, current, workers } = setup()
    const onProgress = vi.fn()
    const first = track(client.solve(PROBLEM, JAVA, onProgress))
    const second = track(client.solve(PROBLEM, JAVA))
    await flush()
    expect(first.value()).toEqual({ status: 'cancelled' })
    expect(second.settled()).toBe(false)
    expect(current().received.map((m) => [m.type, m.id])).toEqual([['solve', 1], ['cancel', 1], ['solve', 2]])
    // Progress and results for the old id are dropped; the result acknowledges the cancel and clears the hard-stop timer.
    current().reply({ type: 'progress', id: 1, phase: 'exact', done: 1, total: 2, elapsedMs: 16 })
    current().reply({ type: 'result', id: 1, result: { status: 'cancelled' } })
    expect(onProgress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(LIMITS.clientHardStopMs * 2)
    expect(workers).toHaveLength(1)
    expect(current().terminated).toBe(false)
    current().reply({ type: 'result', id: 2, result: EMPTY })
    await flush()
    expect(first.value()).toEqual({ status: 'cancelled' })
    expect(second.value()).toEqual(EMPTY)
  })

  it('hard stop: a worker that does not let go of a cancelled id within clientHardStopMs is replaced and the latest request re-posted', async () => {
    const { client, workers } = setup()
    track(client.solve(PROBLEM, JAVA))
    const latest = track(client.solve(PROBLEM, JAVA))
    vi.advanceTimersByTime(LIMITS.clientHardStopMs - 1)
    expect(workers).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(workers[1].received).toEqual([{ type: 'solve', id: 2, problem: PROBLEM, settings: JAVA }])
    // Messages from the terminated worker are ignored.
    workers[0].reply({ type: 'result', id: 2, result: { status: 'cancelled' } })
    workers[1].reply({ type: 'result', id: 2, result: EMPTY })
    await flush()
    expect(latest.value()).toEqual(EMPTY)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('hard stop without a latest request only replaces the worker', () => {
    const { client, workers } = setup()
    const promise = track(client.solve(PROBLEM, JAVA))
    client.cancel()
    vi.advanceTimersByTime(LIMITS.clientHardStopMs)
    expect(workers).toHaveLength(2)
    expect(workers[1].received).toEqual([])
    return flush().then(() => expect(promise.value()).toEqual({ status: 'cancelled' }))
  })

  it.each(['error', 'messageerror'] as const)('a worker %s event resolves the latest promise with worker-crashed; the next solve works on a new worker', async (type) => {
    const { client, workers } = setup()
    const crashed = track(client.solve(PROBLEM, JAVA))
    workers[0].fire(type, type === 'error' ? 'out of memory' : '')
    await flush()
    expect(crashed.value()).toEqual({ status: 'error', cause: 'worker-crashed', message: type === 'error' ? 'out of memory' : 'worker messageerror event', retryable: true })
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(workers[1].received).toEqual([])   // not re-posted
    workers[0].fire('error')   // events from a terminated worker do nothing
    expect(workers).toHaveLength(2)
    const next = track(client.solve(PROBLEM, JAVA))
    expect(workers[1].lastSolve().id).toBe(2)
    workers[1].reply({ type: 'result', id: 2, result: EMPTY })
    await flush()
    expect(next.value()).toEqual(EMPTY)
  })

  it('a crash also clears the hard-stop timers of superseded requests', async () => {
    const { client, workers } = setup()
    track(client.solve(PROBLEM, JAVA))
    const latest = track(client.solve(PROBLEM, JAVA))
    workers[0].fire('error', 'crash')
    await flush()
    expect(latest.value()).toMatchObject({ status: 'error', cause: 'worker-crashed' })
    vi.advanceTimersByTime(LIMITS.clientHardStopMs * 2)
    expect(workers).toHaveLength(2)   // the hard-stop timer is cleared
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the watchdog resolves a request whose worker never answers', async () => {
    const { client, workers } = setup()
    const promise = track(client.solve(PROBLEM, JAVA))
    vi.advanceTimersByTime(WATCHDOG_MS - 1)
    await flush()
    expect(promise.settled()).toBe(false)
    vi.advanceTimersByTime(1)
    await flush()
    expect(promise.value()).toMatchObject({ status: 'error', cause: 'watchdog', retryable: true })
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
    // The watchdog is per request: the next request gets a fresh timer.
    const next = track(client.solve(PROBLEM, JAVA))
    vi.advanceTimersByTime(WATCHDOG_MS - 1)
    workers[1].reply({ type: 'result', id: 2, result: EMPTY })
    await flush()
    expect(next.value()).toEqual(EMPTY)
  })

  it('the watchdog restarts when a hard stop re-posts the latest request', async () => {
    const { client, workers } = setup()
    track(client.solve(PROBLEM, JAVA))
    const latest = track(client.solve(PROBLEM, JAVA))
    vi.advanceTimersByTime(WATCHDOG_MS - LIMITS.clientHardStopMs)   // the hard stop happened long ago
    await flush()
    expect(workers).toHaveLength(2)
    expect(latest.settled()).toBe(false)
    vi.advanceTimersByTime(LIMITS.clientHardStopMs)   // WATCHDOG_MS has not yet passed since the re-post
    await flush()
    expect(latest.settled()).toBe(false)
    vi.advanceTimersByTime(LIMITS.clientHardStopMs)
    await flush()
    expect(latest.value()).toMatchObject({ status: 'error', cause: 'watchdog' })
  })

  it('cancel() resolves the latest request with cancelled and asks the worker to stop', async () => {
    const { client, current } = setup()
    const promise = track(client.solve(PROBLEM, JAVA))
    client.cancel()
    await flush()
    expect(promise.value()).toEqual({ status: 'cancelled' })
    expect(current().received.at(-1)).toEqual({ type: 'cancel', id: 1 })
    client.cancel()   // does nothing without a latest request
    expect(current().received).toHaveLength(2)
    current().reply({ type: 'result', id: 1, result: EMPTY })   // a late result is dropped
    await flush()
    expect(promise.value()).toEqual({ status: 'cancelled' })
  })

  it('dispose() resolves the latest request, clears every timer and terminates the worker; later calls resolve at once', async () => {
    const { client, workers } = setup()
    const superseded = track(client.solve(PROBLEM, JAVA))
    const latest = track(client.solve(PROBLEM, JAVA))
    client.dispose()
    await flush()
    expect(superseded.value()).toEqual({ status: 'cancelled' })
    expect(latest.value()).toEqual({ status: 'cancelled' })
    expect(workers[0].terminated).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    const after = track(client.solve(PROBLEM, JAVA))
    await flush()
    expect(after.value()).toEqual({ status: 'cancelled' })
    expect(workers).toHaveLength(1)
    client.cancel()
    client.dispose()
  })

  it('never rejects: a request that cannot be posted resolves with worker-crashed', async () => {
    const { client, current } = setup()
    current().throwOnPost = true
    const promise = track(client.solve(PROBLEM, JAVA))
    await flush()
    expect(promise.value()).toMatchObject({ status: 'error', cause: 'worker-crashed', message: expect.stringContaining('DataCloneError') as string })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a worker that keeps failing to load is not re-created until the next solve (at most one new worker per request)', async () => {
    const { client, workers } = setup()
    workers[0].fire('error', 'failed to load')   // first load failure: re-created at once
    expect(workers).toHaveLength(2)
    workers[1].fire('error', 'failed to load')   // the replacement also died before answering: wait for the next request
    expect(workers).toHaveLength(2)
    vi.advanceTimersByTime(60_000)
    expect(workers).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)

    const failed = track(client.solve(PROBLEM, JAVA))
    expect(workers).toHaveLength(3)
    expect(workers[2].lastSolve().id).toBe(1)
    workers[2].fire('error', 'failed to load')
    await flush()
    expect(failed.value()).toEqual({ status: 'error', cause: 'worker-crashed', message: 'failed to load', retryable: true })
    expect(workers).toHaveLength(3)
    vi.advanceTimersByTime(60_000)
    expect(workers).toHaveLength(3)

    const answered = track(client.solve(PROBLEM, JAVA))
    expect(workers).toHaveLength(4)
    workers[3].reply({ type: 'result', id: 2, result: EMPTY })
    await flush()
    expect(answered.value()).toEqual(EMPTY)
    // A worker that has answered before is re-created at once when it dies.
    workers[3].fire('error', 'out of memory')
    expect(workers).toHaveLength(5)
  })

  it('a worker that errors as soon as it is created (every time) costs two workers while idle and one per request', async () => {
    let created = 0
    const workers: FakeWorker[] = []
    const client = createSolverClient({
      createWorker: () => {
        created++
        const worker = new FakeWorker()
        workers.push(worker)
        queueMicrotask(() => worker.fire('error'))
        return worker
      },
    })
    await flush()
    vi.advanceTimersByTime(60_000)
    await flush()
    expect(created).toBe(2)
    for (let i = 1; i <= 3; i++) {
      const promise = track(client.solve(PROBLEM, JAVA))
      await flush()
      vi.advanceTimersByTime(60_000)
      await flush()
      expect(promise.value()).toMatchObject({ status: 'error', cause: 'worker-crashed', retryable: true })
      expect(created).toBe(2 + i)
    }
    expect(workers.every((worker) => worker.terminated)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a worker that cannot be created at all (createWorker throws) does not throw; solve resolves with worker-crashed at once', async () => {
    let attempts = 0
    let fail = true
    const workers: FakeWorker[] = []
    const createWorker = (): FakeWorker => {
      attempts++
      if (fail) throw new DOMException('Refused to create a worker', 'SecurityError')
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    }
    const client = createSolverClient({ createWorker })
    expect(attempts).toBe(1)
    const promise = track(client.solve(PROBLEM, JAVA))
    await flush()   // no timers advanced: it does not wait for the watchdog
    expect(promise.value()).toEqual({ status: 'error', cause: 'worker-crashed', message: 'SecurityError: Refused to create a worker', retryable: true })
    expect(attempts).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
    client.cancel()   // does nothing without a latest request

    // Once a worker can be created, the next solve creates one and gets an answer.
    fail = false
    const next = track(client.solve(PROBLEM, JAVA))
    expect(workers).toHaveLength(1)
    workers[0].reply({ type: 'result', id: workers[0].lastSolve().id, result: EMPTY })
    await flush()
    expect(next.value()).toEqual(EMPTY)
  })

  it('a hard stop whose replacement worker cannot be created resolves the latest request with worker-crashed', async () => {
    let fail = false
    const workers: FakeWorker[] = []
    const client = createSolverClient({
      createWorker: () => {
        if (fail) throw new Error('offline')
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
    })
    track(client.solve(PROBLEM, JAVA))
    const latest = track(client.solve(PROBLEM, JAVA))
    fail = true
    vi.advanceTimersByTime(LIMITS.clientHardStopMs)
    await flush()
    expect(workers[0].terminated).toBe(true)
    expect(latest.value()).toEqual({ status: 'error', cause: 'worker-crashed', message: 'Error: offline', retryable: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('every promise resolves exactly once through a mix of events', async () => {
    const { client, workers } = setup()
    const promises = [track(client.solve(PROBLEM, JAVA)), track(client.solve(PROBLEM, JAVA))]
    vi.advanceTimersByTime(LIMITS.clientHardStopMs)   // hard stop: 2 is re-posted
    promises.push(track(client.solve(PROBLEM, JAVA)))
    workers[1].reply({ type: 'result', id: 2, result: { status: 'cancelled' } })
    workers[1].fire('error', 'crash')   // 3 resolves with worker-crashed
    promises.push(track(client.solve(PROBLEM, JAVA)))
    workers[2].reply({ type: 'result', id: 4, result: EMPTY })
    workers[2].reply({ type: 'result', id: 4, result: EMPTY })   // a duplicate changes nothing
    promises.push(track(client.solve(PROBLEM, JAVA)))
    client.dispose()
    await flush()
    expect(promises.map((p) => p.settled())).toEqual([true, true, true, true, true])
    expect(promises.map((p) => p.value()?.status)).toEqual(['cancelled', 'cancelled', 'error', 'empty', 'cancelled'])
  })
})

// Client <-> worker host, real engine

/** Messages arrive through setTimeout and are copied through JSON in place of structured clone. */
class InProcessWorker implements SolverWorker {
  private readonly toClient: Array<(event: MessageEvent<WorkerResponse>) => void> = []
  private toHost: ((event: MessageEvent<unknown>) => void) | null = null
  terminated = false

  constructor() {
    const scope: SolverScope = {
      postMessage: (message) => {
        const copy = JSON.parse(JSON.stringify(message)) as WorkerResponse
        setTimeout(() => {
          if (!this.terminated) for (const listener of this.toClient) listener({ data: copy } as MessageEvent<WorkerResponse>)
        }, 0)
      },
      addEventListener: (_type, listener) => {
        this.toHost = listener
      },
    }
    startSolverHost(scope, { yieldToEventLoop: () => new Promise((resolve) => setTimeout(resolve, 0)) })
  }

  postMessage(message: WorkerRequest): void {
    const copy = JSON.parse(JSON.stringify(message)) as unknown
    setTimeout(() => {
      if (!this.terminated) this.toHost?.({ data: copy } as MessageEvent<unknown>)
    }, 0)
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') this.toClient.push(listener as (event: MessageEvent<WorkerResponse>) => void)
  }

  terminate(): void {
    this.terminated = true
  }
}

describe('solver client with the real worker host and engine', () => {
  const BOOTS_WITH_MAX_BOOKS: AdvancedProblem = {
    ...PROBLEM,
    books: [{ soul_speed: 3 }, { thorns: 3 }, { feather_falling: 4 }, { depth_strider: 3 }, { protection: 4 }, { unbreaking: 3 }, { mending: 1 }]
      .map((enchantments) => ({ enchantments, anvilUses: 0 })),
  }

  it('solves, supersedes and acknowledges without a hard stop', async () => {
    const workers: InProcessWorker[] = []
    const client = createSolverClient({ createWorker: () => { const worker = new InProcessWorker(); workers.push(worker); return worker } })
    const result = await client.solve(BOOTS_WITH_MAX_BOOKS, JAVA)
    expect(result).toMatchObject({ status: 'ok', summary: { totalLevels: 66, maxStepLevels: 16 } })

    // Supersede the request while the exact search runs in slices (progress arrives too).
    const onProgress = vi.fn()
    const first = client.solve(BOOTS_WITH_MAX_BOOKS, { ...JAVA, objective: 'xp' }, onProgress)
    const second = client.solve(BOOTS_WITH_MAX_BOOKS, { ...JAVA, objective: 'finalPwp' })
    expect(await first).toEqual({ status: 'cancelled' })
    expect(await second).toMatchObject({ status: 'ok', method: 'exact', summary: { finalPriorWorkPenalty: 7, totalLevels: 68 } })
    await new Promise((resolve) => setTimeout(resolve, LIMITS.clientHardStopMs + 50))
    expect(workers).toHaveLength(1)   // the worker acknowledged the cancel, so it was not replaced
    client.dispose()
    expect(workers[0].terminated).toBe(true)
  }, 10_000)
})
