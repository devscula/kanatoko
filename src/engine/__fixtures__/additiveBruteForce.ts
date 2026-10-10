// Checks the tree-table method without using treeTables.ts or fastPath.ts, straight from the definitions: a leaf's height
// is its anvil uses, and a step costs the PWP of both sides plus the weights in its right subtree.

import { xpAtLevel } from '../xp.ts'

/** A full binary tree: null is a leaf, [left, right] a combine step. */
export type Shape = null | readonly [Shape, Shape]

/** 'item': the leftmost leaf is the target (no weight, targetUses anvil uses). 'book-only': every leaf is a book. */
export type AdditiveMode = 'item' | 'book-only'

/** [total, max step, XP, final prior work penalty], compared lexicographically. */
export type Keys = readonly [number, number, number, number]

const pwp = (uses: number): number => 2 ** uses - 1

export function compareKeys(a: Keys, b: Keys): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

const shapeMemo: Shape[][] = [[], [null]]

export function allShapes(leaves: number): readonly Shape[] {
  for (let k = shapeMemo.length; k <= leaves; k++) {
    const shapes: Shape[] = []
    for (let left = 1; left < k; left++) {
      for (const l of shapeMemo[left]) for (const r of shapeMemo[k - left]) shapes.push([l, r])
    }
    shapeMemo.push(shapes)
  }
  return shapeMemo[leaves]
}

export interface CompiledShape {
  readonly leaves: number
  /** Per leaf in in-order: the number of ancestors whose right subtree holds it. */
  readonly contributions: readonly number[]
  /** In post-order: the PWP of both sides and the right subtree's leaves [from, to). */
  readonly steps: readonly { readonly penalty: number; readonly from: number; readonly to: number }[]
  /** A: the sum of both sides' PWP over all steps. */
  readonly penaltyCost: number
  readonly height: number
}

/** The leftmost leaf has height baseHeight and every other leaf height 0. */
export function compileShape(shape: Shape, baseHeight: number): CompiledShape {
  const contributions: number[] = []
  const steps: { penalty: number; from: number; to: number }[] = []
  const walk = (node: Shape, rightDepth: number): number => {
    if (node === null) {
      const height = contributions.length === 0 ? baseHeight : 0
      contributions.push(rightDepth)
      return height
    }
    const left = walk(node[0], rightDepth)
    const from = contributions.length
    const right = walk(node[1], rightDepth + 1)
    steps.push({ penalty: pwp(left) + pwp(right), from, to: contributions.length })
    return Math.max(left, right) + 1
  }
  const height = walk(shape, 0)
  return { leaves: contributions.length, contributions, steps, penaltyCost: steps.reduce((sum, s) => sum + s.penalty, 0), height }
}

/** leafWeights are in in-order. */
export function evaluateShape(shape: CompiledShape, leafWeights: readonly number[]): Keys {
  const prefix = [0]
  for (const weight of leafWeights) prefix.push(prefix[prefix.length - 1] + weight)
  let total = 0
  let maxStep = 0
  let xp = 0
  for (const step of shape.steps) {
    const cost = step.penalty + prefix[step.to] - prefix[step.from]
    total += cost
    maxStep = Math.max(maxStep, cost)
    xp += xpAtLevel(cost)
  }
  return [total, maxStep, xp, pwp(shape.height)]
}

export function* distinctPermutations(values: readonly number[]): Generator<number[]> {
  const a = [...values].sort((x, y) => x - y)
  for (;;) {
    yield [...a]
    let i = a.length - 2
    while (i >= 0 && a[i] >= a[i + 1]) i--
    if (i < 0) return
    let j = a.length - 1
    while (a[j] <= a[i]) j--
    ;[a[i], a[j]] = [a[j], a[i]]
    for (let l = i + 1, r = a.length - 1; l < r; l++, r--) [a[l], a[r]] = [a[r], a[l]]
  }
}

function leavesOf(weights: readonly number[], mode: AdditiveMode): number {
  return mode === 'item' ? weights.length + 1 : weights.length
}

/** Tries every shape with every distinct assignment: a few seconds at most for up to 8 leaves. */
export function bruteForceKeys(weights: readonly number[], mode: AdditiveMode, targetUses: number): Keys {
  let best: Keys | null = null
  for (const shape of allShapes(leavesOf(weights, mode))) {
    const compiled = compileShape(shape, mode === 'item' ? targetUses : 0)
    for (const permutation of distinctPermutations(weights)) {
      const keys = evaluateShape(compiled, mode === 'item' ? [0, ...permutation] : permutation)
      if (best === null || compareKeys(keys, best) < 0) best = keys
    }
  }
  if (best === null) throw new Error('no shape')
  return best
}

/** Distinct (A, sorted contributions) per leaf count and leftmost height. */
const vectorMemo = new Map<string, readonly { readonly penaltyCost: number; readonly sorted: readonly number[] }[]>()

