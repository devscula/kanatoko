// Share-link hash format:
//
//   #v=1&e=java&o=levels&cap=39&rn=0&d=z.<payload>
//
//   v    format version, always first
//   e    java or bedrock, always second so the edition survives a truncated link
//   o    levels, xp or finalPwp
//   cap  39 or none
//   rn   rename, 0 or 1
//   d    InputPayload as UTF-8 JSON in base64url without padding: z. if deflate-raw compressed, j. if not.
//        Environments without CompressionStream write j.; reading accepts both.
//
// Other keys are ignored on read.

import type { Edition } from '../../data/types.ts'
import { validateProblem } from '../../engine/index.ts'
import type { Settings, ValidationIssue } from '../../engine/index.ts'
import { buildProblem } from '../state/buildProblem.ts'
import { sortedLevels } from '../state/convert.ts'
import { isObjective, parseInputState } from '../state/parse.ts'
import { stableStringify } from '../state/planId.ts'
import type { InputState } from '../state/types.ts'
import { decodeBase64Url, encodeBase64Url } from './base64url.ts'
import { deflateRaw, supportsDeflateRaw } from './compression.ts'
import { DEFAULT_MAX_OUTPUT, inflateRaw } from './inflate.ts'

const HASH_VERSION = 1

/** input.rename equals settings.rename */
export interface ShareLink {
  readonly input: InputState
  readonly settings: Settings
}

export type UnreadableReason =
  | 'version'
  /** e, o, cap or rn is missing or has an unknown value */
  | 'params'
  /** d is missing or does not decode, as with a truncated link */
  | 'payload'
  /** The JSON in d is not an input */
  | 'problem'

export type ShareHashRead =
  /** No hash, or one without v such as an in-page anchor */
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly reason: UnreadableReason }
  | {
      readonly kind: 'ok'
      readonly link: ShareLink
      /** IDs not in the current data */
      readonly dropped: readonly string[]
      readonly issues: readonly ValidationIssue[]
      /** Canonical form, so it can be shared again as is */
      readonly hash: string
    }

// Limits d after decompression to stop decompression bombs; the input JSON is a few KB
const MAX_PAYLOAD_BYTES = Math.min(DEFAULT_MAX_OUTPUT, 256 * 1024)

const encoder = new TextEncoder()

export interface HashParam {
  readonly key: string
  readonly value: string
}

// Undoes percent-encoding of the whole fragment (%26 and so on), which some chat apps apply
function fragmentBody(hash: string): string {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  if (!body.includes('%')) return body
  try {
    return decodeURIComponent(body)
  } catch {
    return body
  }
}

/** Keeps the order and duplicates. */
export function parseHashParams(hash: string): HashParam[] {
  const body = fragmentBody(hash)
  if (body === '') return []
  return body
    .split('&')
    .filter((part) => part !== '')
    .map((part) => {
      const at = part.indexOf('=')
      return at < 0 ? { key: part, value: '' } : { key: part.slice(0, at), value: part.slice(at + 1) }
    })
}

function formatHashParams(params: readonly HashParam[]): string {
  return params.length === 0 ? '' : `#${params.map(({ key, value }) => `${key}=${value}`).join('&')}`
}

export function isShareHash(hash: string): boolean {
  return parseHashParams(hash).some((p) => p.key === 'v')
}

/**
 * The form that gets shared and compared: percent-encoding undone and empty parameters dropped. '' when nothing is
 * left.
 */
export function canonicalHash(hash: string): string {
  return formatHashParams(parseHashParams(hash))
}

/** Leaves out the query, such as the dev-only ?fixture=. */
export function shareUrl(hash: string, location: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return `${location.origin}${location.pathname}${hash}`
}

/** Leaves out uid, and rename, which travels as rn. */
interface InputPayload {
  readonly item: InputState['item']
  readonly existing: InputState['existing']
  readonly anvilUsesOverride: InputState['anvilUsesOverride']
  readonly wanted: InputState['wanted']
  readonly ownedBooks: readonly { readonly enchantments: InputState['wanted']; readonly count: number; readonly anvilUsesOverride: InputState['anvilUsesOverride'] }[]
  readonly extraItems: readonly { readonly enchantments: InputState['wanted']; readonly anvilUsesOverride: InputState['anvilUsesOverride'] }[]
}

function inputPayloadOf(input: InputState): InputPayload {
  return {
    item: input.item,
    existing: input.existing,
    anvilUsesOverride: input.anvilUsesOverride,
    wanted: input.wanted,
    ownedBooks: input.ownedBooks.map(({ enchantments, count, anvilUsesOverride }) => ({ enchantments, count, anvilUsesOverride })),
    extraItems: input.extraItems.map(({ enchantments, anvilUsesOverride }) => ({ enchantments, anvilUsesOverride })),
  }
}

