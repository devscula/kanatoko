import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { GAME_DATA } from '../../data/gameData.generated.ts'
import { maxLevel } from '../../data/gameData.ts'
import type { EnchantLevels, Objective, Settings } from '../../engine/index.ts'
import { stableStringify } from '../state/planId.ts'
import { DEFAULT_INPUT, type InputState } from '../state/types.ts'
import { encodeBase64Url } from './base64url.ts'
import {
  canonicalPayload,
  encodeShareHash,
  encodeShareHashPlain,
  isShareHash,
  linksEqual,
  readShareHash,
  type ShareLink,
} from './shareHash.ts'

const ENCHANTMENTS = GAME_DATA.enchantments.map((e) => e.id)
const ITEMS = GAME_DATA.items.map((i) => i.id)

const levels = (maxLength: number): fc.Arbitrary<EnchantLevels> =>
  fc
    .uniqueArray(
      fc.constantFrom(...ENCHANTMENTS).chain((id) => fc.record({ id: fc.constant(id), level: fc.integer({ min: 1, max: maxLevel(id) }) })),
      { maxLength, selector: (e) => e.id },
    )
    .map((list) => Object.fromEntries(list.map((e) => [e.id, e.level])) as EnchantLevels)

const override = fc.option(fc.integer({ min: 0, max: 10 }), { nil: null })

const inputArb: fc.Arbitrary<InputState> = fc.record({
  item: fc.constantFrom(...ITEMS),
  existing: levels(3),
  anvilUsesOverride: override,
  wanted: levels(5),
  ownedBooks: fc.array(fc.record({ uid: fc.constant('u'), enchantments: levels(3).filter((l) => Object.keys(l).length > 0), count: fc.integer({ min: 1, max: 32 }), anvilUsesOverride: override }), {
    maxLength: 4,
  }),
  extraItems: fc.array(fc.record({ uid: fc.constant('x'), enchantments: levels(2), anvilUsesOverride: override }), { maxLength: 2 }),
  rename: fc.boolean(),
})

const settingsArb: fc.Arbitrary<Settings> = fc.record({
  edition: fc.constantFrom('java' as const, 'bedrock' as const),
  levelCap: fc.constantFrom(39 as const, null),
  objective: fc.constantFrom<Objective>('levels', 'xp', 'finalPwp'),
  rename: fc.boolean(),
})

/** The input after the repairs applied on read (see repairInput). Input already in this form round-trips unchanged. */
function repaired(input: InputState): InputState {
  const book = input.item === 'enchanted_book'
  const existing = book ? {} : input.existing
  const wanted = Object.fromEntries(Object.entries(input.wanted).filter(([id, l]) => (l as number) > ((existing as Record<string, number>)[id] ?? 0)))
  return { ...input, existing, anvilUsesOverride: book ? null : input.anvilUsesOverride, extraItems: book ? [] : input.extraItems, wanted }
}

const SETTINGS: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }

function readOk(hash: string) {
  const read = readShareHash(hash)
  if (read.kind !== 'ok') throw new Error(`not ok: ${JSON.stringify(read)}`)
  return read
}

