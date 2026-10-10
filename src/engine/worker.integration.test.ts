import { startSolverHost, type SolverScope } from './worker.ts'
import type { SolveTask, SolveTaskProgress } from './solve.ts'
import type { AdvancedProblem, Problem, Settings, SolveOptions, SolveResult, WorkerRequest, WorkerResponse } from './types.ts'

const JAVA: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
const BOOTS_WITH_MAX_BOOKS: AdvancedProblem = {
  mode: 'advanced',
  target: { itemType: 'boots', enchantments: {}, anvilUses: 0 },
  extraItems: [],
  books: [{ soul_speed: 3 }, { thorns: 3 }, { feather_falling: 4 }, { depth_strider: 3 }, { protection: 4 }, { unbreaking: 3 }, { mending: 1 }]
    .map((enchantments) => ({ enchantments, anvilUses: 0 })),
  goal: null,
  useOnlyNeeded: true,
}

class FakeScope implements SolverScope {
  readonly sent: WorkerResponse[] = []
  private listener: ((event: MessageEvent<unknown>) => void) | null = null
  failOn: ((message: WorkerResponse) => boolean) | null = null

  postMessage(message: WorkerResponse): void {
    if (this.failOn?.(message) === true) throw new Error('DataCloneError: could not clone')
    this.sent.push(message)
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listener = listener
  }

  deliver(data: unknown): void {
    this.listener?.({ data } as MessageEvent<unknown>)
  }

  answers(): Array<Exclude<WorkerResponse, { type: 'progress' }>> {
    return this.sent.filter((message): message is Exclude<WorkerResponse, { type: 'progress' }> => message.type !== 'progress')
  }
}

/** Lets the test release the yields between slices one at a time. */
class ManualYield {
  private readonly waiting: Array<() => void> = []
  readonly yieldToEventLoop = (): Promise<void> => new Promise((resolve) => this.waiting.push(resolve))

  get pending(): number {
    return this.waiting.length
  }

