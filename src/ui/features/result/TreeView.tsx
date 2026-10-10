import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Plan } from '../../../engine/index.ts'
import { SpokenText } from '../../i18n/SpokenText.tsx'
import { useT } from '../../i18n/useT.ts'
import { Slot } from '../../icons/Slot.tsx'
import type { DisplayPlan, SlotView } from '../../plan/displayPlan.ts'
import { buildTree, connectorPath, layoutTree, type PlacedStep, type TreeLayout, type TreeMetrics } from './tree.ts'
import styles from './TreeView.module.css'

// A step box wider than leafWidth + gap would overlap its neighbor
const WIDE: TreeMetrics = { leafWidth: 100, gap: 8, nodeHeight: 48, rowHeight: 76, firstRow: 32 }
const COMPACT: TreeMetrics = { leafWidth: 40, gap: 4, nodeHeight: 44, rowHeight: 72, firstRow: 32 }
const NODE_WIDTH = { wide: 100, compact: 44 } as const

export interface TreeViewProps {
  readonly plan: DisplayPlan
  readonly enginePlan: Plan
  onJump(no: number): void
}

function useWidth(ref: RefObject<HTMLElement | null>, active: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!active || el === null) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resize?.observe(el)
    return () => resize?.disconnect()
  }, [ref, active])
  return width
}

interface MaterialFit {
  readonly room: number
  readonly lift: readonly number[]
}

// Material heights depend on the names, so they are measured after rendering. `room` is how far the materials reach
// above y = 0. `lift` raises each material to share a top with the tallest one used by the same step, which keeps the
// icons in line. `bottoms` is in the order of the layer's children.
function useMaterialFit(layerRef: RefObject<HTMLElement | null>, bottoms: readonly number[]): MaterialFit {
  const [fit, setFit] = useState<MaterialFit>({ room: 0, lift: [] })
  const key = bottoms.join(',')
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (layer === null) return
    const items = Array.from(layer.children) as HTMLElement[]
    const measure = () => {
      const heights = items.map((el) => el.offsetHeight)
      const tallest = new Map<number, number>()
      heights.forEach((h, i) => tallest.set(bottoms[i], Math.max(tallest.get(bottoms[i]) ?? 0, h)))
      const lift = heights.map((h, i) => (tallest.get(bottoms[i]) ?? h) - h)
      const room = Math.max(0, ...heights.map((h, i) => h + lift[i] - bottoms[i]))
      setFit((prev) => (prev.room === room && prev.lift.join() === lift.join() ? prev : { room, lift }))
    }
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    for (const el of items) resize?.observe(el)
    return () => resize?.disconnect()
    // key stands for bottoms, which is a new array on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerRef, key])
  return fit
}

function materialName(slot: SlotView): SlotView['label'] {
  return slot.item === 'enchanted_book' && slot.detail !== null ? slot.detail : slot.label
}

// Roman numeral levels stand upright in one cell of vertical text
function verticalName(name: string): ReactNode[] {
  return name.split(/(?<![A-Za-z])([IVX]+)(?![A-Za-z])/).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className={styles.upright}>
        {part}
      </span>
    ) : (
      part
    ),
  )
}

interface StepItemProps {
  readonly placed: PlacedStep
  readonly compact: boolean
  readonly metrics: TreeMetrics
  readonly root: boolean
  onJump(no: number): void
}

function StepItem({ placed, compact, metrics, root, onJump }: StepItemProps) {
  const { t, text, num } = useT()
  const { step } = placed.node
  return (
    <li>
      <div className={styles.node} style={{ left: placed.x, top: placed.y }}>
        <button
          type="button"
          className={styles.button}
          style={{ width: NODE_WIDTH[compact ? 'compact' : 'wide'], height: metrics.nodeHeight }}
          aria-label={t('tree.nodeSr', { n: step.no, c: step.cost.total })}
          onClick={() => onJump(step.no)}
          data-over={step.tooExpensive || undefined}
        >
          {compact ? (
            <>
              <span className={styles.stepNo}>{step.no}</span>
              <span className={styles.cost}>{num(step.cost.total)}</span>
            </>
          ) : (
            <>
              <span className={styles.figures}>
                <span className={styles.stepLabel}>{t('tree.node', { n: step.no })}</span>
                <span className={styles.cost}>{num(step.cost.total)}</span>
              </span>
              <Slot size={36} item={step.result.item} enchanted={step.result.enchanted} book={step.result.contents} letter={step.result.letter} />
            </>
          )}
        </button>
        {root && <span className={styles.rootLabel}>{text(step.result.label)}</span>}
      </div>
      <ul className={styles.list}>
        {placed.inputs.map((input, i) =>
          input.kind === 'leaf' ? (
            <li key={i} className="visually-hidden">
              <SpokenText value={input.node.slot.fullLabel} />
            </li>
          ) : (
            <StepItem key={i} placed={input} compact={compact} metrics={metrics} root={false} onJump={onJump} />
          ),
        )}
      </ul>
    </li>
  )
}

function connectors(layout: TreeLayout, nodeHeight: number): string[] {
  const paths: string[] = []
  const walk = (step: PlacedStep): void => {
    for (const input of step.inputs) {
      paths.push(connectorPath(input, step, nodeHeight))
      if (input.kind === 'step') walk(input)
    }
  }
  walk(layout.root)
  return paths
}

export function TreeView({ plan, enginePlan, onJump }: TreeViewProps) {
  const { t, text, lang } = useT()
  const treeRef = useRef<HTMLDivElement>(null)
  const materialsRef = useRef<HTMLDivElement>(null)
  const root = buildTree(plan, enginePlan)
  const available = useWidth(treeRef, root !== null)
  const wideLayout = root === null ? null : layoutTree(root, WIDE)
  const compact = wideLayout === null || available === null || wideLayout.width > available
  const metrics = compact ? COMPACT : WIDE
  const layout = root === null ? null : compact ? layoutTree(root, COMPACT) : wideLayout
  const { room, lift } = useMaterialFit(materialsRef, layout?.leaves.map((leaf) => leaf.bottom) ?? [])
  if (layout === null) return null

  return (
    <div ref={treeRef} className={styles.tree} data-layout={compact ? 'compact' : 'wide'}>
      <div className={styles.scroller}>
        <div className={styles.canvas} style={{ width: layout.width, height: room + layout.height }}>
          <div ref={materialsRef} className={styles.materials} aria-hidden="true">
            {layout.leaves.map(({ node: { slot }, x, bottom }, i) => {
              const name = text(materialName(slot))
              return (
                <div
                  key={i}
                  className={styles.material}
                  style={{ left: x - metrics.leafWidth / 2, bottom: layout.height - bottom + (lift[i] ?? 0), width: metrics.leafWidth }}
                >
                  <Slot size={36} item={slot.item} enchanted={slot.enchanted} book={slot.contents} letter={slot.letter} />
                  <span className={styles.materialName}>{compact && lang === 'ja' ? verticalName(name) : name}</span>
                </div>
              )
            })}
          </div>
          <div className={styles.steps} style={{ top: room, height: layout.height }}>
            <svg className={styles.lines} width={layout.width} height={layout.height} aria-hidden="true">
              {connectors(layout, metrics.nodeHeight).map((d, i) => (
                <path key={i} d={d} />
              ))}
            </svg>
            <ul className={styles.list} aria-label={t('tree.label')}>
              <StepItem placed={layout.root} compact={compact} metrics={metrics} root onJump={onJump} />
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
