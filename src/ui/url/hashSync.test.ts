import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../engine/index.ts'
import { EXAMPLE_INPUT } from '../state/convert.ts'
import { readBackup } from '../state/persistIo.ts'
import { memoryStorage, wrapStorage } from '../state/storage.ts'
import { createAppStore, type InitialState } from '../state/store.ts'
import { DEFAULT_INPUT, DEFAULT_SESSION, type InputState } from '../state/types.ts'
import { encodeBase64Url } from './base64url.ts'
import { startHashSync, type HashEnv } from './hashSync.ts'
import { ownLinkOf } from './links.ts'
import { canonicalHash, encodeShareHashPlain, linksEqual, readShareHash } from './shareHash.ts'

/**
 * Stand-in for the address bar and history. navigate is a user action (adds a history entry and fires hashchange), and back
 * is going Back (fires hashchange). Each history entry records the own-input mark set through replace's own flag.
 */
function fakeLocation(initial = '', compress = false, initialOwn = false) {
  // initialOwn: this page wrote the first entry earlier for the user's input (the mark survives reloads and session restore)
  const entries: { hash: string; own: string | null }[] = [{ hash: initial, own: initialOwn ? canonicalHash(initial) : null }]
  let index = 0
  const listeners = new Set<() => void>()
  const replaced: string[] = []
  const fire = () => {
    for (const listener of listeners) listener()
  }
  const env: HashEnv = {
    read: () => entries[index].hash,
    replace: (next, own) => {
      entries[index] = { hash: next, own: own ? canonicalHash(next) : null }
      replaced.push(next)
    },
    isOwnEntry: (hash) => entries[index].own === hash,
    listen: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    compress,
  }
  return {
    env,
    replaced,
    get hash() {
      return entries[index].hash
    },
    navigate(next: string) {
      entries.splice(index + 1, entries.length, { hash: next, own: null })
      index++
      fire()
    },
    back() {
      index--
      fire()
    },
  }
}

const JAVA: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
const EXAMPLE = EXAMPLE_INPUT
const PICKAXE_INPUT: InputState = { ...DEFAULT_INPUT, item: 'pickaxe', wanted: { efficiency: 5, mending: 1 } }

const bootsHash = (settings: Settings = JAVA) => encodeShareHashPlain({ input: { ...EXAMPLE, rename: settings.rename }, settings })

/** Same input, ignoring uid and order */
const sameInput = (a: InputState | undefined, b: InputState) => a !== undefined && linksEqual({ input: a, settings: JAVA }, { input: b, settings: JAVA })

const hashHas = (hash: string, input: InputState) => {
  const read = readShareHash(hash)
  return read.kind === 'ok' && sameInput(read.link.input, input)
}

function setup(initial: InitialState = {}, hash = '', options: { compress?: boolean; ownEntry?: boolean } = {}) {
  const storage = wrapStorage(memoryStorage())
  const store = createAppStore({ storage }, initial)
  const location = fakeLocation(hash, options.compress ?? false, options.ownEntry ?? false)
  const stop = startHashSync(store, { env: location.env })
  const ownHash = () => {
    const link = ownLinkOf(store.getState())
    return link === null ? '' : encodeShareHashPlain(link)
  }
  return { store, storage, location, stop, ownHash, state: () => store.getState() }
}

/** Lets pending async writes (the Promise waiting on compression) finish */
const flush = () => vi.advanceTimersByTimeAsync(0)

let stops: (() => void)[] = []
const track = <T extends { stop: () => void }>(value: T): T => {
  stops.push(value.stop)
  return value
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const stop of stops) stop()
  stops = []
  vi.useRealTimers()
})