  /** Advances the waiting worker by one slice and waits until the follow-up microtasks have run. */
  async step(): Promise<void> {
    this.waiting.shift()?.()
    await flushMicrotasks()
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

class FakeTask implements SolveTask {
  runs = 0
  private cancelled = false
  private readonly slices: number
  private readonly finish: () => SolveResult

  constructor(slices: number, finish: () => SolveResult) {
    this.slices = slices
    this.finish = finish
  }

  run(): boolean {
    if (this.cancelled) return true
    this.runs++
    return this.runs >= this.slices
  }

  result(): SolveResult {
    return this.cancelled ? { status: 'cancelled' } : this.finish()
  }

  get progress(): SolveTaskProgress {
    return { phase: 'exact', done: this.runs, total: this.slices, elapsedMs: this.runs * 16 }
  }

  cancel(): void {
    this.cancelled = true
  }
}

const EMPTY: SolveResult = { status: 'empty' }
const solve = (id: number, problem: Problem = BOOTS_WITH_MAX_BOOKS, options?: SolveOptions): WorkerRequest => ({ type: 'solve', id, problem, settings: JAVA, options })

/** Each fake task takes one slice per book of the requested problem, and at least one. */
function fakeHost(options: { now?: () => number } = {}) {
  const scope = new FakeScope()
  const gate = new ManualYield()
  const tasks: FakeTask[] = []
  startSolverHost(scope, {
    yieldToEventLoop: gate.yieldToEventLoop,
    now: options.now,
    createTask: (problem) => {
      const slices = problem.mode === 'advanced' ? Math.max(1, problem.books.length) : 1
      const task = new FakeTask(slices, () => EMPTY)
      tasks.push(task)
      return task
    },
  })
  return { scope, gate, tasks }
}

const withBooks = (count: number): AdvancedProblem => ({ ...BOOTS_WITH_MAX_BOOKS, books: BOOTS_WITH_MAX_BOOKS.books.slice(0, 1).concat(Array(Math.max(0, count - 1)).fill(BOOTS_WITH_MAX_BOOKS.books[1])) })

describe('worker host', () => {
  it('solves with the real pipeline and answers with the result', async () => {
    const scope = new FakeScope()
    startSolverHost(scope)   // yields with the default MessageChannel round trip
    scope.deliver(solve(1))
    await vi.waitFor(() => expect(scope.answers()).toHaveLength(1))
    const [answer] = scope.answers()
    expect(answer).toMatchObject({ type: 'result', id: 1, result: { status: 'ok', method: 'tree-table', summary: { totalLevels: 66 } } })
  })

  it('runs a task in slices, yielding between them, and answers once', async () => {
    const { scope, gate, tasks } = fakeHost()
    scope.deliver(solve(1, withBooks(3)))
    expect(tasks[0].runs).toBe(1)
    expect(gate.pending).toBe(1)
    await gate.step()
    expect(tasks[0].runs).toBe(2)
    await gate.step()
    expect(scope.answers()).toEqual([{ type: 'result', id: 1, result: EMPTY }])
    expect(gate.pending).toBe(0)
  })

  it('cancels the running task at the next slice boundary on a new solve, then runs the new one', async () => {
    const { scope, gate, tasks } = fakeHost()
    scope.deliver(solve(1, withBooks(5)))
    scope.deliver(solve(2, withBooks(2)))
    expect(scope.answers()).toEqual([])   // the running task does not stop before the slice boundary
    await gate.step()
    expect(scope.answers()).toEqual([{ type: 'result', id: 1, result: { status: 'cancelled' } }])
    expect(tasks[0].runs).toBe(1)
    await gate.step()
    expect(scope.answers()).toEqual([
      { type: 'result', id: 1, result: { status: 'cancelled' } },
      { type: 'result', id: 2, result: EMPTY },
    ])
  })

  it('keeps only the newest pending request; every superseded id is answered with cancelled', async () => {
    const { scope, gate, tasks } = fakeHost()
    scope.deliver(solve(1, withBooks(5)))
    scope.deliver(solve(2, withBooks(1)))
    scope.deliver(solve(3, withBooks(1)))
    // The pending request 2 is answered at once without being solved.
    expect(scope.answers()).toEqual([{ type: 'result', id: 2, result: { status: 'cancelled' } }])
    await gate.step()
    expect(scope.answers().map((a) => [a.id, a.type === 'result' ? a.result.status : a.type])).toEqual([[2, 'cancelled'], [1, 'cancelled'], [3, 'empty']])
    expect(tasks).toHaveLength(2)   // no task is created for 2
  })

  it('stops a cancelled running id at the next boundary, answers a cancelled pending id at once and ignores other ids', async () => {
    const { scope, gate } = fakeHost()
    scope.deliver(solve(1, withBooks(5)))
    scope.deliver({ type: 'cancel', id: 99 })
    scope.deliver({ type: 'cancel', id: 1 })
    await gate.step()
    expect(scope.answers()).toEqual([{ type: 'result', id: 1, result: { status: 'cancelled' } }])

    scope.deliver(solve(2, withBooks(5)))
    scope.deliver(solve(3, withBooks(5)))   // stops 2 and leaves 3 pending
    scope.deliver({ type: 'cancel', id: 3 })
    expect(scope.answers().slice(1)).toEqual([{ type: 'result', id: 3, result: { status: 'cancelled' } }])
    await gate.step()
    expect(scope.answers().slice(2)).toEqual([{ type: 'result', id: 2, result: { status: 'cancelled' } }])
    expect(gate.pending).toBe(0)
    scope.deliver({ type: 'cancel', id: 2 })   // a cancel after the answer does nothing
    expect(scope.answers()).toHaveLength(3)
  })

  it('turns an exception into an error for that id and stays usable', async () => {
    const scope = new FakeScope()
    startSolverHost(scope, { yieldToEventLoop: () => Promise.resolve() })
    // Forcing the tree-table method on a problem that is not additive is an engine error.
    const conflicting = { ...BOOTS_WITH_MAX_BOOKS, target: { itemType: 'sword' as const, enchantments: {}, anvilUses: 0 }, books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }, { enchantments: { smite: 5 }, anvilUses: 0 }] }
    scope.deliver(solve(1, conflicting, { forceMethod: 'tree-table' }))
    await vi.waitFor(() => expect(scope.answers()).toHaveLength(1))
    expect(scope.answers()[0]).toMatchObject({ type: 'error', id: 1, message: expect.stringContaining('additive') as string })
    scope.deliver(solve(2))
    await vi.waitFor(() => expect(scope.answers()).toHaveLength(2))
    expect(scope.answers()[1]).toMatchObject({ type: 'result', id: 2, result: { status: 'ok' } })
  })

  it('posts progress at most every progressIntervalMs', async () => {
    let time = 0
    const { scope, gate } = fakeHost({ now: () => time })
    scope.deliver(solve(1, withBooks(6)))
    for (const advance of [50, 60, 20, 100, 0]) {
      time += advance
      await gate.step()
    }
    const progress = scope.sent.filter((m) => m.type === 'progress')
    // Nothing is sent at 0 ms or 50 ms; progress goes out at 110 ms, not at 130 ms (only 20 ms later), and again at 230 ms.
    expect(progress.map((m) => (m.type === 'progress' ? [m.phase, m.done, m.total] : null))).toEqual([['exact', 3, 6], ['exact', 5, 6]])
    expect(scope.answers()).toEqual([{ type: 'result', id: 1, result: EMPTY }])
  })

  it('ignores malformed messages', () => {
    const { scope, tasks } = fakeHost()
    for (const data of [null, 42, 'solve', { type: 'solve' }, { type: 'other', id: 1 }, { type: 'cancel', id: '1' }]) scope.deliver(data)
    expect(scope.sent).toEqual([])
    expect(tasks).toEqual([])
  })

  it('answers with an error when the result cannot be sent', async () => {
    const { scope, gate } = fakeHost()
    scope.failOn = (message) => message.type === 'result'
    scope.deliver(solve(1, withBooks(1)))
    await gate.step()
    expect(scope.sent).toEqual([{ type: 'error', id: 1, message: expect.stringContaining('could not send the answer') as string }])
  })
})
