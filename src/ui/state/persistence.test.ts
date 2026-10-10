// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseInputState, parsePrefs, parseSession } from './parse.ts'
import { loadInitialState, startPersistence } from './persistence.ts'
import { STORAGE_KEYS } from './persistIo.ts'
import { fnv1a32, planIdOf, stableStringify } from './planId.ts'
import { memoryStorage, wrapStorage } from './storage.ts'
import { createAppStore } from './store.ts'
import { DEFAULT_INPUT, DEFAULT_PREFS, DEFAULT_SESSION } from './types.ts'

/** Input as stored (no uids) */
const STORED = {
  item: 'pickaxe',
  existing: { unbreaking: 3 },
  anvilUsesOverride: null,
  wanted: { efficiency: 5 },
  ownedBooks: [{ enchantments: { efficiency: 4 }, count: 2, anvilUsesOverride: 1 }],
  extraItems: [{ enchantments: {}, anvilUsesOverride: null }],
  rename: true,
}

describe('plan ID', () => {
  it('matches known FNV-1a 32-bit values', () => {
    expect(fnv1a32('')).toBe('811c9dc5')
    expect(fnv1a32('a')).toBe('e40c292c')
  })

  it('serializes JSON independently of key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }))
  })

  it('gives a SimpleProblem and the equivalent AdvancedProblem the same ID, and different settings a different one', () => {
    const settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false } as const
    const simple = planIdOf({ mode: 'simple', item: 'boots', enchantments: [{ id: 'mending', level: 1 }] }, settings)
    const advanced = planIdOf(
      { mode: 'advanced', target: { itemType: 'boots', enchantments: {}, anvilUses: 0 }, extraItems: [], books: [{ enchantments: { mending: 1 }, anvilUses: 0 }], goal: { mending: 1 }, useOnlyNeeded: true },
      settings,
    )
    expect(advanced).toBe(simple)
    expect(planIdOf({ mode: 'simple', item: 'boots', enchantments: [{ id: 'mending', level: 1 }] }, { ...settings, rename: true })).not.toBe(simple)
  })
})

describe('saved data validation', () => {
  it('reads an input, recreates uids, drops unknown IDs and clamps levels above the maximum', () => {
    const dropped: string[] = []
    const input = parseInputState({ ...STORED, wanted: { efficiency: 9, gone: 1 } }, dropped)
    expect(input?.wanted).toEqual({ efficiency: 5 })
    expect(input?.ownedBooks[0]).toMatchObject({ enchantments: { efficiency: 4 }, count: 2, anvilUsesOverride: 1 })
    expect(typeof input?.ownedBooks[0].uid).toBe('string')
    expect(dropped).toEqual(['gone'])
  })

  it('drops existing enchantments, anvil uses and spares when merging books, and wanted levels at or below the existing ones', () => {
    const book = parseInputState({ ...STORED, item: 'enchanted_book', anvilUsesOverride: 3 }, [])
    expect(book).toMatchObject({ existing: {}, anvilUsesOverride: null, extraItems: [] })
    const low = parseInputState({ ...STORED, wanted: { unbreaking: 2, efficiency: 5 } }, [])
    expect(low?.wanted).toEqual({ efficiency: 5 })
  })

  it('returns null for a malformed shape (non-integer or non-number anvil uses, ...)', () => {
    expect(parseInputState({ ...STORED, anvilUsesOverride: 1.5 }, [])).toBeNull()
    expect(parseInputState({ ...STORED, anvilUsesOverride: '1' }, [])).toBeNull()
    expect(parseInputState({ ...STORED, anvilUsesOverride: { value: 1 } }, [])).toBeNull()
    expect(parseInputState({ ...STORED, rename: 'yes' }, [])).toBeNull()
  })

  it('keeps out-of-range integers so they are reported as input problems', () => {
    const input = parseInputState({ ...STORED, ownedBooks: [{ enchantments: { mending: 1 }, count: 33, anvilUsesOverride: 11 }] }, [])
    expect(input?.ownedBooks[0]).toMatchObject({ count: 33, anvilUsesOverride: 11 })
  })

  it('reads settings field by field, defaulting only missing or unknown fields, and ignores fields it does not know', () => {
    expect(parseSession({ other: 'x', edition: 'bedrock', levelCap: 'x' })).toEqual({ ...DEFAULT_SESSION, edition: 'bedrock' })
    expect(parsePrefs({ lang: 'en', theme: 'nope' })).toEqual({ ...DEFAULT_PREFS, lang: 'en' })
  })
})