describe('on open', () => {
  it('shows the saved input and writes its hash when there is no hash', async () => {
    const { location, ownHash, state } = track(setup({ input: EXAMPLE }))
    await flush()
    expect(location.hash).toBe(ownHash())
    expect(location.hash).toMatch(/^#v=1&e=java&o=levels&cap=39&rn=0&d=/)
    expect(state().share.active).toBe(false)
  })

  it('leaves the hash empty when there is neither a hash nor saved input', async () => {
    const { location } = track(setup())
    await flush()
    expect(location.hash).toBe('')
    expect(location.replaced).toEqual([])
  })

  it("shows a link that matches the saved input as the user's input, without a banner", async () => {
    const hash = bootsHash()
    const { state, location } = track(setup({ input: EXAMPLE }, hash))
    await flush()
    expect(state().share.active).toBe(false)
    expect(state().system.banners.linkUnreadable).toBe(false)
    expect(location.hash).toBe(hash)
  })

  it("adopts the linked plan as the user's input when nothing is saved, without a banner or an undo entry", async () => {
    const bedrock: Settings = { edition: 'bedrock', levelCap: null, objective: 'xp', rename: true }
    const hash = bootsHash(bedrock)
    const { state, location } = track(setup({}, hash))
    expect(state().share.active).toBe(false)
    expect(sameInput(state().input, EXAMPLE)).toBe(true)
    expect(state().input.rename).toBe(true)
    expect(state().session).toEqual({ edition: 'bedrock', levelCap: null, objective: 'xp' })
    expect(state().history.past).toEqual([])
    expect(state().system.hasBackup).toBe(false)
    await vi.advanceTimersByTimeAsync(300)
    expect(readShareHash(location.hash)).toMatchObject({ kind: 'ok', link: { settings: bedrock } })
    expect(hashHas(location.hash, EXAMPLE)).toBe(true)
  })

  it('backs up non-default settings as the previous input when adopting a link with nothing saved', () => {
    const { state, storage } = track(setup({ session: { ...DEFAULT_SESSION, objective: 'finalPwp' } }, bootsHash()))
    expect(state().session.objective).toBe('levels')
    expect(readBackup(storage)?.session.objective).toBe('finalPwp')
  })

  it("shows a different plan read-only with a banner and leaves the user's input and the hash alone", async () => {
    const hash = bootsHash()
    const { state, location } = track(setup({ input: PICKAXE_INPUT }, hash))
    expect(state().share).toMatchObject({ active: true, plan: { settings: JAVA, hash: bootsHash() } })
    expect(sameInput(state().share.plan?.input, EXAMPLE)).toBe(true)
    expect(state().input).toBe(PICKAXE_INPUT)
    await vi.advanceTimersByTimeAsync(1000)
    expect(location.hash).toBe(hash)
    expect(location.replaced).toEqual([])
  })

  it("shows the saved input and a banner for an unreadable link, and rewrites the hash to the user's input", async () => {
    const { state, location, ownHash } = track(setup({ input: EXAMPLE }, '#v=99&e=java&d=j.xxx'))
    expect(state().system.banners.linkUnreadable).toBe(true)
    expect(state().share.active).toBe(false)
    expect(state().input).toBe(EXAMPLE)
    await flush()
    expect(location.hash).toBe(ownHash())
  })

  it('clears an unreadable hash when nothing is saved', async () => {
    const { state, location } = track(setup({}, '#v=1&e=java&o=levels&cap=39&rn=0&d=j.eyJpdGVt'))
    expect(state().system.banners.linkUnreadable).toBe(true)
    await flush()
    expect(location.hash).toBe('')
  })

  it('treats a marked stale own hash (reloaded before the rewrite, or changed in another tab) as the saved input and rewrites it', async () => {
    // The saved input is the pickaxe; the address bar holds a boots hash this page wrote earlier for the user's input
    const { state, location, ownHash } = track(setup({ input: PICKAXE_INPUT }, bootsHash(), { ownEntry: true }))
    expect(state().share.active).toBe(false)
    expect(state().input).toBe(PICKAXE_INPUT)
    expect(state().system.banners.linkUnreadable).toBe(false)
    await flush()
    expect(location.hash).toBe(ownHash())
    expect(hashHas(location.hash, PICKAXE_INPUT)).toBe(true)
  })

  it('shows the same hash as a shared plan when the entry is unmarked (a link the user opened)', () => {
    const { state } = track(setup({ input: PICKAXE_INPUT }, bootsHash(), { ownEntry: false }))
    expect(state().share.active).toBe(true)
    expect(sameInput(state().share.plan?.input, EXAMPLE)).toBe(true)
  })

  it("adopts a marked hash when the user's input is empty (storage unavailable, for example)", () => {
    const { state } = track(setup({}, bootsHash(), { ownEntry: true }))
    expect(state().share.active).toBe(false)
    expect(sameInput(state().input, EXAMPLE)).toBe(true)
  })

  it('shows banner.dataDropped when IDs missing from the current data are dropped', () => {
    const json = JSON.stringify({ ...EXAMPLE, wanted: { ...EXAMPLE.wanted, future_speed: 1 } })
    const hash = `#v=1&e=java&o=levels&cap=39&rn=0&d=j.${encodeBase64Url(new TextEncoder().encode(json))}`
    const { state } = track(setup({ input: PICKAXE_INPUT }, hash))
    expect(state().system.banners.dataDropped).toEqual(['future_speed'])
    expect(sameInput(state().share.plan?.input, EXAMPLE)).toBe(true)
  })
})

describe('shared plan banner actions', () => {
  it("hides the banner and writes the hash of the user's input right away on 'Back to my input'", async () => {
    const { store, state, location, ownHash } = track(setup({ input: PICKAXE_INPUT }, bootsHash()))
    store.getState().exitSharedPlan()
    expect(state().share.active).toBe(false)
    await flush()
    expect(location.hash).toBe(ownHash())
    expect(hashHas(location.hash, PICKAXE_INPUT)).toBe(true)
  })

  it("backs up the user's input before replacing it with the shared plan, and restoring the previous input brings it back", async () => {
    const { store, state, storage, location } = track(setup({ input: PICKAXE_INPUT }, bootsHash()))
    store.getState().replaceWithSharedPlan()
    expect(state().share.active).toBe(false)
    expect(sameInput(state().input, EXAMPLE)).toBe(true)
    expect(sameInput(readBackup(storage)?.input, PICKAXE_INPUT)).toBe(true)
    expect(state().system.hasBackup).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(location.hash).toBe(bootsHash())

    store.getState().restoreBackup()
    expect(sameInput(state().input, PICKAXE_INPUT)).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(hashHas(location.hash, PICKAXE_INPUT)).toBe(true)
  })

  it('ignores input changes (commit) and leaves the hash alone while read-only', async () => {
    const { store, state, location } = track(setup({ input: PICKAXE_INPUT }, bootsHash()))
    store.getState().setEdition('bedrock')
    store.getState().setRename(true)
    expect(state().session.edition).toBe('java')
    expect(state().input).toBe(PICKAXE_INPUT)
    await vi.advanceTimersByTimeAsync(1000)
    expect(location.replaced).toEqual([])
  })
})

describe('rewriting', () => {
  it('rewrites the hash 300 ms after the input changes, once per burst of changes', async () => {
    const { store, location } = track(setup({ input: EXAMPLE }))
    await flush()
    const before = location.replaced.length
    store.getState().setEdition('bedrock')
    await vi.advanceTimersByTimeAsync(200)
    store.getState().setObjective('xp')
    await vi.advanceTimersByTimeAsync(299)
    expect(location.replaced.length).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(location.replaced.length).toBe(before + 1)
    expect(location.hash).toMatch(/^#v=1&e=bedrock&o=xp&/)
  })

  it('leaves the hash alone for preferences and the share sheet', async () => {
    const { store, location } = track(setup({ input: EXAMPLE }))
    await flush()
    const before = [...location.replaced]
    store.getState().setLang('en')
    store.getState().openShareSheet()
    await vi.advanceTimersByTimeAsync(1000)
    expect(location.replaced).toEqual(before)
  })

  it('clears the hash when the input is cleared and writes it again once an item is picked', async () => {
    const { store, location } = track(setup({ input: EXAMPLE }))
    await flush()
    store.getState().clearAllInput()
    await vi.advanceTimersByTimeAsync(300)
    expect(location.hash).toBe('')
    store.getState().setItem('pickaxe')
    store.getState().setAnvilUsesOverride(2)
    await vi.advanceTimersByTimeAsync(300)
    const read = readShareHash(location.hash)
    expect(read.kind === 'ok' && read.link.input).toMatchObject({ item: 'pickaxe', anvilUsesOverride: 2 })
  })
})

describe('hash changes while the page is open', () => {
  it("reads a link pasted into the address bar and returns to the user's input on Back", async () => {
    const { state, location } = track(setup({ input: PICKAXE_INPUT }))
    await flush()
    const own = location.hash
    location.navigate(bootsHash())
    expect(state().share.active).toBe(true)
    expect(sameInput(state().share.plan?.input, EXAMPLE)).toBe(true)
    location.back()
    expect(location.hash).toBe(own)
    expect(state().share.active).toBe(false)
    expect(state().input).toBe(PICKAXE_INPUT)
  })

  it('shows the latest input when Back reaches an older own-input hash', async () => {
    const { state, location, ownHash } = track(setup({ input: PICKAXE_INPUT }))
    await flush()
    const old = location.hash
    location.navigate(bootsHash())
    // Replace with the shared plan, then change the input (this entry then holds the user's own input)
    state().replaceWithSharedPlan()
    await flush()
    state().setObjective('xp')
    await vi.advanceTimersByTimeAsync(300)
    const current = location.hash
    expect(current).toBe(ownHash())
    location.back()
    expect(location.hash).toBe(old)
    await flush()
    expect(state().share.active).toBe(false)
    expect(location.hash).toBe(current)
  })

  it('reads a link the user opens as a shared plan even if this page once wrote the same hash', async () => {
    const { state, location } = track(setup({ input: PICKAXE_INPUT }))
    await flush()
    const pickaxeHash = location.hash
    // Replace with the shared plan (this page writes the boots hash for the user's input), then restore the previous input
    location.navigate(bootsHash())
    state().replaceWithSharedPlan()
    await vi.advanceTimersByTimeAsync(300)
    expect(location.hash).toBe(bootsHash())
    state().restoreBackup()
    await vi.advanceTimersByTimeAsync(300)
    expect(location.hash).toBe(pickaxeHash)
    // Open the same boots link again
    location.navigate(bootsHash())
    await flush()
    expect(state().share.active).toBe(true)
    expect(sameInput(state().share.plan?.input, EXAMPLE)).toBe(true)
    expect(location.hash).toBe(bootsHash())
  })

  it('adopts a link pasted while the input is empty and records it for undo', () => {
    const { state, location } = track(setup())
    location.navigate(bootsHash())
    expect(state().share.active).toBe(false)
    expect(state().input.item).toBe('boots')
    expect(state().history.past).toHaveLength(1)
    state().undo()
    expect(state().input.item).toBeNull()
  })

  it('keeps the view, shows a banner and restores the hash for a pasted unreadable link, and hides it once a readable link opens', async () => {
    const { state, location } = track(setup({ input: PICKAXE_INPUT }))
    await flush()
    const own = location.hash
    location.navigate('#v=1&e=java&o=levels')
    expect(state().system.banners.linkUnreadable).toBe(true)
    await flush()
    expect(location.hash).toBe(own)
    location.navigate(bootsHash())
    expect(state().system.banners.linkUnreadable).toBe(false)
    expect(state().share.active).toBe(true)
  })

  it('restores the shown plan hash when an unreadable link is pasted while viewing a shared plan', async () => {
    const { state, location } = track(setup({ input: PICKAXE_INPUT }, bootsHash()))
    location.navigate('#v=7')
    await flush()
    expect(state().share.active).toBe(true)
    expect(location.hash).toBe(bootsHash())
  })

  it('restores the share-link hash after an in-page anchor (#step-3), without a banner', async () => {
    const { state, location } = track(setup({ input: EXAMPLE }))
    await flush()
    const own = location.hash
    location.navigate('#step-3')
    await flush()
    expect(location.hash).toBe(own)
    expect(state().system.banners.linkUnreadable).toBe(false)
  })

  it('stops writing once stopped', async () => {
    const tracked = setup({ input: EXAMPLE })
    await flush()
    tracked.stop()
    const writes = tracked.location.replaced.length
    tracked.store.getState().setEdition('bedrock')
    await vi.advanceTimersByTimeAsync(1000)
    expect(tracked.location.replaced.length).toBe(writes)
  })
})

describe('with compression', () => {
  it('writes d=z. when CompressionStream is available and reads back the same plan', async () => {
    vi.useRealTimers()
    if (typeof CompressionStream !== 'function') return
    const { location, ownHash } = track(setup({ input: EXAMPLE }, '', { compress: true }))
    await vi.waitFor(() => expect(location.hash).toMatch(/&d=z\./))
    const compressed = readShareHash(location.hash)
    const plain = readShareHash(ownHash())
    expect(compressed).toMatchObject({ kind: 'ok', hash: location.hash })
    expect(compressed.kind === 'ok' && plain.kind === 'ok' && compressed.link).toEqual(plain.kind === 'ok' && plain.link)
  })
})
