import type { ObjRef, Plan } from '../../../engine/index.ts'
import type { DisplayPlan, DisplayStep, SlotView } from '../../plan/displayPlan.ts'

export type LeafNode = { readonly kind: 'leaf'; readonly slot: SlotView }
export type StepNode = { readonly kind: 'step'; readonly step: DisplayStep; readonly left: TreeNode; readonly right: TreeNode | null }
export type TreeNode = LeafNode | StepNode

/** Null when the plan has no steps */
export function buildTree(plan: DisplayPlan, enginePlan: Plan): StepNode | null {
  const byEngineIndex = new Map(plan.steps.map((step) => [step.engineIndex, step]))
  const nodeOf = (index: number): StepNode | null => {
    const engineStep = enginePlan.steps[index - 1]
    const step = byEngineIndex.get(index)
    if (engineStep === undefined || step === undefined) return null
    const child = (ref: ObjRef, slot: SlotView): TreeNode | null => (ref.kind === 'input' ? { kind: 'leaf', slot } : nodeOf(ref.step))
    const left = child(engineStep.left, step.left)
    if (left === null) return null
    const right = engineStep.right === null || step.right === null ? null : child(engineStep.right, step.right)
    return { kind: 'step', step, left, right }
  }
  return enginePlan.finalRef.kind === 'step' ? nodeOf(enginePlan.finalRef.step) : null
}

/** Sizes in px. y = 0 is the bottom of the materials used by the first step. */
export interface TreeMetrics {
  /** A step box must be no wider than leafWidth + gap */
  readonly leafWidth: number
  readonly gap: number
  readonly nodeHeight: number
  readonly rowHeight: number
  /** From the bottom of a material to the top of the step that uses it */
  readonly firstRow: number
}

export interface PlacedLeaf {
  readonly kind: 'leaf'
  readonly node: LeafNode
  /** Center of the column */
  readonly x: number
  readonly bottom: number
}

export interface PlacedStep {
  readonly kind: 'step'
  readonly node: StepNode
  /** Center of the step box */
  readonly x: number
  /** Top of the step box */
  readonly y: number
  /** Left-slot input first; one entry for a rename-only step */
  readonly inputs: readonly Placed[]
}

export type Placed = PlacedLeaf | PlacedStep

export interface TreeLayout {
  readonly root: PlacedStep
  readonly leaves: readonly PlacedLeaf[]
  readonly width: number
  /** From y = 0 to the bottom of the last step box; the materials extend above y = 0 */
  readonly height: number
}

// Each material gets its own column, in the tree's left-to-right order, and each step its own row, in step order, so
// the tree reads top to bottom like the step list. A step sits under the midpoint of its inputs, which puts its left-slot
// input to the upper left. Inputs always come from earlier steps, so they are always above, and since subtrees never
// share columns, no line crosses a node, a material or another line.
export function layoutTree(root: StepNode, metrics: TreeMetrics): TreeLayout {
  const { leafWidth, gap, nodeHeight, rowHeight, firstRow } = metrics
  const stepNumbers: number[] = []
  const collect = (node: TreeNode): void => {
    if (node.kind === 'leaf') return
    stepNumbers.push(node.step.no)
    collect(node.left)
    if (node.right !== null) collect(node.right)
  }
  collect(root)
  const rowOf = new Map([...stepNumbers].sort((a, b) => a - b).map((no, row) => [no, row]))

  let columns = 0
  const leaves: PlacedLeaf[] = []
  const place = (node: StepNode): PlacedStep => {
    const y = firstRow + (rowOf.get(node.step.no) ?? 0) * rowHeight
    const placeInput = (input: TreeNode): Placed => {
      if (input.kind === 'step') return place(input)
      const leaf: PlacedLeaf = { kind: 'leaf', node: input, x: columns * (leafWidth + gap) + leafWidth / 2, bottom: y - firstRow }
      columns += 1
      leaves.push(leaf)
      return leaf
    }
    const inputs = node.right === null ? [placeInput(node.left)] : [placeInput(node.left), placeInput(node.right)]
    const x = inputs.reduce((sum, input) => sum + input.x, 0) / inputs.length
    return { kind: 'step', node, x, y, inputs }
  }
  const placedRoot = place(root)
  return {
    root: placedRoot,
    leaves,
    width: columns * (leafWidth + gap) - gap,
    height: placedRoot.y + nodeHeight,
  }
}

export const CONNECTOR = { barAbove: 18, radius: 8 } as const

// Down from the input, across on the crossbar shared with the other input, then down into the top of the step box
export function connectorPath(input: Placed, step: PlacedStep, nodeHeight: number): string {
  const start = input.kind === 'leaf' ? input.bottom : input.y + nodeHeight
  const dx = step.x - input.x
  if (Math.abs(dx) < 0.5) return `M${input.x} ${start}V${step.y}`
  const bar = step.y - CONNECTOR.barAbove
  const r = Math.max(0, Math.min(CONNECTOR.radius, Math.abs(dx) / 2, bar - start))
  const s = Math.sign(dx)
  return (
    `M${input.x} ${start}V${bar - r}` +
    `Q${input.x} ${bar} ${input.x + s * r} ${bar}` +
    `H${step.x - s * r}` +
    `Q${step.x} ${bar} ${step.x} ${bar + r}` +
    `V${step.y}`
  )
}
