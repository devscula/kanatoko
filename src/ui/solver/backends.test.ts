import { describe, expect, it } from 'vitest'
import type { Settings } from '../../engine/index.ts'
import { placeholderOptionsFromSearch } from './placeholderBackend.ts'
import { defaultBackend } from './useSolveResult.ts'

const JAVA: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }

describe('dev flags (?fixture= and ?delay=)', () => {
  it('returns null without either flag so the real solver is used', () => {
    expect(placeholderOptionsFromSearch('')).toBeNull()
    expect(placeholderOptionsFromSearch('?lang=en')).toBeNull()
  })

  it('reads the fixture name and delay, using defaults for unknown names and non-positive delays', () => {
    expect(placeholderOptionsFromSearch('?fixture=bootsSevenBooks&delay=2000')).toEqual({ fixture: 'bootsSevenBooks', delayMs: 2000 })
    expect(placeholderOptionsFromSearch('?fixture=nope')).toEqual({ fixture: null, delayMs: undefined })
    expect(placeholderOptionsFromSearch('?delay=-5')).toEqual({ fixture: null, delayMs: undefined })
  })
})

describe('default backend', () => {
  it('uses the placeholder solver in unit tests, where node and jsdom have no Worker', async () => {
    expect(import.meta.env.MODE).toBe('test')
    const backend = defaultBackend()
    expect(backend.estimateComplexity({ mode: 'simple', item: 'boots', enchantments: [{ id: 'mending', level: 1 }] }, JAVA).level).toBe('instant')
    // The Worker client can't be created in node. The placeholder answers without one.
    expect(await backend.client.solve({ mode: 'simple', item: 'boots', enchantments: [] }, JAVA)).toEqual({ status: 'empty' })
    backend.client.dispose()
  })
})
