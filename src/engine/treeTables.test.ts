// kkchengafGolden.json holds optimal totals computed with the tables of kkchengaf/Minecraft-Enchantment-Order-Calculator.
// That repository has no license, so only the resulting totals are kept here, never its tables.
import fc from 'fast-check'
import { allShapes, compileShape, minTotalOverAllShapes, type Shape } from './__fixtures__/additiveBruteForce.ts'
import golden from './__fixtures__/kkchengafGolden.json'
import { clearTreeTableCache, getTreeTable, shapesOf, type ShapeClass, type TreeShape, type TreeTable } from './treeTables.ts'

const SEED = 20260927

/** Minimum total over the table: the heaviest weight takes the smallest contribution. Item mode skips the target's leaf. */
function tableMinTotal(table: TreeTable, weights: readonly number[]): number {
  const descending = [...weights].sort((a, b) => b - a)
  const skip = table.mode === 'item' ? 1 : 0
  let best = Infinity
  for (const cls of table.classes) {
    let total = cls.penaltyCost
    descending.forEach((w, j) => {
      total += w * cls.contributions[j + skip]
    })
    best = Math.min(best, total)
  }
  return best
}

/** Converts to the brute force's shape type, so that the values of a shape are computed independently. */
function toShape(shape: TreeShape): Shape {
  return shape.t === 'leaf' ? null : [toShape(shape.left), toShape(shape.right)]
}

function shapeKey(shape: TreeShape): string {
  return shape.t === 'leaf' ? 'x' : `(${shapeKey(shape.left)}${shapeKey(shape.right)})`
}

/** Weights with many ties, with few ties, and close to real books. */
function weightsArb(length: number): fc.Arbitrary<number[]> {
  const of = (value: fc.Arbitrary<number>) => fc.array(value, { minLength: length, maxLength: length })
  return fc.oneof(
    of(fc.integer({ min: 1, max: 40 })),
    of(fc.integer({ min: 1, max: 20 })),
    of(fc.integer({ min: 1, max: 4 })),
    of(fc.constantFrom(1, 2, 3, 4, 6, 8, 12)),
    fc.integer({ min: 1, max: 12 }).map((w) => new Array<number>(length).fill(w)),
    fc.tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 })).chain(([a, b]) => of(fc.constantFrom(a, b))),
  )
}

describe('getTreeTable: construction', () => {
  it('reproduces the known class counts (item mode, u = 0)', () => {
    expect(getTreeTable(8, 0, 'item').classes).toHaveLength(5)
    expect(getTreeTable(10, 0, 'item').classes).toHaveLength(7)
    expect(getTreeTable(12, 0, 'item').classes).toHaveLength(10)
    expect(getTreeTable(21, 0, 'item').classes).toHaveLength(27)
  })

  it('has the trivial tables for one and two leaves', () => {
    const one = getTreeTable(1, 3, 'item')
    expect(one.classes).toHaveLength(1)
    expect(one.classes[0]).toMatchObject({ leaves: 1, height: 3, penaltyCost: 0, contributions: [0], shapeCount: 1 })
    const two = getTreeTable(2, 3, 'item')
    expect(two.classes).toHaveLength(1)
    // Target (height 3) + book (height 0): A = pwp(3) + pwp(0) = 7, height 4
    expect(two.classes[0]).toMatchObject({ leaves: 2, height: 4, penaltyCost: 7, contributions: [0, 1], shapeCount: 1 })
    expect(getTreeTable(1, 0, 'book-only').classes[0]).toMatchObject({ height: 0, penaltyCost: 0, contributions: [0] })
  })

  it('lists classes by ascending height, and no class dominates another of the same height', () => {
    for (const [leaves, u, mode] of [[9, 0, 'item'], [12, 2, 'item'], [11, 0, 'book-only']] as const) {
      const table = getTreeTable(leaves, u, mode)
      const heights = table.classes.map((c) => c.height)
      expect(heights).toEqual([...heights].sort((a, b) => a - b))
      for (const a of table.classes) {
        expect(a.leaves).toBe(leaves)
        expect(a.contributions).toHaveLength(leaves)
        expect(a.contributions[0]).toBe(0)
        for (const b of table.classes) {
          if (a === b || a.height !== b.height) continue
          expect(dominatesOrEqual(a, b), `${leaves}/${u}/${mode}`).toBe(false)
        }
      }
    }
  })

  it('gives the same vectors in book-only mode as in item mode with u = 0 (a fresh target is like a book)', () => {
    for (let leaves = 1; leaves <= 14; leaves++) {
      const vectors = (t: TreeTable) => t.classes.map((c) => [c.height, c.penaltyCost, ...c.contributions].join(','))
      expect(vectors(getTreeTable(leaves, 0, 'book-only'))).toEqual(vectors(getTreeTable(leaves, 0, 'item')))
    }
  })

  it('validates its arguments', () => {
    expect(() => getTreeTable(0, 0, 'item')).toThrow(RangeError)
    expect(() => getTreeTable(2.5, 0, 'item')).toThrow(RangeError)
    expect(() => getTreeTable(3, -1, 'item')).toThrow(RangeError)
    expect(() => getTreeTable(3, 1, 'book-only')).toThrow(RangeError)
  })
})

