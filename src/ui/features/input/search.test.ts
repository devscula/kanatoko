import { describe, expect, it } from 'vitest'
import { GAME_DATA } from '../../../data/gameData.generated.ts'
import { enchantmentSearchNames, itemSearchNames } from './names.ts'
import { matchesQuery, normalizeQuery, queryRank, rankByQuery } from './search.ts'

describe('normalizeQuery', () => {
  it('folds full-width letters and half-width kana with NFKC, lowercases and turns hiragana into katakana', () => {
    expect(normalizeQuery('ＰＩＣＫＡＸＥ')).toBe('pickaxe')
    expect(normalizeQuery('ﾂﾙﾊｼ')).toBe('ツルハシ')
    expect(normalizeQuery('つるはし')).toBe('ツルハシ')
    expect(normalizeQuery('Mending')).toBe('mending')
  })

  it('removes whitespace, full-width included, and the middle dot', () => {
    expect(normalizeQuery(' Fire　Protection ')).toBe('fireprotection')
    expect(normalizeQuery('ソウル・スピード')).toBe('ソウルスピード')
    expect(normalizeQuery('ｿｳﾙ･ｽﾋﾟｰﾄﾞ')).toBe('ソウルスピード')
  })

  it('converts only the hiragana range and leaves the long vowel mark and kanji alone', () => {
    expect(normalizeQuery('ぁゖー火')).toBe('ァヶー火')
  })
})

describe('matchesQuery and queryRank', () => {
  it('matches the pickaxe from hiragana, katakana or English', () => {
    for (const q of ['つるはし', 'ツルハシ', 'pickaxe', 'ＰｉｃｋＡｘｅ', 'ﾂﾙﾊｼ']) {
      expect(matchesQuery(q, itemSearchNames('pickaxe')), q).toBe(true)
    }
  })

  it('matches mending by its English name and density by its Bedrock Edition Japanese name in either edition', () => {
    expect(matchesQuery('mending', enchantmentSearchNames('mending'))).toBe(true)
    expect(matchesQuery('密度', enchantmentSearchNames('density'))).toBe(true)
    expect(matchesQuery('しのび足', enchantmentSearchNames('swift_sneak'))).toBe(true)
    expect(matchesQuery('密度', enchantmentSearchNames('sharpness'))).toBe(false)
  })

  it('matches everything with an empty or blank query', () => {
    expect(matchesQuery('', ['ブーツ'])).toBe(true)
    expect(matchesQuery('  ', ['ブーツ'])).toBe(true)
  })

  it('ranks a prefix match 0, a substring match 1 and no match -1', () => {
    expect(queryRank('ぶー', ['ブーツ', 'Boots'])).toBe(0)
    expect(queryRank('ツ', ['ブーツ', 'Boots'])).toBe(1)
    expect(queryRank('xyz', ['ブーツ', 'Boots'])).toBe(-1)
  })

  it('puts prefix matches first in rankByQuery and keeps the original order within a rank', () => {
    const items = ['クロスボウ', 'ボウル', '弓', 'ボウガン'] as const
    expect(rankByQuery('ぼう', items, (s) => [s])).toEqual(['ボウル', 'ボウガン', 'クロスボウ'])
  })

  it('finds every item and enchantment by its own Japanese or English name', () => {
    for (const item of GAME_DATA.items) {
      expect(matchesQuery(item.name.ja, itemSearchNames(item.id))).toBe(true)
      expect(matchesQuery(item.name.en.toUpperCase(), itemSearchNames(item.id))).toBe(true)
    }
    for (const e of GAME_DATA.enchantments) {
      expect(matchesQuery(e.name.en, enchantmentSearchNames(e.id))).toBe(true)
      expect(matchesQuery(e.name.ja, enchantmentSearchNames(e.id))).toBe(true)
    }
  })
})
