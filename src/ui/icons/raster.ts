// One path per color, with a subpath per rect, keeps the element count low and leaves no seams between rects.
import type { IconKey } from './iconKeys.ts'
import { EMPTY, UI_PIXELS, type PixelRows } from './pixelData.ts'

/** In grid units. */
export interface PixelRect {
  readonly char: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface IconLayer {
  readonly fill: string
  readonly d: string
}

interface OpenRect {
  readonly char: string
  readonly x: number
  readonly y: number
  readonly w: number
  h: number
}

/** The rects never overlap and cover every non-empty cell exactly once. */
export function toRects(rows: PixelRows): PixelRect[] {
  const rects: OpenRect[] = []
  // Rects that reach the previous row; a run with the same x, width and character extends one down
  let previous = new Map<string, OpenRect>()
  rows.forEach((row, y) => {
    const current = new Map<string, OpenRect>()
    let x = 0
    while (x < row.length) {
      const char = row[x]
      let end = x + 1
      while (end < row.length && row[end] === char) end++
      if (char !== EMPTY) {
        const w = end - x
        const key = `${x}:${w}:${char}`
        const above = previous.get(key)
        if (above !== undefined) {
          above.h++
          current.set(key, above)
        } else {
          const rect: OpenRect = { char, x, y, w, h: 1 }
          rects.push(rect)
          current.set(key, rect)
        }
      }
      x = end
    }
    previous = current
  })
  return rects
}

/** Integer coordinates only, so crispEdges fills adjacent rects without seams. */
export function rectsToPath(rects: readonly PixelRect[]): string {
  return rects.map(({ x, y, w, h }) => `M${x} ${y}h${w}v${h}h-${w}z`).join('')
}

/** One layer per character, in order of first appearance. */
export function toLayers(rows: PixelRows, fillOf: (char: string) => string): IconLayer[] {
  const byChar = new Map<string, PixelRect[]>()
  for (const rect of toRects(rows)) {
    const list = byChar.get(rect.char)
    if (list === undefined) byChar.set(rect.char, [rect])
    else list.push(rect)
  }
  return [...byChar].map(([char, rects]) => ({ fill: fillOf(char), d: rectsToPath(rects) }))
}

const uiFill = (): string => 'currentColor'

const cache = new Map<IconKey, readonly IconLayer[]>()

export function iconLayers(key: IconKey): readonly IconLayer[] {
  let layers = cache.get(key)
  if (layers === undefined) {
    layers = toLayers(UI_PIXELS[key], uiFill)
    cache.set(key, layers)
  }
  return layers
}
