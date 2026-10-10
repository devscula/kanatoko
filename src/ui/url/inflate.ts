// Raw DEFLATE (RFC 1951) decoder. DecompressionStream is asynchronous, but main.tsx has to read the share-link hash
// before the first render to decide whether to show a shared plan, so this decodes synchronously. It follows zlib's
// puff.c (Mark Adler's reference inflater): canonical Huffman decoding one bit at a time.

// Share-link JSON is a few KB, so this leaves ample room and still stops decompression bombs
export const DEFAULT_MAX_OUTPUT = 1 << 20

const MAX_BITS = 15
const MAX_LIT_CODES = 286
const MAX_DIST_CODES = 30
const FIXED_LIT_CODES = 288

/** Base lengths and extra bits for length codes 257 to 285 */
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
/** Base distances and extra bits for distance codes 0 to 29 */
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385,
  24577,
]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
/** Order in which a dynamic Huffman block lists the code length code lengths */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

// inflateRaw turns this into null
class InflateError extends Error {}
const fail = (): never => {
  throw new InflateError()
}

/** Canonical Huffman code: the number of codes of each length, and the symbols in code order */
interface Huffman {
  readonly count: Uint16Array
  readonly symbol: Uint16Array
}

function buildHuffman(lengths: ArrayLike<number>, n: number): Huffman {
  const count = new Uint16Array(MAX_BITS + 1)
  const symbol = new Uint16Array(n)
  for (let s = 0; s < n; s++) count[lengths[s]]++
  // An over-subscribed table (more codes than the lengths allow) is corrupt. An incomplete one fails only when an unused code is read
  let left = 1
  for (let len = 1; len <= MAX_BITS; len++) {
    left = (left << 1) - count[len]
    if (left < 0) fail()
  }
  const offsets = new Uint16Array(MAX_BITS + 2)
  for (let len = 1; len <= MAX_BITS; len++) offsets[len + 1] = offsets[len] + count[len]
  for (let s = 0; s < n; s++) if (lengths[s] !== 0) symbol[offsets[lengths[s]]++] = s
  return { count, symbol }
}

const FIXED = (() => {
  const lengths = new Uint8Array(FIXED_LIT_CODES)
  lengths.fill(8, 0, 144)
  lengths.fill(9, 144, 256)
  lengths.fill(7, 256, 280)
  lengths.fill(8, 280, 288)
  return { lit: buildHuffman(lengths, FIXED_LIT_CODES), dist: buildHuffman(new Uint8Array(MAX_DIST_CODES).fill(5), MAX_DIST_CODES) }
})()

class Inflater {
  private readonly input: Uint8Array
  private readonly maxOutput: number
  private pos = 0
  private bitBuf = 0
  private bitCount = 0
  private out: Uint8Array
  private outLen = 0

  constructor(input: Uint8Array, maxOutput: number) {
    this.input = input
    this.maxOutput = maxOutput
    this.out = new Uint8Array(Math.min(maxOutput, Math.max(256, input.length * 4)))
  }

  run(): Uint8Array {
    let last = 0
    while (last === 0) {
      last = this.bits(1)
      const type = this.bits(2)
      if (type === 0) this.stored()
      else if (type === 1) this.codes(FIXED.lit, FIXED.dist)
      else if (type === 2) this.dynamic()
      else fail()
    }
    return this.out.slice(0, this.outLen)
  }

  /** Reads n bits (n <= 16), least significant first */
  private bits(n: number): number {
    let buf = this.bitBuf
    while (this.bitCount < n) {
      if (this.pos >= this.input.length) fail()
      buf |= this.input[this.pos++] << this.bitCount
      this.bitCount += 8
    }
    this.bitBuf = buf >>> n
    this.bitCount -= n
    return buf & ((1 << n) - 1)
  }

  private ensure(extra: number): void {
    const need = this.outLen + extra
    if (need > this.maxOutput) fail()
    if (need <= this.out.length) return
    const next = new Uint8Array(Math.min(this.maxOutput, Math.max(need, this.out.length * 2)))
    next.set(this.out.subarray(0, this.outLen))
    this.out = next
  }

