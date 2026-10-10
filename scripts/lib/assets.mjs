import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'

// Just enough of the zip format for client.jar and resource packs: stored and deflated entries, no zip64.
export function openZip(buffer) {
  const EOCD = 0x06054b50
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip file (end of central directory not found)')
  const count = buffer.readUInt16LE(eocd + 10)
  const dirOffset = buffer.readUInt32LE(eocd + 16)
  if (count === 0xffff || dirOffset === 0xffffffff) throw new Error('zip64 archives are not supported')
  const entries = new Map()
  let p = dirOffset
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error(`broken central directory at ${p}`)
    const method = buffer.readUInt16LE(p + 10)
    const compressedSize = buffer.readUInt32LE(p + 20)
    const size = buffer.readUInt32LE(p + 24)
    const nameLength = buffer.readUInt16LE(p + 28)
    const extraLength = buffer.readUInt16LE(p + 30)
    const commentLength = buffer.readUInt16LE(p + 32)
    const localOffset = buffer.readUInt32LE(p + 42)
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLength)
    entries.set(name, { method, compressedSize, size, localOffset })
    p += 46 + nameLength + extraLength + commentLength
  }
  return {
    read(name) {
      const entry = entries.get(name)
      if (entry === undefined) throw new Error(`not in the archive: ${name}`)
      const local = entry.localOffset
      if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(`broken local header: ${name}`)
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
      const data = buffer.subarray(start, start + entry.compressedSize)
      const out = entry.method === 0 ? Buffer.from(data) : entry.method === 8 ? inflateRawSync(data) : null
      if (out === null) throw new Error(`unsupported compression method ${entry.method}: ${name}`)
      if (out.length !== entry.size) throw new Error(`size mismatch: ${name}`)
      return out
    },
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export function pngSize(buffer, label) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error(`not a PNG: ${label}`)
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}
export function expectSquare(buffer, px, label) {
  const { width, height } = pngSize(buffer, label)
  if (width !== px || height !== px) throw new Error(`${label} is ${width}x${height}, expected ${px}x${px}`)
}

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
