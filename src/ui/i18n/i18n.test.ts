import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { describeFailureReason, describeValidationIssue, validationFixLabel } from './engineCodes.ts'
import { fillSlot, fillSlots, SLOT_MARK } from './fillSlots.tsx'
import { editionVersionName, gameModeName, objectiveName } from './settingNames.ts'
import { MESSAGE_AREAS, MESSAGES, type MessageKey } from './messages/index.ts'
import { createTranslator, interpolate, placeholderNames, renderText } from './render.ts'
import { editionText, enchText, itemText, listText, msg, romanText } from './text.ts'

const ja = createTranslator({ lang: 'ja', edition: 'java' })
const jaBedrock = createTranslator({ lang: 'ja', edition: 'bedrock' })
const en = createTranslator({ lang: 'en', edition: 'java' })

const placeholders = placeholderNames

describe('message catalog', () => {
  it('has the same keys in Japanese and English', () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.ja).sort())
  })

  it('never defines a key in two area files, so no file overrides another', () => {
    for (const lang of ['ja', 'en'] as const) {
      const seen = new Map<string, string>()
      for (const [area, messages] of Object.entries(MESSAGE_AREAS[lang])) {
        for (const key of Object.keys(messages)) {
          expect(seen.get(key), `${lang}: ${key} is in both ${seen.get(key)} and ${area}`).toBeUndefined()
          seen.set(key, area)
        }
      }
    }
  })

  it('uses the same parameters in both languages, apart from the listed exceptions', () => {
    // English messages without {item}: they are phrased around the item name so that it never needs inflecting
    const allowedOmissions = new Set([
      'owned.title:item',
      'composer.submitSpare:item',
      'toast.itemChangedSpares:item',
      'blocks.countExtras:item',
      'blocks.clearMaterials:item',
      'blocks.clearedMaterials:item',
    ])
    // Counts that only English takes, to pick singular or plural (Japanese does not inflect for number)
    const englishOnlyCounts = new Set(['summary.levelUnitFor:n', 'usage.used:k', 'tip.used:k'])
    for (const key of Object.keys(MESSAGES.ja) as MessageKey[]) {
      const jaNames = placeholders(MESSAGES.ja[key])
      const enNames = placeholders(MESSAGES.en[key])
      jaNames.delete('tooExpensive')
      enNames.delete('tooExpensive')
      for (const name of enNames) expect(jaNames.has(name) || englishOnlyCounts.has(`${key}:${name}`), `${key}: {${name}}`).toBe(true)
      for (const name of jaNames) {
        if (!enNames.has(name)) expect(allowedOmissions.has(`${key}:${name}`), `${key}: {${name}} is missing in English`).toBe(true)
      }
    }
  })

  it('has no empty message', () => {
    for (const lang of ['ja', 'en'] as const) {
      for (const [key, value] of Object.entries(MESSAGES[lang])) expect(value.trim(), `${lang}: ${key}`).not.toBe('')
    }
  })

  it('reports unknown keys and missing parameters as type errors', () => {
    // @ts-expect-error unknown key (returns the key itself at run time)
    expect(ja.t('no.such.key')).toBe('no.such.key')
    // @ts-expect-error missing parameter
    ja.t('summary.levels')
    // @ts-expect-error wrong parameter name
    msg('step.cost', { m: 1 })
    expect(ja.t('summary.levels', { n: 3 })).toBe('3レベル')
  })
})