  /** Stored block: aligns to a byte boundary, reads LEN and NLEN (the one's complement of LEN), then copies LEN bytes */
  private stored(): void {
    this.bitBuf = 0
    this.bitCount = 0
    if (this.pos + 4 > this.input.length) fail()
    const input = this.input
    const len = input[this.pos] | (input[this.pos + 1] << 8)
    const nlen = input[this.pos + 2] | (input[this.pos + 3] << 8)
    if (len !== (~nlen & 0xffff)) fail()
    this.pos += 4
    if (this.pos + len > input.length) fail()
    this.ensure(len)
    this.out.set(input.subarray(this.pos, this.pos + len), this.outLen)
    this.outLen += len
    this.pos += len
  }

  /** Reads one bit at a time until the code falls within the range for its length, then returns the symbol (decode() in puff.c) */
  private decode(h: Huffman): number {
    let code = 0
    let first = 0
    let index = 0
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= this.bits(1)
      const count = h.count[len]
      if (code - count < first) return h.symbol[index + (code - first)]
      index += count
      first = (first + count) << 1
      code <<= 1
    }
    return fail()
  }

  private codes(lit: Huffman, dist: Huffman): void {
    for (;;) {
      const symbol = this.decode(lit)
      if (symbol < 256) {
        this.ensure(1)
        this.out[this.outLen++] = symbol
        continue
      }
      if (symbol === 256) return
      const lengthIndex = symbol - 257
      if (lengthIndex >= LENGTH_BASE.length) fail()
      const length = LENGTH_BASE[lengthIndex] + this.bits(LENGTH_EXTRA[lengthIndex])
      const distIndex = this.decode(dist)
      if (distIndex >= DIST_BASE.length) fail()
      const distance = DIST_BASE[distIndex] + this.bits(DIST_EXTRA[distIndex])
      if (distance > this.outLen) fail()
      this.ensure(length)
      // Copy byte by byte because the source can overlap the destination (distance < length)
      for (let i = 0; i < length; i++) {
        this.out[this.outLen] = this.out[this.outLen - distance]
        this.outLen++
      }
    }
  }

  private dynamic(): void {
    const nlen = this.bits(5) + 257
    const ndist = this.bits(5) + 1
    const ncode = this.bits(4) + 4
    if (nlen > MAX_LIT_CODES || ndist > MAX_DIST_CODES) fail()
    const lengths = new Uint8Array(MAX_LIT_CODES + MAX_DIST_CODES)
    for (let i = 0; i < ncode; i++) lengths[CODE_LENGTH_ORDER[i]] = this.bits(3)
    const lencode = buildHuffman(lengths, CODE_LENGTH_ORDER.length)
    lengths.fill(0, 0, CODE_LENGTH_ORDER.length)

    let index = 0
    while (index < nlen + ndist) {
      const symbol = this.decode(lencode)
      if (symbol < 16) {
        lengths[index++] = symbol
        continue
      }
      let repeat: number
      let value = 0
      if (symbol === 16) {
        if (index === 0) fail()
        value = lengths[index - 1]
        repeat = 3 + this.bits(2)
      } else if (symbol === 17) {
        repeat = 3 + this.bits(3)
      } else {
        repeat = 11 + this.bits(7)
      }
      if (index + repeat > nlen + ndist) fail()
      lengths.fill(value, index, index + repeat)
      index += repeat
    }
    // Without a code for the end-of-block symbol (256) the block could never end
    if (lengths[256] === 0) fail()
    const lit = buildHuffman(lengths.subarray(0, nlen), nlen)
    const dist = buildHuffman(lengths.subarray(nlen, nlen + ndist), ndist)
    this.codes(lit, dist)
  }
}

/**
 * Decompresses raw DEFLATE. Returns null when the input is corrupt, truncated, or would exceed maxOutput.
 * Bytes after the final block are ignored, as zlib does.
 */
export function inflateRaw(input: Uint8Array, maxOutput: number = DEFAULT_MAX_OUTPUT): Uint8Array | null {
  try {
    return new Inflater(input, maxOutput).run()
  } catch (error) {
    if (error instanceof InflateError) return null
    throw error
  }
}