describe('restoring at startup', () => {
  it('reads the saved input and settings', () => {
    const storage = wrapStorage(
      memoryStorage({
        [STORAGE_KEYS.input]: JSON.stringify(STORED),
        [STORAGE_KEYS.session]: JSON.stringify({ edition: 'bedrock', levelCap: null, objective: 'xp' }),
      }),
    )
    const { initial, corrupt } = loadInitialState(storage)
    expect(corrupt).toBe(false)
    expect(initial.input).toMatchObject({ item: 'pickaxe', wanted: { efficiency: 5 }, rename: true })
    expect(initial.session).toEqual({ edition: 'bedrock', levelCap: null, objective: 'xp' })
  })

  it('ignores and deletes a corrupt value and shows the unreadable banner', () => {
    const raw = memoryStorage({ [STORAGE_KEYS.input]: '{not json' })
    const { initial, corrupt } = loadInitialState(wrapStorage(raw))
    expect(corrupt).toBe(true)
    expect(initial.input).toBeUndefined()
    expect(initial.system?.banners.storageCorrupt).toBe(true)
    expect(raw.data.has(STORAGE_KEYS.input)).toBe(false)
  })

  it('shows the storage banner when storage cannot be written', () => {
    const { available, initial } = loadInitialState(wrapStorage(memoryStorage({}, { failWrites: true })))
    expect(available).toBe(false)
    expect(initial.system?.banners.storageUnavailable).toBe(true)
  })

  it('works without localStorage', () => {
    expect(() => loadInitialState(wrapStorage(null))).not.toThrow()
  })

  it('ignores keys it does not know', () => {
    const raw = memoryStorage({
      [STORAGE_KEYS.input]: JSON.stringify(STORED),
      'kanatoko:v1:other:cafe0001': JSON.stringify({ done: [1] }),
      'other:input': '{not json',
    })
    const { initial, corrupt } = loadInitialState(wrapStorage(raw))
    expect(corrupt).toBe(false)
    expect(initial.input).toMatchObject({ item: 'pickaxe', wanted: { efficiency: 5 } })
    expect(initial.system?.banners.storageCorrupt).toBe(false)
  })

  it('writes nothing when nothing is saved', () => {
    const raw = memoryStorage()
    loadInitialState(wrapStorage(raw))
    expect(raw.data.has(STORAGE_KEYS.input)).toBe(false)
  })

  it('drops preference fields it does not know when writing them back', () => {
    const raw = memoryStorage({ [STORAGE_KEYS.prefs]: JSON.stringify({ lang: 'en', other: false }) })
    const { initial } = loadInitialState(wrapStorage(raw))
    expect(initial.prefs).toEqual({ ...DEFAULT_PREFS, lang: 'en' })
    expect(JSON.parse(raw.data.get(STORAGE_KEYS.prefs)!)).toEqual({ ...DEFAULT_PREFS, lang: 'en' })
  })
})

describe('writing changes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the input without uids after a 300ms debounce and settings immediately', () => {
    const raw = memoryStorage()
    const storage = wrapStorage(raw)
    const store = createAppStore({ storage })
    const stop = startPersistence(store, storage)

    store.getState().setItem('boots')
    store.getState().selectWanted('mending')
    store.getState().addOwnedBook({ enchantments: { mending: 1 }, count: 1, anvilUsesOverride: null })
    expect(raw.data.has(STORAGE_KEYS.input)).toBe(false)
    vi.advanceTimersByTime(299)
    expect(raw.data.has(STORAGE_KEYS.input)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(JSON.parse(raw.data.get(STORAGE_KEYS.input)!)).toEqual({
      ...DEFAULT_INPUT,
      item: 'boots',
      wanted: { mending: 1 },
      ownedBooks: [{ enchantments: { mending: 1 }, count: 1, anvilUsesOverride: null }],
    })

    store.getState().setTheme('dark')
    expect(JSON.parse(raw.data.get(STORAGE_KEYS.prefs)!).theme).toBe('dark')
    store.getState().setEdition('bedrock')
    expect(JSON.parse(raw.data.get(STORAGE_KEYS.session)!).edition).toBe('bedrock')
    stop()
  })

  it('writes pending input at once on stop and on pagehide', () => {
    const raw = memoryStorage()
    const storage = wrapStorage(raw)
    const store = createAppStore({ storage })
    const stop = startPersistence(store, storage)
    store.getState().setItem('pickaxe')
    window.dispatchEvent(new Event('pagehide'))
    expect(JSON.parse(raw.data.get(STORAGE_KEYS.input)!).item).toBe('pickaxe')
    stop()
  })

  it('shows the storage banner when a write fails', () => {
    const storage = wrapStorage(memoryStorage({}, { failWrites: true }))
    const store = createAppStore({ storage })
    const stop = startPersistence(store, storage)
    store.getState().setLang('en')
    expect(store.getState().system.banners.storageUnavailable).toBe(true)
    stop()
  })
})