/** a is no worse than b: A and every prefix sum of the ascending contributions are less than or equal. */
function dominatesOrEqual(a: ShapeClass, b: ShapeClass): boolean {
  if (a.penaltyCost > b.penaltyCost) return false
  let pa = 0
  let pb = 0
  for (let j = 0; j < a.contributions.length; j++) {
    pa += a.contributions[j]
    pb += b.contributions[j]
    if (pa > pb) return false
  }
  return true
}

describe('shapesOf: every shape of a class, not a single representative', () => {
  it('enumerates shapeCount distinct shapes whose vector, computed independently, is the class vector', () => {
    for (const [leaves, u, mode] of [[6, 0, 'item'], [8, 2, 'item'], [9, 0, 'book-only'], [13, 1, 'item']] as const) {
      for (const cls of getTreeTable(leaves, u, mode).classes) {
        const shapes = [...shapesOf(cls)]
        expect(shapes).toHaveLength(cls.shapeCount)
        expect(new Set(shapes.map(shapeKey)).size).toBe(cls.shapeCount)
        for (const shape of shapes) {
          const compiled = compileShape(toShape(shape), u)
          expect(compiled.height).toBe(cls.height)
          expect(compiled.penaltyCost).toBe(cls.penaltyCost)
          expect([...compiled.contributions].sort((a, b) => a - b)).toEqual(cls.contributions)
        }
      }
    }
  })

  it('contains every Catalan shape that has a class vector (the classes keep all their shapes)', () => {
    // Up to 11 leaves (at most 16 796 shapes), every shape with a class vector comes out of that class's derivations
    for (const [leaves, u, mode] of [[6, 0, 'item'], [8, 0, 'item'], [10, 2, 'item'], [11, 0, 'book-only']] as const) {
      const table = getTreeTable(leaves, u, mode)
      const byVector = new Map(table.classes.map((c) => [`${c.height}|${c.penaltyCost}|${c.contributions.join(',')}`, new Set([...shapesOf(c)].map(shapeKey))]))
      const key = (s: Shape): string => (s === null ? 'x' : `(${key(s[0])}${key(s[1])})`)
      for (const shape of allShapes(leaves)) {
        const compiled = compileShape(shape, u)
        const vector = `${compiled.height}|${compiled.penaltyCost}|${[...compiled.contributions].sort((a, b) => a - b).join(',')}`
        const shapes = byVector.get(vector)
        if (shapes !== undefined) expect(shapes.has(key(shape)), vector).toBe(true)
      }
    }
  })

  it('returns the same shapes in the same order on every call, and stops early when iterated lazily', () => {
    const big = getTreeTable(24, 0, 'item').classes.reduce((a, b) => (a.shapeCount >= b.shapeCount ? a : b))
    expect(big.shapeCount).toBeGreaterThan(1000)
    const firstThree = (): string[] => {
      const out: string[] = []
      for (const shape of shapesOf(big)) {
        out.push(shapeKey(shape))
        if (out.length === 3) break
      }
      return out
    }
    expect(firstThree()).toEqual(firstThree())
    const small = getTreeTable(10, 0, 'item').classes[3]
    expect([...shapesOf(small)].map(shapeKey)).toEqual([...shapesOf(small)].map(shapeKey))
  })
})

