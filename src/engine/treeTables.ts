// Tree-shape tables for the tree-table method (fastPath.ts).
//
// A plan is a full binary tree. In an additive problem (see checkAdditive) its total splits into a penalty part A, which
// depends only on the shape, and sum(w_i * c_i), where w_i is the weight of the book on leaf i and its contribution c_i
// is the number of ancestors whose right subtree holds the leaf. The best assignment pairs the largest weights with the
// smallest contributions (rearrangement inequality), so shape S is never worse than S' for any weights when
// A(S) <= A(S') and P_j(S) <= P_j(S') for every j, where P_j is the sum of the j smallest contributions. Replacing a
// subtree by one with the same leaf count and height that is never worse preserves this order: the contributions of a
// right child all shift by one, and an equal height keeps the prior work penalty of every ancestor. So a dynamic
// program that keeps only the non-dominated subtrees per (leaf count k, height h) finds the optimal total.
//
// Shapes with the same (A, sorted contributions) form one class that keeps all its derivations (left class, right class).
// Choosing among plans with the optimal total (smallest max step, then XP, ...) needs every shape of a class, not just one
// representative, so shapesOf expands them for the classes that reach the optimum.
//
// The tables live as long as the module (the worker) and grow to the leaf count needed. The book-only subtree table
// depends neither on the mode nor on the target's anvil uses, so it is shared.
//
// The reference implementation (kkchengaf/Minecraft-Enchantment-Order-Calculator) has no license, so its precomputed
// tables are not copied; this module derives equivalent ones.

import { pwp } from './rules.ts'

/** 'item': the leftmost leaf is the target, starting at targetUses anvil uses. 'book-only': every leaf is a book with 0 anvil uses. */
export type TreeMode = 'item' | 'book-only'

export interface ShapeClass {
  readonly leaves: number
  /** A leaf's height is its anvil uses, so the result's prior work penalty is pwp(height). */
  readonly height: number
  /** A: sum over internal nodes of pwp(left height) + pwp(right height). */
  readonly penaltyCost: number
  /** Ascending. Includes the leftmost leaf's 0, so the first value is always 0. */
  readonly contributions: readonly number[]
  readonly shapeCount: number
  /** In the order they were found; empty for a leaf. */
  readonly derivations: readonly ShapeDerivation[]
}

/** Any shape of left joined with any shape of right gives a shape of the class. */
export interface ShapeDerivation {
  readonly left: ShapeClass
  readonly right: ShapeClass
}

/** Leaves are in in-order, left to right. */
export type TreeShape = { readonly t: 'leaf' } | { readonly t: 'node'; readonly left: TreeShape; readonly right: TreeShape }

/** The classes that can be optimal for one leaf count, mode and initial target anvil uses. */
export interface TreeTable {
  readonly mode: TreeMode
  readonly leaves: number
  readonly targetUses: number
  /** By root height, then in the order they entered the table; equal plans are decided by this order. */
  readonly classes: readonly ShapeClass[]
}

/** Stays fixed once its level is built, and is then handed out as a ShapeClass. */
interface BuildingClass extends ShapeClass {
  readonly contributions: number[]
  readonly prefix: Float64Array              // P_j for j = 1..leaves
  readonly derivations: ShapeDerivation[]
  shapeCount: number
}

/** Leaf count -> height -> classes (undefined for heights without a class). Index 0 is unused. */
type Table = Array<Array<BuildingClass[] | undefined>>

const LEAF_SHAPE: TreeShape = { t: 'leaf' }

function leafClass(height: number): BuildingClass {
  return { leaves: 1, height, penaltyCost: 0, contributions: [0], prefix: Float64Array.of(0), derivations: [], shapeCount: 1 }
}

const bookTable: Table = [[], [[leafClass(0)]]]
// Subtrees with the target as the leftmost leaf, per initial target anvil uses
const itemTables = new Map<number, Table>()
const tableCache = new Map<string, TreeTable>()

/** leaves includes the target in item mode. */
export function getTreeTable(leaves: number, targetUses: number, mode: TreeMode): TreeTable {
  if (!Number.isInteger(leaves) || leaves < 1) throw new RangeError(`leaves must be a positive integer: ${leaves}`)
  if (!Number.isInteger(targetUses) || targetUses < 0) throw new RangeError(`targetUses must be a non-negative integer: ${targetUses}`)
  if (mode === 'book-only' && targetUses !== 0) throw new RangeError('book-only tables have no target: targetUses must be 0')

  const key = `${mode}:${targetUses}:${leaves}`
  const cached = tableCache.get(key)
  if (cached !== undefined) return cached

  const table = mode === 'item' ? extendItemTable(targetUses, leaves) : extendBookTable(leaves)
  const classes: ShapeClass[] = []
  for (const bucket of table[leaves]) if (bucket !== undefined) classes.push(...bucket)
  const result: TreeTable = { mode, leaves, targetUses, classes }
  tableCache.set(key, result)
  return result
}

/** Drops every cached table, so that tests can check that tables built from scratch give the same results. */
export function clearTreeTableCache(): void {
  bookTable.length = 2
  itemTables.clear()
  tableCache.clear()
}

function extendBookTable(leaves: number): Table {
  for (let k = bookTable.length; k <= leaves; k++) bookTable.push(buildLevel(k, bookTable))
  return bookTable
}