describe('formatting rules', () => {
  it('adds a half-width space between a Roman numeral and following Japanese text', () => {
    expect(ja.t('unused.targetHas', { item: itemText('pickaxe'), name: enchText('unbreaking', 3) })).toBe(
      'ツルハシにもう耐久力\u00a0III がある',
    )
    expect(ja.t('sug.dropGoal', { name: enchText('fortune', 3) })).toBe('幸運\u00a0III を外す')
    expect(ja.t('sug.lowerLevel.button', { level: romanText(2) })).toBe('II にする')
  })

  it('adds no space before brackets or commas, or after numbers', () => {
    expect(ja.t('label.book', { list: listText([enchText('thorns', 3)]) })).toBe('本（棘の鎧\u00a0III）')
    expect(ja.t('label.book', { list: listText([enchText('fortune', 3), enchText('mending', 1)]) })).toBe('本（幸運\u00a0III、修繕）')
    expect(ja.t('usage.used', { list: '3', k: 1 })).toBe('手順3で使う')
    expect(ja.t('summary.levels', { n: 16 })).toBe('16レベル')
  })

  it('adds no second space where the message already has one', () => {
    expect(ja.t('wanted.ownedShort', { reach: romanText(2), level: romanText(3) })).toBe('手持ちでは II まで。III の本を用意します')
  })

  it('adds no space in English', () => {
    expect(interpolate('{a}が', { a: { text: 'III', numeralEnd: true } }, 'en').text).toBe('IIIが')
  })

  it('treats the letter of a book label as a letter, not a Roman numeral', () => {
    expect(ja.t('title.makeBook', { x: 'A' })).toBe('本Aを作る')
    expect(ja.t('title.makeBook', { x: 'I' })).toBe('本Iを作る')
    expect(ja.t('title.apply', { item: itemText('boots'), right: msg('label.madeBook', { x: 'V' }) })).toBe('ブーツに本Vを付ける')
  })

  it('adds the space in the outer message when a leveled name ends the inner one', () => {
    expect(ja.t('toast.deleted', { label: msg('label.book', { list: listText([enchText('fortune', 3)]) }) })).toBe('本（幸運\u00a0III）を削除しました')
    expect(ja.t('history.select', { name: enchText('protection', 4) })).toBe('ダメージ軽減\u00a0IV を選ぶ')
    expect(ja.t('history.select', { name: enchText('mending', 1) })).toBe('修繕を選ぶ')
  })

  it('groups the digits of numbers with four or more digits', () => {
    expect(ja.t('a11y.resultAnnounce', { t: 66, m: 16, k: 7 })).toBe('合計66レベル、1回の最大16レベル、7手順')
    expect(ja.num(1246)).toBe('1,246')
    expect(en.num(1246)).toBe('1,246')
  })

  it('quotes the game text of the current edition', () => {
    expect(ja.t('step.overCap')).toBe('40レベル以上なので、サバイバルでは「コストが高すぎます！」と表示されます')
    expect(jaBedrock.t('step.overCap')).toBe('40レベル以上なので、サバイバルでは「コストが高すぎます!」と表示されます')
    // English uses curly quotes because the body font draws an ASCII " as ” on both sides
    expect(en.t('step.overCap')).toBe('40+ levels: \u201cToo Expensive!\u201d in Survival')
  })

  it('joins "and" and "or" lists with the separators of each language', () => {
    const list = listText([enchText('loyalty'), enchText('channeling')], 'or')
    expect(ja.t('conflict.star', { center: enchText('riptide'), list })).toBe('競合: 激流は、忠誠・召雷と同時に付けられません')
    expect(en.t('conflict.star', { center: enchText('riptide'), list })).toBe("Incompatible: Riptide can't be combined with Loyalty or Channeling")
    expect(ja.t('toast.conflictReplaced', { list: listText([enchText('loyalty'), enchText('channeling')]) })).toBe('忠誠、召雷を外しました')
  })

  it('uses Bedrock Edition names in Bedrock Edition', () => {
    expect(jaBedrock.text(enchText('breach', 4))).toBe('違反\u00a0IV')
    expect(ja.text(enchText('breach', 4))).toBe('防具貫通\u00a0IV')
    expect(jaBedrock.text(enchText('swift_sneak'))).toBe('しのび足速度上昇')
  })

  it('spells out levels in spoken text ("level 4") and leaves enchantments with a max level of 1 as they are', () => {
    expect(ja.spoken(msg('label.book', { list: listText([enchText('thorns', 3), enchText('mending', 1)]) }))).toBe('本（棘の鎧 レベル3、修繕）')
    expect(en.spoken(enchText('protection', 4))).toBe('Protection level 4')
    // The visible text keeps the Roman numeral
    expect(ja.text(enchText('protection', 4))).toBe('ダメージ軽減\u00a0IV')
  })

  it('shows no level for an enchantment whose max level is 1', () => {
    expect(ja.text(enchText('mending', 1))).toBe('修繕')
  })

  it('joins an enchantment name and its level with a no-break space (U+00A0) so the level never wraps alone', () => {
    expect(ja.text(enchText('soul_speed', 3))).toBe('ソウルスピード\u00a0III')
    expect(en.text(enchText('thorns', 3))).toBe('Thorns\u00a0III')
    expect(en.t('label.book', { list: listText([enchText('thorns', 3)]) })).toBe('Book (Thorns\u00a0III)')
    // Spaces inside a name (English names) and between a numeral and following Japanese text are normal spaces that may wrap
    expect(en.text(enchText('feather_falling', 4))).toBe('Feather Falling\u00a0IV')
    expect(ja.t('history.select', { name: enchText('protection', 4) }).at(-4)).toBe(' ')
  })
})

