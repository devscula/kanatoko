import fc from 'fast-check'
import { UI_ICON_KEYS, type IconKey } from './iconKeys.ts'
import { EMPTY, GRID, UI_INK, UI_PIXELS, type PixelRows } from './pixelData.ts'
import { iconLayers, rectsToPath, toLayers, toRects, type PixelRect } from './raster.ts'

const PATH_RECT = /M(\d+) (\d+)h(\d+)v(\d+)h-(\d+)z/g

/** Paints the rects back onto a grid, throwing on overlap. */
function paint(rects: readonly PixelRect[], size: number): string[] {
  const grid = Array.from({ length: size }, () => Array<string>(size).fill(EMPTY))
  for (const { char, x, y, w, h } of rects) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (grid[y + dy]![x + dx] !== EMPTY) throw new Error(`overlap at ${x + dx},${y + dy}`)
        grid[y + dy]![x + dx] = char
      }
    }
  }
  return grid.map((row) => row.join(''))
}

function parsePath(d: string, char: string): PixelRect[] {
  const rects = [...d.matchAll(PATH_RECT)].map((m) => {
    const [x, y, w, h, back] = m.slice(1).map(Number) as [number, number, number, number, number]
    expect(back).toBe(w)
    return { char, x, y, w, h }
  })
  expect(rects.map((r) => rectsToPath([r])).join('')).toBe(d)
  return rects
}

const gridArb = (size: number) =>
  fc.array(fc.array(fc.constantFrom(EMPTY, 'a', 'b', 'c'), { minLength: size, maxLength: size }), { minLength: size, maxLength: size })
    .map((rows) => rows.map((r) => r.join('')))

describe('toRects', () => {
  it('covers every drawn cell exactly once with its own char', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 16 }).chain(gridArb), (rows) => {
        expect(paint(toRects(rows), rows.length)).toEqual(rows)
      }),
    )
  })

  it('merges a horizontal run into one rect', () => {
    expect(toRects(['.aaa.'])).toEqual([{ char: 'a', x: 1, y: 0, w: 3, h: 1 }])
  })

  it('merges identical runs on consecutive rows into one rect', () => {
    expect(toRects(['aa.', 'aa.', 'aab'])).toEqual([
      { char: 'a', x: 0, y: 0, w: 2, h: 3 },
      { char: 'b', x: 2, y: 2, w: 1, h: 1 },
    ])
  })

  it('does not merge runs that differ in position, width or char', () => {
    expect(toRects(['aa', '.a', 'bb'])).toHaveLength(3)
  })

  it('never produces more rects than there are horizontal runs', () => {
    fc.assert(
      fc.property(gridArb(GRID), (rows) => {
        const runs = rows.reduce((n, row) => n + (row.match(/([^.])\1*/g)?.length ?? 0), 0)
        expect(toRects(rows).length).toBeLessThanOrEqual(runs)
      }),
    )
  })
})

describe('toLayers', () => {
  it('makes one path per char in order of first appearance', () => {
    const layers = toLayers(['ba', 'ab'], (c) => `fill-${c}`)
    expect(layers.map((l) => l.fill)).toEqual(['fill-b', 'fill-a'])
    expect(layers[0]!.d).toBe('M0 0h1v1h-1zM1 1h1v1h-1z')
  })
})

describe.each(UI_ICON_KEYS)('iconLayers(%s)', (key: IconKey) => {
  const rows: PixelRows = UI_PIXELS[key]

  it('reproduces the pixel data exactly', () => {
    const rects = iconLayers(key).flatMap((layer) => parsePath(layer.d, UI_INK))
    expect(paint(rects, GRID)).toEqual([...rows])
  })

  it('fills with currentColor', () => {
    expect(iconLayers(key).map(({ fill }) => fill)).toEqual(['currentColor'])
  })

  it('is computed once', () => {
    expect(iconLayers(key)).toBe(iconLayers(key))
  })
})
