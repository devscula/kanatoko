import { describe, expect, it } from 'vitest'
import type { SolveOk } from '../../../engine/index.ts'
import { getFixture, type FixtureName } from '../../dev/fixtures.ts'
import { createTranslator } from '../../i18n/render.ts'
import { displayPlanFromResult, type DisplayPlan } from '../../plan/displayPlan.ts'
import { formatPlanText } from './formatPlanText.ts'

const URL = 'https://example.test/kanatoko/#v=1&e=java&o=levels&cap=39&rn=0&d=z.abc'
const ja = createTranslator({ lang: 'ja', edition: 'java' })
const en = createTranslator({ lang: 'en', edition: 'java' })

function planOf(name: FixtureName): { plan: DisplayPlan; settings: SolveOkSettings } {
  const fixture = getFixture(name)
  const result = fixture.result as SolveOk
  return { plan: displayPlanFromResult(result, fixture.problem, fixture.settings), settings: fixture.settings }
}
type SolveOkSettings = ReturnType<typeof getFixture>['settings']

describe('formatPlanText', () => {
  it('matches the shared example character for character', () => {
    const { plan, settings } = planOf('bootsSevenBooks')
    expect(formatPlanText(plan, ja, { settings, url: URL })).toBe(
      [
        'ブーツ（Java版 26.3、サバイバル、合計レベル優先）',
        '合計66レベル、1回の最大16レベル、7手順',
        '用意する本: 本（棘の鎧 III）、本（ソウルスピード III）、本（修繕）、本（水中歩行 III）、本（ダメージ軽減 IV）、本（落下耐性 IV）、本（耐久力 III）',
        '手持ちから使うもの: ブーツ（新品）',
        // No section headings; each book merge comes right before the step that uses it
        '1. 左 ブーツ ＋ 右 本（棘の鎧 III）（12レベル）',
        '2. 左 本（ソウルスピード III） ＋ 右 本（修繕） → 本A（2レベル）',
        '3. 左 ブーツ ＋ 右 本A（16レベル）',
        '4. 左 本（水中歩行 III） ＋ 右 本（ダメージ軽減 IV） → 本B（4レベル）',
        '5. 左 ブーツ ＋ 右 本B（14レベル）',
        '6. 左 本（落下耐性 IV） ＋ 右 本（耐久力 III） → 本C（3レベル）',
        '7. 左 ブーツ ＋ 右 本C（15レベル）完成',
        `この手順を開く: ${URL}`,
      ].join('\n'),
    )
  })

  it('uses the same step numbers and costs as the display plan', () => {
    const { plan, settings } = planOf('bootsSevenBooks')
    const lines = formatPlanText(plan, ja, { settings, url: null }).split('\n')
    for (const step of plan.steps) {
      const line = lines.find((l) => l.startsWith(`${step.no}. `))
      expect(line).toContain(`${step.cost.total}レベル`)
    }
  })

  it('formats in English', () => {
    const { plan, settings } = planOf('bootsSevenBooks')
    const text = formatPlanText(plan, en, { settings, url: null }).split('\n')
    expect(text[0]).toBe('Boots (Java Edition 26.3, Survival, Fewest total levels)')
    expect(text[1]).toBe('66 levels total, max 16 per step, 7 steps')
    expect(text[2]).toMatch(/^Books to get: Book \(Thorns III\), Book \(Soul Speed III\), /)
    expect(text[3]).toBe('From what you have: Boots (new)')
    expect(text).toContain('2. Left Book (Soul Speed III) + right Book (Mending) → Book A (2 levels)')
    expect(text.at(-1)).toBe('7. Left Boots + right Book C (15 levels) done')
  })

  it('writes the rename-only step with the type-the-name note', () => {
    const { plan, settings } = planOf('bootsRename')
    const text = formatPlanText(plan, ja, { settings, url: null })
    expect(text).toMatch(/^\d+\. 左 ブーツ に名前を付ける（1レベル）名前を入力$/m)
  })

  it('lists unused owned items after the ones used', () => {
    const { plan, settings } = planOf('advancedUnused')
    const lines = formatPlanText(plan, ja, { settings, url: null }).split('\n')
    expect(lines[2]).toBe('手持ちから使うもの: ツルハシ（効率強化 IV、耐久力 III）、本（幸運 III）、本（修繕）、本（効率強化 IV）')
    expect(lines[3]).toBe('使わない手持ち: 本（シルクタッチ）、本（耐久力 II）')
    // The screen joins enchantment name and level with a no-break space; copied text uses a plain space
    expect(plan.ownedUnused.map((u) => ja.text(u.label))).toContain('本（耐久力\u00a0II）')
    expect(formatPlanText(plan, ja, { settings, url: null })).not.toContain('\u00a0')
    expect(lines[0]).toBe('ツルハシ（Java版 26.3、サバイバル、合計レベル優先）')
  })

  it('heads a books-only plan with the enchanted book and adds no section headings', () => {
    const { plan, settings } = planOf('bookOnly')
    const lines = formatPlanText(plan, ja, { settings, url: null }).split('\n')
    expect(lines[0]).toBe('エンチャントの本（Java版 26.3、サバイバル、合計レベル優先）')
    expect(lines).not.toContain('1冊にまとめる')
    expect(lines.some((line) => line.startsWith('1. '))).toBe(true)
  })

  it('notes 40+ levels on steps of 40 or more in Creative', () => {
    const { plan, settings } = planOf('creative40')
    const text = formatPlanText(plan, ja, { settings, url: null })
    expect(text.split('\n')[0]).toContain('クリエイティブ（上限なし）')
    const over = plan.steps.filter((s) => s.tooExpensive)
    expect(over.length).toBeGreaterThan(0)
    for (const step of over) expect(text).toMatch(new RegExp(`^${step.no}\\. .*（${step.cost.total}レベル）40レベル以上`, 'm'))
  })

  it('uses no box-drawing characters or emoji', () => {
    const { plan, settings } = planOf('bootsSevenBooks')
    expect(formatPlanText(plan, ja, { settings, url: URL })).not.toMatch(/[─━│┃■□\p{Extended_Pictographic}]/u)
  })
})