describe('message examples', () => {
  it('renders summaries and notifications', () => {
    expect(ja.t('summary.maxLine', { max: 16, total: 66 })).toBe(
      '1回の手順にかかるのは多くても16レベルです。続けてすべて行うと、合計66レベルを使います。',
    )
    expect(ja.t('toast.editionRemoved', { list: listText([enchText('sweeping_edge')]), edition: editionText('bedrock') })).toBe(
      '統合版にない範囲ダメージ増加を外しました',
    )
    expect(ja.t('toast.maxAllPicked', { list: listText([enchText('protection'), enchText('depth_strider')]) })).toBe(
      '競合するものからはダメージ軽減、水中歩行を選びました',
    )
    expect(en.t('title.apply', { item: itemText('boots'), right: msg('label.madeBook', { x: 'A' }) })).toBe(
      'Apply Book A to the Boots',
    )
    expect(ja.t('match.bedrock', { c: 16 })).toBe('金床に表示されるコストが 16 なら、置き方は合っています。')
    expect(ja.t('uses.label', { n: 3, p: 7 })).toBe('金床使用回数 3回（累積作業費用 +7）')
  })

  it('renders nested Text', () => {
    const label = msg('label.withDetail', {
      label: msg('label.madeBook', { x: 'A' }),
      detail: listText([enchText('soul_speed', 3), enchText('mending', 1)]),
    })
    expect(renderText(label, { lang: 'ja', edition: 'java' })).toBe('本A（ソウルスピード\u00a0III、修繕）')
  })
})

describe('English plurals', () => {
  it('picks the ICU plural branch by count and replaces # with the formatted number', () => {
    const values = (n: number) => ({ n: { text: en.num(n), numeralEnd: false, count: n } })
    const template = '{n, plural, one {# step} other {# steps}} left'
    expect(interpolate(template, values(1), 'en').text).toBe('1 step left')
    expect(interpolate(template, values(0), 'en').text).toBe('0 steps left')
    expect(interpolate(template, values(1234), 'en').text).toBe('1,234 steps left')
    expect(interpolate('{n, plural, =0 {none} one {# book} other {# books}}', values(0), 'en').text).toBe('none')
    // A non-numeric value takes the other form
    expect(interpolate(template, { n: 'x' }, 'en').text).toBe('x steps left')
    // Only the count is a parameter, not the branch contents
    expect([...placeholderNames('{n, plural, one {level} other {levels}} and {x}')]).toEqual(['n', 'x'])
  })

  it('requires the plural count as a parameter, but not the branch contents', () => {
    expect(en.t('summary.levelUnitFor', { n: 1 })).toBe('level')
    expect(en.t('summary.levelUnitFor', { n: 2 })).toBe('levels')
    // @ts-expect-error missing count n
    en.t('summary.levelUnitFor')
  })

  const ROMAN_PARAMS = new Set(['level', 'low', 'max', 'required', 'reachable'])

  it('never renders "1 levels", "1 steps", "1 books" or "(s)" for counts of 0, 1 or 2', () => {
    const bad = /\b1 (levels|steps|books|results|copies|things)\b|\(s\)|\bsteps 1\b|\bstep 1[–-]/
    for (const key of Object.keys(MESSAGES.en) as MessageKey[]) {
      const names = placeholderNames(MESSAGES.en[key])
      if (names.size === 0) continue
      for (const n of [0, 1, 2]) {
        // Levels (Roman numerals) and lists take non-numeric values
        const valueOf = (name: string) => (ROMAN_PARAMS.has(name) ? romanText(3) : name === 'list' ? (n === 1 ? '3' : '3–6') : n)
        const params = Object.fromEntries([...names].map((name) => [name, valueOf(name)]))
        const text = en.t(key, params as never)
        expect(text, `${key} (n=${n})`).not.toMatch(bad)
      }
    }
    expect(en.t('step.cost', { n: 1 })).toBe('1 level')
    expect(en.t('blocks.countBooks', { n: 1 })).toBe('1 book')
    expect(en.t('usage.used', { list: '3–6', k: 4 })).toBe('Used in steps 3–6')
    expect(en.t('creative.banner', { n: 1 })).toBe('Calculated for Creative (no limit). 1 step costs 40+ levels.')
    expect(en.t('invalid.summary', { n: 1 })).toBe('1 thing in your input needs fixing.')
  })

  it('uses curly quotes instead of the ASCII " in English messages', () => {
    for (const [key, value] of Object.entries(MESSAGES.en)) expect(value.includes('"'), key).toBe(false)
  })
})

