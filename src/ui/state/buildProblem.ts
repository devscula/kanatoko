import { getEnchantment, maxLevel } from '../../data/gameData.ts'
import { compareTooltipOrder, tooltipPosition } from '../../data/tooltipOrder.ts'
import type { EnchantmentId } from '../../data/types.ts'
import { defaultAnvilUses, reachableLevel } from '../../engine/index.ts'
import type { AdvancedProblem, BookInput, EnchantLevels, ItemInput, Problem, Settings, SimpleProblem } from '../../engine/index.ts'
import { buildSettings, enchantEntries, isBookTarget, sortedLevels } from './convert.ts'
import { planIdOf } from './planId.ts'
import type { InputState, SessionState } from './types.ts'

export { planIdOf }

export type InputSource =
  | { readonly kind: 'target' }
  | { readonly kind: 'extra'; readonly index: number }
  /** copy counts from 0 within ownedBooks[index] */
  | { readonly kind: 'owned'; readonly index: number; readonly copy: number }
  /** A book to get */
  | { readonly kind: 'supplement'; readonly enchantment: EnchantmentId; readonly level: number }

export type Coverage =
  /** On the item and not wanted */
  | { readonly kind: 'existing'; readonly level: number }
  | { readonly kind: 'owned'; readonly reachable: number }
  /**
   * Owned items fall short, so a book to get was added. reachable is the level they do reach (0 = none). cursedOnly
   * means only owned items excluded for an unwanted curse have this enchantment.
   */
  | { readonly kind: 'supplement'; readonly reachable: number; readonly cursedOnly: boolean }

export type ExcludedReason = 'below-wanted' | 'curse'

export interface BuiltProblem {
  readonly problem: Problem
  readonly settings: Settings
  /** Same order and length as the inputs of normalizeProblem */
  readonly inputSources: readonly InputSource[]
  /** Books to get, in tooltip order */
  readonly supplements: readonly { readonly id: EnchantmentId; readonly level: number }[]
  /** Owned items left out of the problem, one entry per copy */
  readonly excluded: readonly { readonly source: InputSource; readonly reason: ExcludedReason }[]
  /** Enchantments that got a book to get only because of the fallback option */
  readonly fallback: readonly EnchantmentId[]
  /** Automatic values filled in. books and extras follow the order of ownedBooks and extraItems. */
  readonly effectiveUses: { readonly item: number; readonly books: readonly number[]; readonly extras: readonly number[] }
  /** One entry per row of the wanted enchantments list */
  readonly coverage: Readonly<Partial<Record<EnchantmentId, Coverage>>>
  readonly planId: string
}

export interface BuildOptions {
  /** For the retry after an infeasible result: adds books to get even where owned items reach the level */
  readonly fallback?: boolean
}

interface SortableBook {
  readonly entries: readonly { readonly id: EnchantmentId; readonly level: number }[]
  readonly anvilUses: number
  /** 0 = owned (spares included), 1 = book to get */
  readonly rank: number
}

// A fixed order keeps the steps and the plan ID independent of the order things were entered in. For
// single-enchantment books it matches the tooltip order of a SimpleProblem.
export function compareBooks(a: SortableBook, b: SortableBook): number {
  const n = Math.min(a.entries.length, b.entries.length)
  for (let i = 0; i < n; i++) {
    const ea = a.entries[i]
    const eb = b.entries[i]
    if (ea.id !== eb.id) return tooltipPosition(ea.id) - tooltipPosition(eb.id)
    if (ea.level !== eb.level) return eb.level - ea.level
  }
  if (a.entries.length !== b.entries.length) return a.entries.length - b.entries.length
  if (a.anvilUses !== b.anvilUses) return a.anvilUses - b.anvilUses
  return a.rank - b.rank
}

const isCurse = (id: EnchantmentId) => getEnchantment(id).curse

