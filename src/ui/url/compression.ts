// Decompression is synchronous and lives in inflate.ts.

/** Older browsers without 'deflate-raw' throw from the constructor. */
export function supportsDeflateRaw(): boolean {
  if (typeof CompressionStream !== 'function') return false
  try {
    new CompressionStream('deflate-raw')
    return true
  } catch {
    return false
  }
}

/** Throws without CompressionStream, so callers check supportsDeflateRaw first. */
export async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new CompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  // The write can wait on the reader, so await it alongside the read loop
  const writing = writer.write(bytes).then(() => writer.close())
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  await writing
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