function distinctVectors(leaves: number, baseHeight: number): readonly { readonly penaltyCost: number; readonly sorted: readonly number[] }[] {
  const key = `${leaves}:${baseHeight}`
  const cached = vectorMemo.get(key)
  if (cached !== undefined) return cached
  const seen = new Map<string, { penaltyCost: number; sorted: number[] }>()
  for (const shape of allShapes(leaves)) {
    const compiled = compileShape(shape, baseHeight)
    const sorted = [...compiled.contributions].sort((a, b) => a - b)
    const id = `${compiled.penaltyCost}|${sorted.join(',')}`
    if (!seen.has(id)) seen.set(id, { penaltyCost: compiled.penaltyCost, sorted })
  }
  const vectors = [...seen.values()]
  vectorMemo.set(key, vectors)
  return vectors
}

/**
 * Within each shape, pairing the heaviest books with the smallest contributions gives its minimum (rearrangement
 * inequality). In item mode the target's leaf (leftmost, contribution 0) is skipped.
 */
export function minTotalOverAllShapes(weights: readonly number[], mode: AdditiveMode, targetUses: number): number {
  const descending = [...weights].sort((a, b) => b - a)
  const skip = mode === 'item' ? 1 : 0
  let best = Infinity
  for (const { penaltyCost, sorted } of distinctVectors(leavesOf(weights, mode), mode === 'item' ? targetUses : 0)) {
    let total = penaltyCost
    for (let j = 0; j < descending.length; j++) total += descending[j] * sorted[j + skip]
    best = Math.min(best, total)
  }
  return best
}

interface DpEntry {
  readonly total: number
  readonly maxStep: number
  readonly xp: number
}

/** Keeps only the smallest total and, at that total, the Pareto front over (max step, XP), like the exact search. */
function insertEntry(entries: DpEntry[], entry: DpEntry): void {
  if (entries.length > 0) {
    if (entry.total > entries[0].total) return
    if (entry.total < entries[0].total) entries.length = 0
  }
  if (entries.some((e) => e.maxStep <= entry.maxStep && e.xp <= entry.xp)) return
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entry.maxStep <= entries[i].maxStep && entry.xp <= entries[i].xp) entries.splice(i, 1)
  }
  entries.push(entry)
}

type DpTable = Map<number, DpEntry[]>[]   // book subset (bit mask) -> height -> entries

/**
 * The same keys as bruteForceKeys without enumerating shapes, for up to about 12 books. Only a subset's total weight and
 * its height affect later costs, so entries can be compared per subset and height.
 */
export function additiveDpKeys(weights: readonly number[], mode: AdditiveMode, targetUses: number): Keys {
  const m = weights.length
  const size = 1 << m
  const weightOf = new Float64Array(size)
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask
    weightOf[mask] = weightOf[mask ^ low] + weights[31 - Math.clz32(low)]
  }
  const books: DpTable = Array.from({ length: size }, () => new Map())
  const withTarget: DpTable = Array.from({ length: size }, () => new Map())
  for (let i = 0; i < m; i++) books[1 << i].set(0, [{ total: 0, maxStep: 0, xp: 0 }])
  withTarget[0].set(targetUses, [{ total: 0, maxStep: 0, xp: 0 }])

  const combineInto = (target: Map<number, DpEntry[]>, lefts: Map<number, DpEntry[]>, rights: Map<number, DpEntry[]>, rightWeight: number): void => {
    for (const [hl, ls] of lefts) {
      for (const [hr, rs] of rights) {
        const cost = pwp(hl) + pwp(hr) + rightWeight
        const height = Math.max(hl, hr) + 1
        let entries = target.get(height)
        if (entries === undefined) target.set(height, (entries = []))
        for (const l of ls) {
          for (const r of rs) {
            insertEntry(entries, { total: l.total + r.total + cost, maxStep: Math.max(l.maxStep, r.maxStep, cost), xp: l.xp + r.xp + xpAtLevel(cost) })
          }
        }
      }
    }
  }

  // Every proper subset has a smaller number, so it is processed first
  for (let mask = 1; mask < size; mask++) {
    for (let left = (mask - 1) & mask; left > 0; left = (left - 1) & mask) {
      combineInto(books[mask], books[left], books[mask ^ left], weightOf[mask ^ left])
    }
    if (mode === 'item') {
      for (let left = (mask - 1) & mask; ; left = (left - 1) & mask) {
        combineInto(withTarget[mask], withTarget[left], books[mask ^ left], weightOf[mask ^ left])
        if (left === 0) break
      }
    }
  }

  const roots = mode === 'item' ? withTarget[size - 1] : books[size - 1]
  let best: Keys | null = null
  for (const [height, entries] of roots) {
    for (const e of entries) {
      const keys: Keys = [e.total, e.maxStep, e.xp, pwp(height)]
      if (best === null || compareKeys(keys, best) < 0) best = keys
    }
  }
  if (best === null) throw new Error('no plan')
  return best
}
