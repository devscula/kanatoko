// Japanese has no spaces to wrap at, so long names list their word boundaries here. Joined, each entry must equal the
// name.

import type { ItemTypeId } from '../../data/types.ts'

export const ITEM_NAME_BREAKS_JA: Readonly<Partial<Record<ItemTypeId, readonly string[]>>> = {
  turtle_shell: ['カメの', '甲羅'],
  chestplate: ['チェスト', 'プレート'],
  flint_and_steel: ['火打石と', '打ち金'],
  carrot_on_a_stick: ['ニンジン', '付きの棒'],
  warped_fungus_on_a_stick: ['歪んだキノコ', '付きの棒'],
  recovery_compass: ['リカバリー', 'コンパス'],
  carved_pumpkin: ['くり抜かれた', 'カボチャ'],
  head: ['Mobの', '頭'],
  enchanted_book: ['エンチャント', 'の本'],
}

/** The same for the item.bookTile message. */
export const BOOK_TILE_ADVANCED_BREAKS_JA: readonly string[] = ['エンチャント', 'の本', '（本を', 'まとめる）']