function extendItemTable(targetUses: number, leaves: number): Table {
  extendBookTable(leaves - 1)
  let table = itemTables.get(targetUses)
  if (table === undefined) {
    const level: Array<BuildingClass[] | undefined> = []
    level[targetUses] = [leafClass(targetUses)]
    table = [[], level]
    itemTables.set(targetUses, table)
  }
  for (let k = table.length; k <= leaves; k++) table.push(buildLevel(k, table))
  return table
}

/**
 * Right subtrees always come from the book-only table, since the target is never on the right. The loop order fixes the
 * order of the derivations, which decides between equal plans.
 */
function buildLevel(k: number, leftTable: Table): Array<BuildingClass[] | undefined> {
  const level: Array<BuildingClass[] | undefined> = []
  for (let leftLeaves = 1; leftLeaves < k; leftLeaves++) {
    const lefts = leftTable[leftLeaves]
    const rights = bookTable[k - leftLeaves]
    for (let leftHeight = 0; leftHeight < lefts.length; leftHeight++) {
      const leftBucket = lefts[leftHeight]
      if (leftBucket === undefined) continue
      for (let rightHeight = 0; rightHeight < rights.length; rightHeight++) {
        const rightBucket = rights[rightHeight]
        if (rightBucket === undefined) continue
        const height = Math.max(leftHeight, rightHeight) + 1
        const bucket = (level[height] ??= [])
        for (const left of leftBucket) for (const right of rightBucket) insert(bucket, left, right)
      }
    }
  }
  for (const bucket of level) {
    if (bucket === undefined) continue
    for (const cls of bucket) {
      let count = 0
      for (const { left, right } of cls.derivations) count += left.shapeCount * right.shapeCount
      cls.shapeCount = count
    }
  }
  return level
}

/**
 * Inserts node(left, right) among the classes of its height. It joins a class with the same vector, is dropped when a kept
 * class dominates it, and otherwise removes the kept classes it dominates.
 */
function insert(bucket: BuildingClass[], left: BuildingClass, right: BuildingClass): void {
  const penaltyCost = left.penaltyCost + right.penaltyCost + pwp(left.height) + pwp(right.height)
  const contributions = mergeContributions(left.contributions, right.contributions)
  const prefix = prefixSums(contributions)

  for (const kept of bucket) {
    if (kept.penaltyCost === penaltyCost && samePrefix(kept.prefix, prefix)) {
      kept.derivations.push({ left, right })
      return
    }
  }
  for (const kept of bucket) if (dominates(kept.penaltyCost, kept.prefix, penaltyCost, prefix)) return

  // Kept classes never dominate each other, so only those the new class dominates go
  for (let i = bucket.length - 1; i >= 0; i--) {
    if (dominates(penaltyCost, prefix, bucket[i].penaltyCost, bucket[i].prefix)) bucket.splice(i, 1)
  }
  bucket.push({
    leaves: left.leaves + right.leaves,
    height: Math.max(left.height, right.height) + 1,
    penaltyCost,
    contributions,
    prefix,
    derivations: [{ left, right }],
    shapeCount: 0,
  })
}

/** Merges the left contributions with the right ones plus 1 (the right subtree's leaves are on the right at this node too). */
function mergeContributions(left: readonly number[], right: readonly number[]): number[] {
  const merged = new Array<number>(left.length + right.length)
  let i = 0
  let j = 0
  for (let k = 0; k < merged.length; k++) {
    if (j >= right.length || (i < left.length && left[i] <= right[j] + 1)) merged[k] = left[i++]
    else merged[k] = right[j++] + 1
  }
  return merged
}

function prefixSums(contributions: readonly number[]): Float64Array {
  const prefix = new Float64Array(contributions.length)
  let sum = 0
  contributions.forEach((c, j) => {
    sum += c
    prefix[j] = sum
  })
  return prefix
}

function samePrefix(a: Float64Array, b: Float64Array): boolean {
  for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return false
  return true
}

/** Never worse and better somewhere. Only classes with the same leaf count are compared. */
function dominates(penaltyA: number, prefixA: Float64Array, penaltyB: number, prefixB: Float64Array): boolean {
  if (penaltyA > penaltyB) return false
  let better = penaltyA < penaltyB
  for (let j = 0; j < prefixA.length; j++) {
    if (prefixA[j] > prefixB[j]) return false
    if (prefixA[j] < prefixB[j]) better = true
  }
  return better
}

/** Classes with at most this many shapes cache them in an array; larger ones are enumerated on every call to save memory. */
const MEMO_SHAPES_MAX = 512
// Weak, so that clearing the tables releases the cached shapes too
const shapeMemo = new WeakMap<ShapeClass, readonly TreeShape[]>()

/**
 * Shapes of a class in derivation order (per derivation, left shapes outer and right shapes inner); equal plans are decided
 * by this order. Small classes return a cached array; large ones are enumerated lazily, so the caller can stop early.
 */
export function shapesOf(cls: ShapeClass): Iterable<TreeShape> {
  const memo = shapeMemo.get(cls)
  if (memo !== undefined) return memo
  if (cls.shapeCount > MEMO_SHAPES_MAX) return enumerateShapes(cls)
  const shapes = [...enumerateShapes(cls)]
  shapeMemo.set(cls, shapes)
  return shapes
}

function* enumerateShapes(cls: ShapeClass): Generator<TreeShape, void, undefined> {
  if (cls.derivations.length === 0) {
    yield LEAF_SHAPE
    return
  }
  for (const { left, right } of cls.derivations) {
    for (const leftShape of shapesOf(left)) {
      for (const rightShape of shapesOf(right)) yield { t: 'node', left: leftShape, right: rightShape }
    }
  }
}