describe('writing', () => {
  it('writes version 1 with the keys in the order v, e, o, cap, rn, d', async () => {
    const hash = await encodeShareHash({ input: { ...DEFAULT_INPUT, item: 'boots', wanted: { mending: 1 } }, settings: SETTINGS })
    expect(hash).toMatch(/^#v=1&e=java&o=levels&cap=39&rn=0&d=[zj]\.[A-Za-z0-9_-]+$/)
  })

  it('stores the input without uid or rename', () => {
    const payload = canonicalPayload({ ...DEFAULT_INPUT, item: 'boots', ownedBooks: [{ uid: 'abc', enchantments: { mending: 1 }, count: 2, anvilUsesOverride: null }], rename: true })
    expect(JSON.stringify(payload)).not.toContain('abc')
    expect(payload).not.toHaveProperty('rename')
  })
})

describe('round trip', () => {
  it('restores any repaired input and settings from the uncompressed form (j.)', () => {
    fc.assert(
      fc.property(inputArb, settingsArb, (input, settings) => {
        const link: ShareLink = { input: { ...input, rename: settings.rename }, settings }
        const read = readShareHash(encodeShareHashPlain(link))
        if (read.kind !== 'ok') return false
        expect(read.link.settings).toEqual(settings)
        expect(stableStringify(canonicalPayload(read.link.input))).toBe(stableStringify(canonicalPayload(repaired(link.input))))
        expect(read.link.input.rename).toBe(settings.rename)
        return true
      }),
      { numRuns: 150 },
    )
  })

  it('restores the input from the compressed form (z.)', async () => {
    const link: ShareLink = { input: { ...DEFAULT_INPUT, item: 'pickaxe', existing: { unbreaking: 3 }, wanted: { efficiency: 5 } }, settings: SETTINGS }
    const hash = await encodeShareHash(link, { compress: true })
    expect(linksEqual(readOk(hash).link, link)).toBe(true)
  })

  it('never throws on a link truncated at any point', () => {
    const hash = encodeShareHashPlain({ input: { ...DEFAULT_INPUT, item: 'boots', wanted: { protection: 4, mending: 1 } }, settings: SETTINGS })
    for (let n = 0; n < hash.length; n++) {
      const read = readShareHash(hash.slice(0, n))
      expect(['none', 'unreadable', 'ok']).toContain(read.kind)
    }
  })

  it('never throws on an arbitrary d value', () => {
    fc.assert(fc.property(fc.string(), (s) => ['none', 'unreadable', 'ok'].includes(readShareHash(`#v=1&e=java&o=levels&cap=39&rn=0&d=j.${s}`).kind)))
  })
})

describe('reading', () => {
  it('treats an empty hash or an in-page anchor as not a share link', () => {
    expect(readShareHash('').kind).toBe('none')
    expect(readShareHash('#step-3').kind).toBe('none')
    expect(isShareHash('#step-3')).toBe(false)
  })

  it('rejects any other version, keeping the rest of the link intact', () => {
    const hash = encodeShareHashPlain({ input: { ...DEFAULT_INPUT, item: 'boots', wanted: { mending: 1 } }, settings: SETTINGS })
    for (const version of ['0', '2', '99', '01', '']) {
      expect(readShareHash(hash.replace('#v=1&', `#v=${version}&`))).toEqual({ kind: 'unreadable', reason: 'version' })
    }
  })

  it('rejects missing keys and unknown values', () => {
    expect(readShareHash('#v=1&e=java&o=levels&cap=40&rn=0&d=j.e30')).toEqual({ kind: 'unreadable', reason: 'params' })
    expect(readShareHash('#v=1&e=java&o=levels&cap=39&rn=0')).toEqual({ kind: 'unreadable', reason: 'payload' })
  })

  it('repairs the input and reports IDs missing from the current data', () => {
    const payload = { item: 'enchanted_book', existing: { unbreaking: 3 }, anvilUsesOverride: 2, wanted: { mending: 1, gone: 1 }, ownedBooks: [], extraItems: [{ enchantments: {}, anvilUsesOverride: null }] }
    const read = readOk(`#v=1&e=java&o=levels&cap=39&rn=0&d=j.${encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)))}`)
    expect(read.link.input).toMatchObject({ item: 'enchanted_book', existing: {}, anvilUsesOverride: null, extraItems: [], wanted: { mending: 1 } })
    expect(read.dropped).toEqual(['gone'])
  })

  it('returns the validateProblem issues, such as a book with incompatible enchantments', () => {
    const link: ShareLink = { input: { ...DEFAULT_INPUT, item: 'mace', wanted: { density: 5 }, ownedBooks: [{ uid: 'a', enchantments: { breach: 4, density: 5 }, count: 1, anvilUsesOverride: null }] }, settings: SETTINGS }
    const read = readOk(encodeShareHashPlain(link))
    expect(read.issues.length).toBeGreaterThan(0)
  })

  it('ignores keys it does not know and keeps the link as written in canonical form', () => {
    const link: ShareLink = { input: { ...DEFAULT_INPUT, item: 'boots', wanted: { mending: 1 } }, settings: SETTINGS }
    const hash = encodeShareHashPlain(link)
    const read = readOk(`${hash}&x=1&utm_source=chat`)
    expect(linksEqual(read.link, link)).toBe(true)
    expect(read.hash).toBe(`${hash}&x=1&utm_source=chat`)
    expect(readOk(hash.replaceAll('&', '%26')).hash).toBe(hash)
  })
})

describe('comparing', () => {
  it('linksEqual ignores uid and order but tells settings apart', () => {
    const a: ShareLink = { input: { ...DEFAULT_INPUT, item: 'boots', wanted: { mending: 1, protection: 4 }, ownedBooks: [{ uid: 'a', enchantments: { mending: 1 }, count: 1, anvilUsesOverride: null }] }, settings: SETTINGS }
    const b: ShareLink = { input: { ...a.input, wanted: { protection: 4, mending: 1 }, ownedBooks: [{ ...a.input.ownedBooks[0], uid: 'b' }] }, settings: SETTINGS }
    expect(linksEqual(a, b)).toBe(true)
    expect(linksEqual(a, { ...b, settings: { ...SETTINGS, levelCap: null } })).toBe(false)
  })
})