/** Equivalent inputs serialize the same. */
export function canonicalPayload(input: InputState): unknown {
  const payload = inputPayloadOf(input)
  return {
    ...payload,
    existing: sortedLevels(payload.existing),
    wanted: sortedLevels(payload.wanted),
    ownedBooks: payload.ownedBooks.map((b) => ({ ...b, enchantments: sortedLevels(b.enchantments) })),
    extraItems: payload.extraItems.map((x) => ({ ...x, enchantments: sortedLevels(x.enchantments) })),
  }
}

export function linksEqual(a: ShareLink, b: ShareLink): boolean {
  return (
    stableStringify(a.settings) === stableStringify(b.settings) &&
    stableStringify(canonicalPayload(a.input)) === stableStringify(canonicalPayload(b.input))
  )
}

function hashHead(link: ShareLink): string {
  const { settings } = link
  const cap = settings.levelCap === null ? 'none' : String(settings.levelCap)
  const rename = settings.rename ? 1 : 0
  return `#v=${HASH_VERSION}&e=${settings.edition}&o=${settings.objective}&cap=${cap}&rn=${rename}`
}

function payloadBytes(link: ShareLink): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(canonicalPayload(link.input)))
}

export function encodeShareHashPlain(link: ShareLink): string {
  return `${hashHead(link)}&d=j.${encodeBase64Url(payloadBytes(link))}`
}

/** Falls back to d=j. when compression is unavailable or fails. */
export async function encodeShareHash(link: ShareLink, options: { readonly compress?: boolean } = {}): Promise<string> {
  const compress = options.compress ?? supportsDeflateRaw()
  if (!compress) return encodeShareHashPlain(link)
  try {
    return `${hashHead(link)}&d=z.${encodeBase64Url(await deflateRaw(payloadBytes(link)))}`
  } catch {
    return encodeShareHashPlain(link)
  }
}

const decoder = new TextDecoder('utf-8', { fatal: true })

// null when unreadable; a JSON null comes back as { value: null }
function readPayload(d: string): { readonly value: unknown } | null {
  const dot = d.indexOf('.')
  if (dot < 0) return null
  const bytes = decodeBase64Url(d.slice(dot + 1))
  if (bytes === null) return null
  const kind = d.slice(0, dot)
  const raw = kind === 'z' ? inflateRaw(bytes, MAX_PAYLOAD_BYTES) : kind === 'j' && bytes.length <= MAX_PAYLOAD_BYTES ? bytes : null
  if (raw === null) return null
  try {
    return { value: JSON.parse(decoder.decode(raw)) as unknown }
  } catch {
    return null
  }
}

function readSettings(params: Readonly<Record<string, string>>): Settings | null {
  const { e, o, cap, rn } = params
  if (e !== 'java' && e !== 'bedrock') return null
  if (!isObjective(o)) return null
  if (cap !== '39' && cap !== 'none') return null
  if (rn !== '0' && rn !== '1') return null
  return { edition: e satisfies Edition, levelCap: cap === '39' ? 39 : null, objective: o, rename: rn === '1' }
}

const unreadable = (reason: UnreadableReason): ShareHashRead => ({ kind: 'unreadable', reason })

/** Never throws. */
export function readShareHash(hash: string): ShareHashRead {
  const params = parseHashParams(hash)
  const version = params.find((p) => p.key === 'v')?.value
  if (version === undefined) return { kind: 'none' }
  if (version !== String(HASH_VERSION)) return unreadable('version')

  const record: Record<string, string> = {}
  for (const { key, value } of params) {
    if (key === 'v' || Object.hasOwn(record, key)) continue
    record[key] = value
  }
  const { d, ...rest } = record
  if (d === undefined) return unreadable('payload')
  const payload = readPayload(d)
  if (payload === null) return unreadable('payload')

  const settings = readSettings(rest)
  if (settings === null) return unreadable('params')

  // Drops IDs missing from the current data, clamps levels to the maximum and repairs the input
  const dropped: string[] = []
  const input = parseInputState(payload.value, dropped, { rename: settings.rename })
  if (input === null) return unreadable('problem')

  // With no wanted enchantments nothing is calculated, so there is nothing to validate
  const built = buildProblem(input, settings)
  let issues: readonly ValidationIssue[] = []
  try {
    issues = built === null ? [] : validateProblem(built.problem, built.settings)
  } catch {
    issues = []
  }
  return {
    kind: 'ok',
    link: { input, settings },
    dropped: [...new Set(dropped)].sort(),
    issues,
    hash: canonicalHash(hash),
  }
}
