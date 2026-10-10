import { UI_ICON_KEYS } from './iconKeys.ts'
import { EMPTY, GRID, UI_INK, UI_PIXELS } from './pixelData.ts'

const cells = (rows: readonly string[]): string[] => rows.flatMap((row) => [...row])

describe('keys', () => {
  it('has 49 distinct UI icons', () => {
    expect(UI_ICON_KEYS).toHaveLength(49)
    expect(new Set(UI_ICON_KEYS).size).toBe(49)
  })

  it('has pixel data for exactly the declared keys', () => {
    expect(Object.keys(UI_PIXELS).sort()).toEqual([...UI_ICON_KEYS].sort())
  })
})

describe.each(UI_ICON_KEYS)('%s: grid', (key) => {
  const rows = UI_PIXELS[key]

  it('is 16x16', () => {
    expect(rows).toHaveLength(GRID)
    for (const row of rows) expect(row).toHaveLength(GRID)
  })

  it('keeps the outer ring of cells empty', () => {
    expect(rows[0]).toBe(EMPTY.repeat(GRID))
    expect(rows[GRID - 1]).toBe(EMPTY.repeat(GRID))
    for (const row of rows) {
      expect(row[0]).toBe(EMPTY)
      expect(row[GRID - 1]).toBe(EMPTY)
    }
  })

  it('draws something', () => {
    expect(cells(rows).some((c) => c !== EMPTY)).toBe(true)
  })
})

describe.each(UI_ICON_KEYS)('%s: UI icon', (key) => {
  it('uses one color (currentColor) and no outline', () => {
    for (const c of new Set(cells(UI_PIXELS[key]))) expect([EMPTY, UI_INK]).toContain(c)
  })
})
