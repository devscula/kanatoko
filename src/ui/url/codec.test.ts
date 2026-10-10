// inflateRaw is checked against random input compressed by Node's CompressionStream('deflate-raw'), which uses zlib.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeBase64Url, encodeBase64Url } from './base64url.ts'
import { deflateRaw, supportsDeflateRaw } from './compression.ts'
import { inflateRaw } from './inflate.ts'

const bytes = (...values: number[]) => new Uint8Array(values)

describe('base64url', () => {
  it('writes only URL-safe characters, without padding', () => {
    expect(encodeBase64Url(bytes())).toBe('')
    expect(encodeBase64Url(bytes(0xfb, 0xff))).toBe('-_8')
    expect(encodeBase64Url(new TextEncoder().encode('hello'))).toBe('aGVsbG8')
  })

  it('round-trips any byte sequence', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2048 }), (data) => {
        const text = encodeBase64Url(data)
        expect(text).toMatch(/^[A-Za-z0-9_-]*$/)
        expect(decodeBase64Url(text)).toEqual(data)
      }),
    )
  })

  it('encodes large byte arrays in chunks', () => {
    const data = new Uint8Array(200_000).map((_, i) => i % 251)
    expect(decodeBase64Url(encodeBase64Url(data))).toEqual(data)
  })

  it('returns null for invalid characters or an impossible length, including standard base64 + and /', () => {
    expect(decodeBase64Url('a+b/')).toBeNull()
    expect(decodeBase64Url('abc!')).toBeNull()
    expect(decodeBase64Url('abcde')).toBeNull()
    expect(decodeBase64Url('\u3042')).toBeNull()
  })

  it('accepts trailing padding', () => {
    expect(decodeBase64Url('aGVsbG8=')).toEqual(new TextEncoder().encode('hello'))
  })
})

describe('inflateRaw', () => {
  it('decodes stored, fixed Huffman and dynamic Huffman blocks', () => {
    // Stored block (final block, LEN=3, NLEN=~3)
    expect(inflateRaw(bytes(0x01, 0x03, 0x00, 0xfc, 0xff, 0x61, 0x62, 0x63))).toEqual(bytes(0x61, 0x62, 0x63))
    // Fixed Huffman: zlib's deflateRaw('a')
    expect(inflateRaw(bytes(0x4b, 0x04, 0x00))).toEqual(bytes(0x61))
    // Fixed Huffman with a back-reference ('aaaaaaaaaa')
    expect(new TextDecoder().decode(inflateRaw(bytes(0x4b, 0x4c, 0x84, 0x01, 0x00))!)).toBe('aaaaaaaaaa')
    // Empty
    expect(inflateRaw(bytes(0x03, 0x00))).toEqual(bytes())
  })

  it.runIf(supportsDeflateRaw())('decompresses CompressionStream output for any byte sequence', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 4096 }), async (data) => {
        expect(inflateRaw(await deflateRaw(data))).toEqual(data)
      }),
      { numRuns: 150 },
    )
  })

  it.runIf(supportsDeflateRaw())('decompresses CompressionStream output for repetitive text (dynamic Huffman, long distances)', async () => {
    const word = fc.constantFrom('protection', 'mending', '"level":', '{"id":', 'unbreaking', 'boots', '\u3042\u3044\u3046', '0', '}]')
    await fc.assert(
      fc.asyncProperty(fc.array(word, { maxLength: 3000 }), async (words) => {
        const data = new TextEncoder().encode(words.join(''))
        expect(inflateRaw(await deflateRaw(data))).toEqual(data)
      }),
      { numRuns: 100 },
    )
  })

  it.runIf(supportsDeflateRaw())('returns null for input truncated anywhere, down to the last byte', async () => {
    const data = new TextEncoder().encode(JSON.stringify({ mode: 'simple', item: 'boots', enchantments: [{ id: 'mending', level: 1 }] }))
    const packed = await deflateRaw(data)
    for (let length = 0; length < packed.length; length++) expect(inflateRaw(packed.subarray(0, length))).toBeNull()
    expect(inflateRaw(packed)).toEqual(data)
  })

  it('never throws on corrupt input', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (data) => {
        const out = inflateRaw(data)
        expect(out === null || out instanceof Uint8Array).toBe(true)
      }),
      { numRuns: 2000 },
    )
  })

  it('returns null for block type 3, a mismatched NLEN and a distance reaching before the start', () => {
    expect(inflateRaw(bytes(0x07))).toBeNull()
    expect(inflateRaw(bytes(0x01, 0x03, 0x00, 0x00, 0x00, 0x61, 0x62, 0x63))).toBeNull()
    // Fixed Huffman starting with a distance-1 copy (nothing precedes it)
    expect(inflateRaw(bytes(0x03, 0x02, 0x00))).toBeNull()
  })

  it.runIf(supportsDeflateRaw())('returns null when the output exceeds the limit (decompression bomb)', async () => {
    const packed = await deflateRaw(new Uint8Array(100_000))
    expect(packed.length).toBeLessThan(200)
    expect(inflateRaw(packed, 50_000)).toBeNull()
    expect(inflateRaw(packed, 100_000)).toHaveLength(100_000)
  })
})