describe('minimum total: tables vs all Catalan shapes', () => {
  const vectors = 1000

  it.each([3, 4, 5, 6, 7, 8, 9, 10])('item mode, %i leaves, u = 0..4', (leaves) => {
    for (let u = 0; u <= 4; u++) {
      const table = getTreeTable(leaves, u, 'item')
      fc.assert(
        fc.property(weightsArb(leaves - 1), (weights) => tableMinTotal(table, weights) === minTotalOverAllShapes(weights, 'item', u)),
        { numRuns: vectors, seed: SEED + leaves * 10 + u },
      )
    }
  })

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])('book-only mode, %i leaves', (leaves) => {
    const table = getTreeTable(leaves, 0, 'book-only')
    fc.assert(
      fc.property(weightsArb(leaves), (weights) => tableMinTotal(table, weights) === minTotalOverAllShapes(weights, 'book-only', 0)),
      { numRuns: vectors, seed: SEED + leaves },
    )
  })
})

describe('golden values from the kkchengaf reference tables', () => {
  it.each<[number, number[], number]>([
    [3, [4, 3], 8], [3, [12, 1], 14], [4, [12, 6, 4], 26], [4, [5, 5, 5], 19],
    [5, [12, 12, 6, 4], 43], [5, [6, 6, 3, 2], 24], [6, [12, 12, 6, 4, 4], 52], [6, [8, 5, 5, 3, 2], 34],
    [7, [12, 12, 6, 4, 4, 3], 61], [7, [10, 6, 6, 4, 3, 2], 49], [8, [12, 12, 6, 4, 4, 3, 2], 66], [8, [6, 6, 5, 5, 4, 3, 2], 54],
    [9, [12, 12, 6, 4, 4, 4, 3, 2], 77], [9, [8, 8, 6, 6, 5, 4, 3, 2], 73],
    [10, [12, 12, 6, 4, 4, 4, 4, 3, 2], 88], [10, [12, 10, 8, 6, 6, 5, 4, 3, 2], 96],
  ])('%i leaves, weights %j -> %i', (leaves, weights, optimum) => {
    expect(tableMinTotal(getTreeTable(leaves, 0, 'item'), weights)).toBe(optimum)
  })

  it('equals the optimum of the reference tables for 250 weight vectors per leaf count 3-10', () => {
    const cases = golden.cases as [number, number[], number][]
    const perLeaves = new Map<number, number>()
    for (const [leaves, weights, optimum] of cases) {
      expect(tableMinTotal(getTreeTable(leaves, 0, 'item'), weights), `${leaves}: ${weights}`).toBe(optimum)
      perLeaves.set(leaves, (perLeaves.get(leaves) ?? 0) + 1)
    }
    expect([...perLeaves.keys()].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    for (const count of perLeaves.values()) expect(count).toBe(250)
  })
})

describe('memoization', () => {
  it('returns the same table object for the same arguments', () => {
    expect(getTreeTable(9, 1, 'item')).toBe(getTreeTable(9, 1, 'item'))
  })

  it('builds identical tables whether extended step by step, built in one go, or rebuilt after clearing', () => {
    const snapshot = (t: TreeTable) => t.classes.map((c) => ({
      height: c.height,
      penaltyCost: c.penaltyCost,
      contributions: c.contributions,
      shapeCount: c.shapeCount,
      shapes: [...shapesOf(c)].slice(0, 50).map(shapeKey),
    }))
    const stepwise = [5, 9, 14].map((leaves) => snapshot(getTreeTable(leaves, 2, 'item')))
    clearTreeTableCache()
    const direct = snapshot(getTreeTable(14, 2, 'item'))
    expect(direct).toEqual(stepwise[2])
    clearTreeTableCache()
    getTreeTable(16, 0, 'book-only')   // extending a book-only table first leaves the item tables unchanged
    expect([5, 9, 14].map((leaves) => snapshot(getTreeTable(leaves, 2, 'item')))).toEqual(stepwise)
  })
})
