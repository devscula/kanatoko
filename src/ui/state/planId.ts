import { GAME_DATA } from '../../data/gameData.generated.ts'
import { normalizeProblem } from '../../engine/index.ts'
import type { EnchantLevels, Problem, Settings } from '../../engine/index.ts'

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value)
    return json === undefined ? 'null' : json
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && typeof v !== 'function')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

const encoder = new TextEncoder()

export function fnv1a32(text: string): string {
  let hash = 0x811c9dc5
  for (const byte of encoder.encode(text)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The solver starts a new calculation only when the plan ID changes, and views use it to tell whether a result belongs
 * to the current input. Hashing the normalized inputs rather than the problem keeps the ID when the same steps come from
 * a SimpleProblem or an AdvancedProblem, or when a book to get is marked as owned.
 */
export function planIdOf(problem: Problem, settings: Settings): string {
  let inputs: unknown
  let goal: EnchantLevels | null = null
  try {
    const np = normalizeProblem(problem, settings)
    inputs = np.inputs.map(({ kind, itemType, enchantments, anvilUses }) => ({ kind, itemType, enchantments, anvilUses }))
    goal = np.goal
  } catch {
    // The problem fails validation (spare items while merging books, for example), so hash the problem itself
    inputs = problem
  }
  return fnv1a32(
    stableStringify({
      inputs,
      goal,
      useOnlyNeeded: true,
      settings,
      data: GAME_DATA.version,
    }),
  )
}