describe('engine code messages', () => {
  it('describes failure reasons', () => {
    const ctx = { edition: 'java' as const, itemType: 'mace' as const, inputLabel: (i: number) => `#${i}` }
    expect(
      ja.text(describeFailureReason({ code: 'goal-level-unreachable', enchantment: 'wind_burst', required: 3, reachable: 2 }, ctx)),
    ).toBe('ウィンドバーストは、手持ちの本では II までしか上げられず、III には届きません。')
    expect(
      ja.text(
        describeFailureReason(
          { code: 'too-expensive', uncappedTotal: 55, uncappedMaxStep: 47, stepsOverCap: [3], minAchievableMaxStep: 47 },
          ctx,
        ),
      ),
    ).toBe('どの順番で合成しても、どこかの手順で47レベル以上かかり、金床に「コストが高すぎます！」と表示されます。')
    expect(ja.text(describeFailureReason({ code: 'goal-enchantment-missing', enchantment: 'fortune' }, ctx))).toBe(
      '手持ちに幸運の本がありません。',
    )
    expect(ja.text(describeFailureReason({ code: 'cannot-use-all-inputs', unusable: [2, 3] }, ctx))).toContain('使えないもの: #2、#3。')
  })

  it('describes validation issues and their fix buttons', () => {
    const issue = { code: 'not-applicable-on-item-input', enchantment: 'efficiency', where: { part: 'target' } } as const
    expect(ja.text(describeValidationIssue(issue, { edition: 'java', itemType: 'boots' }))).toBe(
      '効率強化はブーツに付かないので、ブーツのエンチャントとしては入力できません。',
    )
    expect(ja.text(validationFixLabel(issue)!)).toBe('外す')
    const level = { code: 'level-out-of-range', enchantment: 'protection', level: 5, maxLevel: 4, where: { part: 'target' } } as const
    expect(ja.text(describeValidationIssue(level, { edition: 'java', itemType: 'boots' }))).toBe('ダメージ軽減のレベルは IV までです。')
    expect(ja.text(validationFixLabel(level)!)).toBe('IV にする')
  })
})

describe('fillSlots', () => {
  const html = (node: ReturnType<typeof fillSlots>) => renderToStaticMarkup(createElement('p', null, node))

  it('puts the elements at the marks in order, keeping the word order of the message', () => {
    expect(html(fillSlot(ja.t('step.no', { n: SLOT_MARK }), createElement('b', null, '3')))).toBe('<p>手順 <b>3</b></p>')
    expect(html(fillSlot(en.t('step.no', { n: SLOT_MARK }), createElement('b', null, '3')))).toBe('<p>Step <b>3</b></p>')
    const summary = ja.t('resultBar.summary', { t: SLOT_MARK, m: SLOT_MARK, k: SLOT_MARK })
    const nodes = ['66', '16', '7'].map((n) => createElement('b', { key: n }, n))
    expect(html(fillSlots(summary, nodes))).toBe('<p>合計 <b>66</b>  最大 <b>16</b>  <b>7</b>手順</p>')
  })

  it('returns the string unchanged when there is no mark', () => {
    expect(fillSlots('手順', [createElement('b', null, 'x')])).toBe('手順')
  })
})

describe('setting names', () => {
  it('names the game mode, the edition and version, and the objective', () => {
    expect(ja.text(gameModeName(39))).toBe('サバイバル')
    expect(ja.text(gameModeName(null))).toBe('クリエイティブ（上限なし）')
    expect(ja.text(editionVersionName('java'))).toBe('Java版 26.3')
    expect(ja.text(editionVersionName('bedrock'))).toBe('統合版 26.52')
    expect(ja.text(objectiveName('levels'))).toBe('合計レベル優先')
    expect(en.text(objectiveName('xp'))).toBe('Fewest XP points')
  })
})
