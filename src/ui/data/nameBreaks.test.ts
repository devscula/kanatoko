import { describe, expect, it } from 'vitest'
import { getItem } from '../../data/gameData.ts'
import type { ItemTypeId } from '../../data/types.ts'
import { MESSAGES } from '../i18n/messages/index.ts'
import { BOOK_TILE_ADVANCED_BREAKS_JA, ITEM_NAME_BREAKS_JA } from './nameBreaks.ts'

describe('ITEM_NAME_BREAKS_JA', () => {
  it('splits each name into two or more parts that join back into the Japanese name', () => {
    for (const [id, parts] of Object.entries(ITEM_NAME_BREAKS_JA) as [ItemTypeId, readonly string[]][]) {
      expect(parts.join(''), id).toBe(getItem(id).name.ja)
      expect(parts.length, id).toBeGreaterThanOrEqual(2)
      expect(parts.every((p) => p !== ''), id).toBe(true)
    }
  })

  it('joins the book tile parts back into the item.bookTile message', () => {
    expect(BOOK_TILE_ADVANCED_BREAKS_JA.join('')).toBe(MESSAGES.ja['item.bookTile'])
  })

  it('breaks chestplate and carrot on a stick between words', () => {
    expect(ITEM_NAME_BREAKS_JA.chestplate).toEqual(['チェスト', 'プレート'])
    expect(ITEM_NAME_BREAKS_JA.carrot_on_a_stick).toEqual(['ニンジン', '付きの棒'])
  })
})
