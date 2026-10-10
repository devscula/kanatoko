import { isEnchantmentId, isItemTypeId, maxLevel } from '../../data/gameData.ts'
import type { EnchantmentId } from '../../data/types.ts'
import { OBJECTIVE_KEYS } from '../../engine/index.ts'
import type { EnchantLevels, Objective } from '../../engine/index.ts'
import { createUid, repairInput, sortedLevels } from './convert.ts'
import {
  DEFAULT_PREFS,
  DEFAULT_SESSION,
  type AnvilUsesOverride,
  type ExtraItem,
  type InputDoc,
  type InputState,
  type MotionPref,
  type OwnedBook,
  type PrefsState,
  type SessionState,
  type ThemePref,
} from './types.ts'

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/** Thrown for unreadable values and caught by attempt(). */
class Invalid extends Error {}
const invalid = (): never => {
  throw new Invalid()
}

// Far above what can be calculated, even for a whole chest of books. Exceeding one makes the data unreadable, so a short
// share link cannot carry thousands of books that freeze the page or bloat storage.
const READ_LIMITS = {
  books: 256,
  extraItems: 64,
  count: 1024,
} as const

function readArray(v: unknown, max: number): unknown[] {
  return Array.isArray(v) && v.length <= max ? v : invalid()
}

function readInt(v: unknown): number {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : invalid()
}

/** Levels below 1 are kept and reported as level-out-of-range. */
function readLevel(id: EnchantmentId, level: unknown): number {
  return Math.min(readInt(level), maxLevel(id))
}

// Out-of-range values are kept and reported as anvil-uses-out-of-range
const readUses = readInt

/** Counts outside 1 to LIMITS.maxStackCount are kept and reported as count-out-of-range, up to READ_LIMITS.count. */
function readCount(v: unknown): number {
  const count = readInt(v)
  return count <= READ_LIMITS.count ? count : invalid()
}

function readLevels(raw: unknown, dropped: string[]): EnchantLevels {
  if (!isObject(raw)) return invalid()
  const out: EnchantLevels = {}
  for (const [id, level] of Object.entries(raw)) {
    if (!isEnchantmentId(id)) {
      dropped.push(id)
      continue
    }
    out[id] = readLevel(id, level)
  }
  return sortedLevels(out)
}

function attempt<T>(read: () => T): T | null {
  try {
    return read()
  } catch (error) {
    if (error instanceof Invalid) return null
    throw error
  }
}

/** null means automatic */
function readOverride(raw: unknown): AnvilUsesOverride | null {
  if (raw === null || raw === undefined) return null
  return readUses(raw)
}

const uidOf = (v: Json) => (typeof v.uid === 'string' && v.uid !== '' ? v.uid : createUid())

/**
 * Reads a stored InputState or a share link's InputPayload; null when malformed. Unknown IDs go into dropped and levels
 * above the maximum are clamped. Other out-of-range integers (level 0, 11 anvil uses, a count of 33) are kept for
 * validateProblem to report, so the user can fix them. The rename option, from share links, overrides the stored one.
 */
export function parseInputState(raw: unknown, dropped: string[], options: { readonly rename?: boolean } = {}): InputState | null {
  return attempt(() => {
    if (!isObject(raw)) return invalid()
    let item: InputState['item'] = null
    if (raw.item !== null && raw.item !== undefined) {
      if (isItemTypeId(raw.item)) item = raw.item
      else if (typeof raw.item === 'string') dropped.push(raw.item)
      else return invalid()
    }
    const rename = options.rename ?? (isBool(raw.rename) ? raw.rename : invalid())
    const ownedBooks: OwnedBook[] = readArray(raw.ownedBooks ?? [], READ_LIMITS.books).flatMap((b: unknown) => {
      if (!isObject(b)) return invalid()
      const enchantments = readLevels(b.enchantments, dropped)
      // Drop a book whose enchantments are all missing from the current data, since an empty book is an input error
      if (Object.keys(enchantments).length === 0 && Object.keys(b.enchantments as Json).length > 0) return []
      const count = b.count === undefined ? 1 : readCount(b.count)
      return [{ uid: uidOf(b), enchantments, count, anvilUsesOverride: readOverride(b.anvilUsesOverride) }]
    })
    const extraItems: ExtraItem[] = readArray(raw.extraItems ?? [], READ_LIMITS.extraItems).map((x: unknown) => {
      if (!isObject(x)) return invalid()
      return { uid: uidOf(x), enchantments: readLevels(x.enchantments, dropped), anvilUsesOverride: readOverride(x.anvilUsesOverride) }
    })
    const input: InputState = {
      item,
      existing: readLevels(raw.existing ?? {}, dropped),
      anvilUsesOverride: readOverride(raw.anvilUsesOverride),
      wanted: readLevels(raw.wanted ?? {}, dropped),
      ownedBooks,
      extraItems,
      rename,
    }
    return repairInput(input)
  })
}

export const isObjective = (v: unknown): v is Objective => typeof v === 'string' && Object.hasOwn(OBJECTIVE_KEYS, v)
const THEMES: readonly ThemePref[] = ['auto', 'light', 'dark']
const MOTIONS: readonly MotionPref[] = ['auto', 'reduce', 'full']

const oneOf = <T>(values: readonly T[], v: unknown, fallback: T): T => (values.includes(v as T) ? (v as T) : fallback)
const boolOr = (v: unknown, fallback: boolean): boolean => (isBool(v) ? v : fallback)

/** Only missing or unknown fields fall back to defaults, so one bad field does not discard the rest. */
export function parseSession(raw: unknown): SessionState {
  const r = isObject(raw) ? raw : {}
  return {
    edition: oneOf(['java', 'bedrock'], r.edition, DEFAULT_SESSION.edition),
    levelCap: oneOf([39, null], r.levelCap, DEFAULT_SESSION.levelCap),
    objective: isObjective(r.objective) ? r.objective : DEFAULT_SESSION.objective,
  }
}

/**
 * Only missing or unknown fields fall back to defaults. Fields follow the order of DEFAULT_PREFS because readSettings
 * rewrites storage whenever the JSON differs.
 */
export function parsePrefs(raw: unknown): PrefsState {
  const r = isObject(raw) ? raw : {}
  return {
    lang: oneOf(['ja', 'en'], r.lang, DEFAULT_PREFS.lang),
    theme: oneOf(THEMES, r.theme, DEFAULT_PREFS.theme),
    motion: oneOf(MOTIONS, r.motion, DEFAULT_PREFS.motion),
    singleKeyShortcuts: boolOr(r.singleKeyShortcuts, DEFAULT_PREFS.singleKeyShortcuts),
  }
}

export function parseInputDoc(raw: unknown, dropped: string[]): InputDoc | null {
  if (!isObject(raw)) return null
  const input = parseInputState(raw.input, dropped)
  if (input === null) return null
  return { input, session: parseSession(raw.session) }
}

export function parseJson(text: string | null): unknown {
  if (text === null) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
