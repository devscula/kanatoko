// base64url as in RFC 4648 section 5, written without padding

// Bytes per String.fromCharCode call, to stay under the argument count limit
const CHUNK = 0x8000

const BASE64URL = /^[A-Za-z0-9_-]*$/

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Accepts padding. Returns null for invalid characters or an impossible length. */
export function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  const body = text.replace(/=+$/, '')
  // 4 characters encode 3 bytes, so no input produces a length that leaves 1 character over
  if (!BASE64URL.test(body) || body.length % 4 === 1) return null
  const padded = body.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (body.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return null
  }
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