export function buildProblem(input: InputState, session: SessionState, options: BuildOptions = {}): BuiltProblem | null {
  const { item } = input
  if (item === null) return null
  const wanted = sortedLevels(input.wanted)
  const wantedEntries = enchantEntries(wanted)
  if (wantedEntries.length === 0) return null

  const { edition } = session
  const settings = buildSettings(session, input.rename)
  const book = isBookTarget(item)
  const existing = book ? {} : sortedLevels(input.existing)
  const extrasInput = book ? [] : input.extraItems

  const itemUses = book ? 0 : (input.anvilUsesOverride ?? defaultAnvilUses(edition, item, existing))
  const bookUses = input.ownedBooks.map((b) => b.anvilUsesOverride ?? defaultAnvilUses(edition, null, b.enchantments))
  const extraUses = extrasInput.map((x) => x.anvilUsesOverride ?? defaultAnvilUses(edition, item, x.enchantments))

  // Owned items with a curse that is neither wanted nor existing are excluded, since using them puts the curse on the result
  const keepCurse = (id: EnchantmentId) => wanted[id] !== undefined || existing[id] !== undefined
  const hasUnwantedCurse = (levels: EnchantLevels) => enchantEntries(levels).some((e) => isCurse(e.id) && !keepCurse(e.id))
  const cursedBook = input.ownedBooks.map((b) => hasUnwantedCurse(b.enchantments))
  const cursedExtra = extrasInput.map((x) => hasUnwantedCurse(x.enchantments))

  // A wanted enchantment that owned items cannot reach (two equal levels combine into the next) gets a book to get
  const coverage: Partial<Record<EnchantmentId, { kind: 'existing'; level: number } | { kind: 'owned'; reachable: number } | { kind: 'supplement'; reachable: number; cursedOnly: boolean }>> = {}
  for (const { id, level } of enchantEntries(existing)) if (wanted[id] === undefined) coverage[id] = { kind: 'existing', level }
  const supplementIds = new Set<EnchantmentId>()
  const fallback: EnchantmentId[] = []
  for (const { id, level } of wantedEntries) {
    const levels: number[] = []
    let cursedHolder = false
    if (existing[id] !== undefined) levels.push(existing[id])
    input.ownedBooks.forEach((b, i) => {
      const l = b.enchantments[id]
      if (l === undefined) return
      if (cursedBook[i]) cursedHolder = true
      else for (let c = 0; c < b.count; c++) levels.push(l)
    })
    extrasInput.forEach((x, i) => {
      const l = x.enchantments[id]
      if (l === undefined) return
      if (cursedExtra[i]) cursedHolder = true
      else levels.push(l)
    })
    const reachable = reachableLevel(levels, maxLevel(id))
    if (reachable >= level) {
      coverage[id] = { kind: 'owned', reachable }
      if (options.fallback) fallback.push(id)
    } else {
      coverage[id] = { kind: 'supplement', reachable, cursedOnly: levels.length === 0 && cursedHolder }
      supplementIds.add(id)
    }
  }
  const supplements = wantedEntries.filter((e) => supplementIds.has(e.id) || fallback.includes(e.id))

  // Java Edition only: owned books whose enchantments all have a book to get are excluded. Leaving them out never raises
  // any step's cost, yet they count toward the search size. Bedrock Edition charges only the levels gained, so a lower book
  // applied first can split the cost and lower the max per step; there they stay in.
  const excluded: { source: InputSource; reason: ExcludedReason }[] = []
  const bookExcluded: (ExcludedReason | null)[] = input.ownedBooks.map((b, i) => {
    if (cursedBook[i]) return 'curse'
    if (edition !== 'java') return null
    const entries = enchantEntries(b.enchantments)
    return entries.length > 0 && entries.every((e) => supplementIds.has(e.id)) ? 'below-wanted' : null
  })
  input.ownedBooks.forEach((b, index) => {
    const reason = bookExcluded[index]
    if (reason !== null) for (let copy = 0; copy < b.count; copy++) excluded.push({ source: { kind: 'owned', index, copy }, reason })
  })
  extrasInput.forEach((_, index) => {
    if (cursedExtra[index]) excluded.push({ source: { kind: 'extra', index }, reason: 'curse' })
  })

  const engineBooks = input.ownedBooks.map((b, index) => ({ b, index })).filter(({ index }) => bookExcluded[index] === null)
  const engineExtras = extrasInput.map((x, index) => ({ x, index })).filter(({ index }) => !cursedExtra[index])

  let problem: Problem
  const inputSources: InputSource[] = []
  const effectiveUses = { item: itemUses, books: bookUses, extras: extraUses }

  // Nothing but books to get: a SimpleProblem is enough
  if (enchantEntries(existing).length === 0 && itemUses === 0 && engineBooks.length === 0 && engineExtras.length === 0) {
    const simple: SimpleProblem = { mode: 'simple', item, enchantments: wantedEntries.map(({ id, level }) => ({ id, level })) }
    problem = simple
    if (!book) inputSources.push({ kind: 'target' })
    for (const { id, level } of wantedEntries) inputSources.push({ kind: 'supplement', enchantment: id, level })
  } else {
    type Row = SortableBook & { readonly input: BookInput; readonly sources: InputSource[] }
    const rows: Row[] = []
    for (const { b, index } of engineBooks) {
      const enchantments = sortedLevels(b.enchantments)
      const bookInput: BookInput = b.count === 1 ? { enchantments, anvilUses: bookUses[index] } : { enchantments, anvilUses: bookUses[index], count: b.count }
      const sources: InputSource[] = []
      for (let copy = 0; copy < b.count; copy++) sources.push({ kind: 'owned', index, copy })
      rows.push({ entries: enchantEntries(enchantments), anvilUses: bookUses[index], rank: 0, input: bookInput, sources })
    }
    for (const { id, level } of supplements) {
      rows.push({
        entries: [{ id, level }],
        anvilUses: 0,
        rank: 1,
        input: { enchantments: { [id]: level }, anvilUses: 0 },
        sources: [{ kind: 'supplement', enchantment: id, level }],
      })
    }
    rows.sort(compareBooks)

    const extraRows = engineExtras
      .map(({ x, index }) => {
        const enchantments = sortedLevels(x.enchantments)
        return { entries: enchantEntries(enchantments), anvilUses: extraUses[index], rank: 0, index, input: { enchantments, anvilUses: extraUses[index] } satisfies ItemInput }
      })
      .sort(compareBooks)

    const advanced: AdvancedProblem = {
      mode: 'advanced',
      target: book ? null : { itemType: item, enchantments: existing, anvilUses: itemUses },
      extraItems: extraRows.map((r) => r.input),
      books: rows.map((r) => r.input),
      goal: wanted,
      useOnlyNeeded: true,
    }
    problem = advanced
    if (!book) inputSources.push({ kind: 'target' })
    for (const r of extraRows) inputSources.push({ kind: 'extra', index: r.index })
    for (const r of rows) inputSources.push(...r.sources)
  }

  return {
    problem,
    settings,
    inputSources,
    supplements: [...supplements].sort((a, b) => compareTooltipOrder(a.id, b.id)),
    excluded,
    fallback,
    effectiveUses,
    coverage,
    planId: planIdOf(problem, settings),
  }
}

/** A fallback retry only helps if some wanted enchantment got no book to get because owned items reach it. */
export function canFallback(built: BuiltProblem): boolean {
  return Object.values(built.coverage).some((c) => c?.kind === 'owned')
}

/**
 * Owned books whose enchantments all have a book to get, not counting those excluded for a curse. buildProblem
 * already leaves them out in Java Edition; in Bedrock Edition the too-complex view offers to remove them.
 */
export function ownedBooksCoveredBySupplements(input: InputState, built: BuiltProblem): number[] {
  const cursed = new Set(built.excluded.flatMap((e) => (e.reason === 'curse' && e.source.kind === 'owned' ? [e.source.index] : [])))
  return input.ownedBooks.flatMap((b, index) => {
    if (cursed.has(index)) return []
    const entries = enchantEntries(b.enchantments)
    return entries.length > 0 && entries.every((e) => built.coverage[e.id]?.kind === 'supplement') ? [index] : []
  })
}
