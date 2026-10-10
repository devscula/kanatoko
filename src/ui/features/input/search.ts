// Kana readings are not matched because the game data has none.

const HIRAGANA_TO_KATAKANA = 0x60
const HIRAGANA = /[ぁ-ゖ]/g
const IGNORED = /[\s・]/gu

/** NFKC first, which folds full-width letters and digits and half-width kana. */
export function normalizeQuery(q: string): string {
  return q
    .normalize('NFKC')
    .toLowerCase()
    .replace(HIRAGANA, (c) => String.fromCharCode(c.charCodeAt(0) + HIRAGANA_TO_KATAKANA))
    .replace(IGNORED, '')
}

/** 0 for a prefix match on any name, 1 for a substring match, -1 for none. */
export function queryRank(query: string, names: readonly string[]): -1 | 0 | 1 {
  const q = normalizeQuery(query)
  if (q === '') return 0
  let rank: -1 | 0 | 1 = -1
  for (const name of names) {
    const index = normalizeQuery(name).indexOf(q)
    if (index === 0) return 0
    if (index > 0) rank = 1
  }
  return rank
}

export function matchesQuery(query: string, names: readonly string[]): boolean {
  return queryRank(query, names) >= 0
}

export function rankByQuery<T>(query: string, items: readonly T[], namesOf: (item: T) => readonly string[]): T[] {
  return items
    .map((item, index) => ({ item, index, rank: queryRank(query, namesOf(item)) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item)
}
