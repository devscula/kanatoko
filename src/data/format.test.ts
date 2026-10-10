import { enchantmentName, formatEnchantment, itemName, romanNumeral } from './format.ts'
import { GAME_DATA } from './gameData.generated.ts'
import type { Edition } from './types.ts'

const EDITIONS: readonly Edition[] = ['java', 'bedrock']

describe('romanNumeral', () => {
  it('uses ASCII Roman numerals I-X', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(romanNumeral)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'])
    expect(romanNumeral(4)).toMatch(/^[\x20-\x7e]+$/)
  })

  it('falls back to Arabic digits outside I-X', () => {
    expect(romanNumeral(0)).toBe('0')
    expect(romanNumeral(11)).toBe('11')
    expect(romanNumeral(-1)).toBe('-1')
    expect(romanNumeral(1.5)).toBe('1.5')
  })
})

describe('enchantmentName', () => {
  it('uses the official Java names', () => {
    expect(enchantmentName('sharpness', 'java', 'ja')).toBe('ダメージ増加')
    expect(enchantmentName('sharpness', 'java', 'en')).toBe('Sharpness')
    expect(enchantmentName('binding_curse', 'java', 'ja')).toBe('束縛の呪い')
    expect(enchantmentName('binding_curse', 'bedrock', 'en')).toBe('Curse of Binding')
  })

  it('switches the four Bedrock ja names and keeps English', () => {
    expect(enchantmentName('breach', 'bedrock', 'ja')).toBe('違反')
    expect(enchantmentName('density', 'bedrock', 'ja')).toBe('密度')
    expect(enchantmentName('wind_burst', 'bedrock', 'ja')).toBe('爆風')
    expect(enchantmentName('swift_sneak', 'bedrock', 'ja')).toBe('しのび足速度上昇')
    expect(enchantmentName('breach', 'java', 'ja')).toBe('防具貫通')
    expect(enchantmentName('density', 'java', 'ja')).toBe('重撃')
    expect(enchantmentName('wind_burst', 'java', 'ja')).toBe('ウィンドバースト')
    expect(enchantmentName('swift_sneak', 'java', 'ja')).toBe('スニーク速度上昇')
    expect(enchantmentName('breach', 'bedrock', 'en')).toBe('Breach')
    expect(enchantmentName('swift_sneak', 'bedrock', 'en')).toBe('Swift Sneak')
  })

  it('names an enchantment that is missing from the edition by its Java name', () => {
    expect(enchantmentName('sweeping_edge', 'bedrock', 'ja')).toBe('範囲ダメージ増加')
    expect(enchantmentName('sweeping_edge', 'bedrock', 'en')).toBe('Sweeping Edge')
  })

  it('differs between editions only for those four ids', () => {
    const differing = GAME_DATA.enchantments
      .filter((e) => enchantmentName(e.id, 'java', 'ja') !== enchantmentName(e.id, 'bedrock', 'ja'))
      .map((e) => e.id)
    expect(differing).toEqual(['breach', 'density', 'swift_sneak', 'wind_burst'])
    for (const e of GAME_DATA.enchantments) {
      expect(enchantmentName(e.id, 'java', 'en')).toBe(enchantmentName(e.id, 'bedrock', 'en'))
    }
  })
})

describe('itemName', () => {
  it('uses the official names', () => {
    expect(itemName('trident', 'java', 'ja')).toBe('トライデント')
    expect(itemName('fishing_rod', 'java', 'ja')).toBe('釣竿')
    expect(itemName('head', 'bedrock', 'ja')).toBe('Mobの頭')
    expect(itemName('head', 'java', 'en')).toBe('Mob Head')
    expect(itemName('recovery_compass', 'bedrock', 'ja')).toBe('リカバリーコンパス')
    expect(itemName('enchanted_book', 'java', 'ja')).toBe('エンチャントの本')
    expect(itemName('turtle_shell', 'java', 'en')).toBe('Turtle Shell')
  })

  it('is the same in both editions', () => {
    for (const item of GAME_DATA.items) {
      expect(itemName(item.id, 'java', 'ja')).toBe(itemName(item.id, 'bedrock', 'ja'))
    }
  })
})

describe('formatEnchantment', () => {
  it('joins the name and the Roman numeral with a half-width space', () => {
    expect(formatEnchantment('protection', 4, 'java', 'ja')).toBe('ダメージ軽減 IV')
    expect(formatEnchantment('protection', 4, 'java', 'en')).toBe('Protection IV')
    expect(formatEnchantment('sharpness', 5, 'java', 'ja')).toBe('ダメージ増加 V')
    expect(formatEnchantment('breach', 4, 'bedrock', 'ja')).toBe('違反 IV')
    expect(formatEnchantment('wind_burst', 3, 'java', 'ja')).toBe('ウィンドバースト III')
  })

  it('omits the level of an enchantment whose max level is I', () => {
    expect(formatEnchantment('mending', 1, 'java', 'ja')).toBe('修繕')
    expect(formatEnchantment('mending', 1, 'java', 'en')).toBe('Mending')
    expect(formatEnchantment('vanishing_curse', 1, 'bedrock', 'ja')).toBe('消滅の呪い')
  })

  it('shows level I when the max level is higher', () => {
    expect(formatEnchantment('efficiency', 1, 'java', 'ja')).toBe('効率強化 I')
    expect(formatEnchantment('unbreaking', 1, 'bedrock', 'en')).toBe('Unbreaking I')
  })

  it('shows an out-of-range level like the game (level ≠ 1 always gets a numeral)', () => {
    expect(formatEnchantment('mending', 2, 'java', 'ja')).toBe('修繕 II')
  })

  it('formats every level of every enchantment as name + space + numeral, except max level I', () => {
    for (const edition of EDITIONS) {
      for (const e of GAME_DATA.enchantments) {
        for (let level = 1; level <= e.maxLevel; level++) {
          const name = enchantmentName(e.id, edition, 'ja')
          const expected = e.maxLevel === 1 ? name : `${name} ${romanNumeral(level)}`
          expect(formatEnchantment(e.id, level, edition, 'ja')).toBe(expected)
        }
      }
    }
  })
})
