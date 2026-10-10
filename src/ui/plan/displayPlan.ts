import { areCompatible, getEnchantment } from '../../data/gameData.ts'
import { compareTooltipOrder } from '../../data/tooltipOrder.ts'
import type {
  Baseline,
  EnchantLevels,
  EngineInput,
  ObjectState,
  ObjRef,
  Plan,
  PlanStep,
  PlanSummary,
  Problem,
  ReferencePlan,
  Settings,
  SolveOk,
  StepCost,
  Warning,
  WarningCode,
} from '../../engine/index.ts'
import type { EnchantmentId, ItemTypeId } from '../../data/types.ts'
import { enchText, itemText, listText, msg, type LabelText, type Text } from '../i18n/text.ts'
import { enchantEntries } from '../state/convert.ts'
import { planIdOf } from '../state/buildProblem.ts'
import type { BuiltProblemView, InputSource, InputView } from './builtProblem.ts'
import { listProblemInputs } from './inputs.ts'

export type { InputSource } from './builtProblem.ts'

/** 'materials' steps make the merged books; 'target' steps apply them to the item, or merge into one book when there is no item. */
export type StepSection = 'materials' | 'target'

export interface SlotView {
  /** "Book A", "Boots (after step 4)", "Book (Thorns III)" */
  readonly label: LabelText
  /** "Soul Speed III, Mending"; null when there are no enchantments */
  readonly detail: LabelText | null
  /** Made books add their contents, as in "Book A (Soul Speed III, Mending)". Same as label for inputs. */
  readonly fullLabel: LabelText
  /** 'enchanted_book' for books */
  readonly item: ItemTypeId
  readonly contents: EnchantLevels
  /** null for objects made in a step */
  readonly source: InputSource | null
  readonly anvilUses: number
  readonly letter: string | null
  readonly enchanted: boolean
}

export interface DisplayStep {
  readonly no: number
  /** PlanStep.index. Display code uses no. */
  readonly engineIndex: number
  readonly section: StepSection
  readonly kind: 'combine' | 'rename'
  readonly title: LabelText
  readonly left: SlotView
  /** null for a rename-only step */
  readonly right: SlotView | null
  readonly result: SlotView
  readonly cost: StepCost
  readonly xpPoints: number
  readonly renameHere: boolean
  /** 40 levels or more, which only happens in Creative or in a reference plan */
  readonly tooExpensive: boolean
  readonly warnings: readonly WarningCode[]
  readonly rightIsItem: boolean
}

export type UnusedReason =
  | { readonly code: 'curse'; readonly curse: EnchantmentId }
  | { readonly code: 'conflicts-wanted'; readonly name: EnchantmentId; readonly wanted: EnchantmentId }
  | { readonly code: 'no-wanted' }
  | { readonly code: 'target-has'; readonly name: EnchantmentId; readonly level: number }
  | { readonly code: 'below-wanted'; readonly names: readonly EnchantmentId[] }
  | { readonly code: 'fallback'; readonly names: readonly EnchantmentId[] }
  | { readonly code: 'covered-by-others'; readonly name: EnchantmentId }
  | { readonly code: 'raises-total' }

export interface GetBookView {
  readonly id: EnchantmentId
  readonly level: number
}

/** The item, an owned book or an extra item that the plan uses. One entry per book copy. */
export interface OwnedUsedView {
  readonly source: InputSource
  readonly label: LabelText
  /** For the item, every step on the target chain */
  readonly steps: readonly number[]
}

/** Owned books are grouped per input row. */
export interface OwnedUnusedView {
  readonly source: InputSource
  /** Unused copies */
  readonly count: number
  readonly label: LabelText
  readonly reason: UnusedReason
}

export interface DisplayPlan {
  readonly planId: string
  /** In display order */
  readonly steps: readonly DisplayStep[]
  /** In the order the plan's inputs appear from left to right */
  readonly getBooks: readonly GetBookView[]
  /** In the same order as getBooks */
  readonly ownedUsed: readonly OwnedUsedView[]
  /** Includes BuiltProblem.excluded */
  readonly ownedUnused: readonly OwnedUnusedView[]
  /** Books the fallback solve added because the owned books alone could not make the goal */
  readonly fallbackUsed: readonly EnchantmentId[]
  readonly summary: PlanSummary
  readonly baseline: Baseline | null
  readonly extraEnchantments: readonly EnchantmentId[]
  /** null when only merging books */
  readonly targetItem: ItemTypeId | null
}

export interface DisplayPlanSource {
  readonly problem: Problem
  readonly settings: Settings
  readonly plan: Plan
  readonly summary: PlanSummary
  readonly baseline: Baseline | null
  readonly warnings: readonly Warning[]
  /** Without it, input sources come from the engine input origins */
  readonly built?: BuiltProblemView | null
  /** Without it, labels and unused reasons rely only on the problem */
  readonly input?: InputView | null
}

/** A to Z, then AA, AB, ... */
export function letterFor(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

function levelsOf(state: ObjectState): EnchantLevels {
  const out: EnchantLevels = {}
  for (const { id, level } of state.enchantments) out[id] = level
  return out
}

function contentsText(levels: EnchantLevels): Text | null {
  const entries = enchantEntries(levels)
  return entries.length === 0 ? null : listText(entries.map((e) => enchText(e.id, e.level)))
}

const isCurse = (id: EnchantmentId): boolean => getEnchantment(id).curse

function iconOf(state: { readonly kind: 'item' | 'book'; readonly itemType: ItemTypeId | null }): ItemTypeId {
  return state.kind === 'book' || state.itemType === null ? 'enchanted_book' : state.itemType
}

/** For plans built without a BuiltProblem, such as reference plans */
export function sourceOfOrigin(input: EngineInput): InputSource {
  const o = input.origin
  switch (o.source) {
    case 'simple-item':
    case 'target':
      return { kind: 'target' }
    case 'extra-item':
      return { kind: 'extra', index: o.index }
    case 'book':
      return { kind: 'owned', index: o.index, copy: o.copy }
    case 'simple-book':
      return { kind: 'supplement', enchantment: o.enchantment, level: o.level }
  }
}

export function unusedReasonText(reason: UnusedReason, targetItem: ItemTypeId | null): LabelText {
  switch (reason.code) {
    case 'curse':
      return msg('unused.curse', { curse: enchText(reason.curse) })
    case 'conflicts-wanted':
      return msg('unused.conflictsWanted', { name: enchText(reason.name), wanted: enchText(reason.wanted) })
    case 'no-wanted':
      return msg('unused.noWanted')
    case 'target-has':
      return msg('unused.targetHas', { item: itemText(targetItem ?? 'enchanted_book'), name: enchText(reason.name, reason.level) })
    case 'below-wanted':
      return msg('unused.belowWanted', { list: listText(reason.names.map((id) => enchText(id))) })
    case 'fallback':
      return msg('unused.fallback', { list: listText(reason.names.map((id) => enchText(id))) })
    case 'covered-by-others':
      return msg('unused.coveredByOthers', { name: enchText(reason.name) })
    case 'raises-total':
      return msg('unused.raisesTotal')
  }
}

export function targetLabelOf(item: ItemTypeId, existing: EnchantLevels, anvilUses: number): LabelText {
  const entries = enchantEntries(existing)
  if (entries.length > 0) return msg('label.itemWith', { item: itemText(item), list: listText(entries.map((e) => enchText(e.id, e.level))) })
  return msg(anvilUses === 0 ? 'label.itemNew' : 'label.item', { item: itemText(item) })
}

export function isBookOnlyProblem(problem: Problem): boolean {
  return problem.mode === 'simple' ? problem.item === 'enchanted_book' : problem.target === null
}

/** null when only merging books */
export function targetItemOf(problem: Problem): ItemTypeId | null {
  if (problem.mode === 'simple') return problem.item === 'enchanted_book' ? null : problem.item
  return problem.target?.itemType ?? null
}

export interface InputLabelView {
  readonly label: LabelText
  /** null when there are no enchantments */
  readonly detail: LabelText | null
  /** Same as label; kept to match SlotView */
  readonly fullLabel: LabelText
}

/** targetItem names the extra items, which are of the same type */
export function inputLabelOf(input: EngineInput, targetItem: ItemTypeId | null): InputLabelView {
  const detail = contentsText(input.enchantments)
  switch (input.origin.source) {
    case 'simple-item': {
      const label = msg('label.itemNew', { item: itemText(input.origin.itemType) })
      return { label, detail: null, fullLabel: label }
    }
    case 'target': {
      const label = msg('label.item', { item: itemText(input.itemType ?? 'enchanted_book') })
      return { label, detail, fullLabel: label }
    }
    case 'extra-item': {
      const label = msg('label.extra', { item: itemText(targetItem ?? 'enchanted_book'), n: input.origin.index + 1 })
      return { label, detail, fullLabel: label }
    }
    case 'simple-book':
    case 'book': {
      const label = msg('label.book', { list: detail ?? '' })
      return { label, detail, fullLabel: label }
    }
  }
}

/** For text about inputs outside the plan, such as infeasibility reasons and suggestions */
export function problemInputLabel(problem: Problem, index: number): LabelText {
  const input = listProblemInputs(problem)[index]
  if (input === undefined) throw new RangeError(`input index ${index} is out of range for the problem`)
  return inputLabelOf(input, targetItemOf(problem)).fullLabel
}

export function renameStepOf(plan: DisplayPlan): number | null {
  return plan.steps.find((step) => step.renameHere)?.no ?? null
}

export function goalOf(problem: Problem): EnchantLevels | null {
  if (problem.mode === 'simple') return Object.fromEntries(problem.enchantments.map((e) => [e.id, e.level]))
  return problem.goal
}

/**
 * Numbers the steps once so the result panel, the tree, copied text and print agree. The target chain (the steps
 * reached by following left inputs back from the final result, rename-only steps included) keeps the engine's order.
 * Before each chain step come the steps that make its right input, in post-order with the left side first, so a
 * merged book is made right before the step that uses it.
 */
export function buildDisplayPlan(source: DisplayPlanSource): DisplayPlan {
  const { problem, settings, plan } = source
  const inputs = listProblemInputs(problem)
  const built = source.built ?? null
  if (built !== null && built.inputSources.length !== inputs.length) {
    throw new Error(`inputSources has ${built.inputSources.length} entries but the problem has ${inputs.length} inputs`)
  }
  const sources: readonly InputSource[] = built?.inputSources ?? inputs.map(sourceOfOrigin)
  const targetItem = targetItemOf(problem)
  const stepAt = (index: number): PlanStep => {
    const step = plan.steps[index - 1]
    if (step === undefined || step.index !== index) throw new Error(`plan.steps[${index - 1}] does not have index ${index}`)
    return step
  }

  // Target chain
  const chain: number[] = []
  let cursor: ObjRef = plan.finalRef
  while (cursor.kind === 'step') {
    chain.unshift(cursor.step)
    cursor = stepAt(cursor.step).left
  }
  const baseInput = cursor.input
  const chainSet = new Set(chain)

  // Display order
  const materials: number[] = []
  const order: number[] = []
  const postOrder = (index: number) => {
    const step = stepAt(index)
    for (const ref of [step.left, step.right]) if (ref?.kind === 'step') postOrder(ref.step)
    materials.push(index)
    order.push(index)
  }
  for (const index of chain) {
    const right = stepAt(index).right
    if (right?.kind === 'step') postOrder(right.step)
    order.push(index)
  }
  const noOf = new Map(order.map((index, i) => [index, i + 1]))
  const letterOf = new Map(materials.map((index, i) => [index, letterFor(i)]))

  const inputLabel = (index: number): InputLabelView => inputLabelOf(inputs[index], targetItem)

  const baseName = (): Text => (targetItem === null ? msg('label.bookBase') : msg('label.item', { item: itemText(targetItem) }))

  const slotOfInput = (index: number, state: ObjectState): SlotView => {
    const { label, detail, fullLabel } = inputLabel(index)
    return {
      label,
      detail,
      fullLabel,
      item: iconOf(state),
      contents: levelsOf(state),
      source: sources[index],
      anvilUses: state.anvilUses,
      letter: null,
      enchanted: state.enchantments.length > 0,
    }
  }

  const slotOfProduct = (index: number, state: ObjectState): SlotView => {
    const enchanted = state.enchantments.length > 0
    const icon = iconOf(state)
    const letter = letterOf.get(index) ?? null
    if (letter !== null) {
      const detail = contentsText(levelsOf(state))
      const label =
        state.kind === 'book'
          ? msg('label.madeBook', { x: letter })
          : msg('label.madeItem', { item: itemText(state.itemType ?? 'enchanted_book'), x: letter })
      const fullLabel = detail === null ? label : msg('label.withDetail', { label, detail })
      return { label, detail, fullLabel, item: icon, contents: levelsOf(state), source: null, anvilUses: state.anvilUses, letter, enchanted }
    }
    // An intermediate state on the target chain
    const n = noOf.get(index) ?? index
    const label = targetItem === null ? msg('label.bookBaseAfter', { n }) : msg('label.itemAfter', { item: itemText(targetItem), n })
    return { label, detail: contentsText(levelsOf(state)), fullLabel: label, item: icon, contents: levelsOf(state), source: null, anvilUses: state.anvilUses, letter: null, enchanted }
  }

  const slotOfRef = (ref: ObjRef, state: ObjectState): SlotView =>
    ref.kind === 'input' ? slotOfInput(ref.input, state) : slotOfProduct(ref.step, state)

  const finalSlot = (state: ObjectState): SlotView => {
    const label = targetItem === null ? msg('label.bookFinal') : msg('label.itemFinal', { item: itemText(targetItem) })
    return {
      label,
      detail: contentsText(levelsOf(state)),
      fullLabel: label,
      item: iconOf(state),
      contents: levelsOf(state),
      source: null,
      anvilUses: state.anvilUses,
      letter: null,
      enchanted: state.enchantments.length > 0,
    }
  }

  const resultSlot = (step: PlanStep): SlotView => {
    if (step.consumedBy === null) return finalSlot(step.after)
    if (letterOf.has(step.index)) return slotOfProduct(step.index, step.after)
    const label = baseName()
    return {
      label,
      detail: contentsText(levelsOf(step.after)),
      fullLabel: label,
      item: iconOf(step.after),
      contents: levelsOf(step.after),
      source: null,
      anvilUses: step.after.anvilUses,
      letter: null,
      enchanted: step.after.enchantments.length > 0,
    }
  }

  const overCapSteps = new Set(source.warnings.flatMap((w) => (w.code === 'steps-over-survival-limit' ? w.steps : [])))
  const loyaltyWarning = source.warnings.some((w) => w.code === 'bedrock-unverified-value' && w.detail === 'loyalty-item-multiplier')

  const title = (step: PlanStep, right: SlotView | null): Text => {
    const letter = letterOf.get(step.index)
    if (letter !== undefined) {
      return step.after.kind === 'book'
        ? msg('title.makeBook', { x: letter })
        : msg('title.makeItem', { item: itemText(step.after.itemType ?? 'enchanted_book'), x: letter })
    }
    if (step.kind === 'rename' || right === null) {
      return msg('title.rename', { item: targetItem === null ? msg('label.bookBase') : itemText(targetItem) })
    }
    if (targetItem === null) return msg('title.mergeInto', { right: right.label })
    return step.before.right?.kind === 'item'
      ? msg('title.combineItem', { item: itemText(targetItem), right: right.label })
      : msg('title.apply', { item: itemText(targetItem), right: right.label })
  }

  const steps: DisplayStep[] = order.map((index) => {
    const step = stepAt(index)
    const left = slotOfRef(step.left, step.before.left)
    const right = step.right === null || step.before.right === null ? null : slotOfRef(step.right, step.before.right)
    const rightIsItem = step.before.right?.kind === 'item'
    const warnings: WarningCode[] = []
    if (overCapSteps.has(index)) warnings.push('steps-over-survival-limit')
    if (loyaltyWarning && rightIsItem && step.before.right?.enchantments.some((e) => e.id === 'loyalty')) {
      warnings.push('bedrock-unverified-value')
    }
    return {
      no: noOf.get(index)!,
      engineIndex: index,
      section: chainSet.has(index) ? 'target' : 'materials',
      kind: step.kind,
      title: title(step, right),
      left,
      right,
      result: resultSlot(step),
      cost: step.cost,
      xpPoints: step.xpPoints,
      renameHere: step.cost.rename === 1,
      tooExpensive: step.tooExpensive,
      warnings,
      rightIsItem,
    }
  })

  // Inputs the plan uses, in the order they appear from left to right
  const leavesOf = (ref: ObjRef): number[] => {
    if (ref.kind === 'input') return [ref.input]
    const step = stepAt(ref.step)
    return step.right === null ? leavesOf(step.left) : [...leavesOf(step.left), ...leavesOf(step.right)]
  }
  const leafOrder = leavesOf(plan.finalRef)
  // Input index -> engine step that consumes it
  const consumer = new Map<number, number>()
  for (const step of plan.steps) {
    if (step.left.kind === 'input') consumer.set(step.left.input, step.index)
    if (step.right?.kind === 'input') consumer.set(step.right.input, step.index)
  }
  const chainNos = chain.map((i) => noOf.get(i)!)
  const stepsOfInput = (index: number): number[] => {
    if (index === baseInput) return chainNos
    const use = consumer.get(index)
    return use === undefined ? [] : [noOf.get(use)!]
  }

  const getBooks: GetBookView[] = []
  const ownedUsed: OwnedUsedView[] = []
  for (const index of leafOrder) {
    const src = sources[index]
    const input = inputs[index]
    if (src.kind === 'supplement') {
      getBooks.push({ id: src.enchantment, level: src.level })
      continue
    }
    const label =
      src.kind === 'target' && input.itemType !== null && input.kind === 'item'
        ? targetLabelOf(input.itemType, input.enchantments, input.anvilUses)
        : inputLabel(index).fullLabel
    ownedUsed.push({ source: src, label, steps: stepsOfInput(index) })
  }
  const fallbackIds = new Set(built?.fallback ?? [])
  const fallbackUsed = getBooks.filter((b) => fallbackIds.has(b.id)).map((b) => b.id)

  // Unused inputs
  const goal = goalOf(problem) ?? {}
  const existing: EnchantLevels = source.input?.existing ?? (problem.mode === 'advanced' && problem.target ? problem.target.enchantments : {})
  const selected: Record<string, number> = { ...existing }
  for (const [id, level] of Object.entries(goal)) selected[id] = Math.max(selected[id] ?? 0, level ?? 0)
  const supplementIds = new Set<string>((built?.supplements ?? []).map((b) => b.id))
  const finalLevels = levelsOf(plan.final)

  const reasonOf = (levels: EnchantLevels, excludedReason: 'below-wanted' | 'curse' | null): UnusedReason => {
    const own = enchantEntries(levels)
    if (excludedReason === 'curse') {
      const curse = own.find((e) => selected[e.id] === undefined && isCurse(e.id))
      if (curse !== undefined) return { code: 'curse', curse: curse.id }
    }
    const selectedIds = Object.keys(selected) as EnchantmentId[]
    for (const e of own) {
      const conflict = selectedIds.find((g) => g !== e.id && !areCompatible(settings.edition, e.id, g))
      if (conflict !== undefined) return { code: 'conflicts-wanted', name: e.id, wanted: conflict }
    }
    const inWanted = own.filter((e) => selected[e.id] !== undefined).sort((a, b) => compareTooltipOrder(a.id, b.id))
    if (inWanted.length === 0) return { code: 'no-wanted' }
    if (targetItem !== null && inWanted.every((e) => (existing[e.id] ?? 0) >= (selected[e.id] ?? 0))) {
      const first = inWanted[0]
      return { code: 'target-has', name: first.id, level: existing[first.id] ?? 0 }
    }
    if (excludedReason === 'below-wanted' || inWanted.every((e) => supplementIds.has(e.id))) {
      return { code: 'below-wanted', names: inWanted.map((e) => e.id) }
    }
    if (fallbackUsed.length > 0 && inWanted.every((e) => fallbackIds.has(e.id))) {
      return { code: 'fallback', names: inWanted.map((e) => e.id) }
    }
    if (inWanted.every((e) => (finalLevels[e.id] ?? 0) >= (selected[e.id] ?? 0))) {
      return { code: 'covered-by-others', name: inWanted[0].id }
    }
    return { code: 'raises-total' }
  }

  const ownedUnused: OwnedUnusedView[] = []
  // Grouped per owned-book row. Books to get are never listed as unused.
  const unusedByRow = new Map<string, { source: InputSource; inputs: number[] }>()
  for (const index of plan.unusedInputs) {
    const src = sources[index]
    if (src.kind === 'supplement' || src.kind === 'target') continue
    const key = src.kind === 'owned' ? `owned:${src.index}` : `extra:${src.index}`
    const row = unusedByRow.get(key) ?? { source: src, inputs: [] }
    row.inputs.push(index)
    unusedByRow.set(key, row)
  }
  for (const row of unusedByRow.values()) {
    const input = inputs[row.inputs[0]]
    ownedUnused.push({
      source: row.source,
      count: row.inputs.length,
      label: inputLabel(row.inputs[0]).fullLabel,
      reason: reasonOf(input.enchantments, null),
    })
  }
  // Things removed before solving are not engine inputs, so their contents come from the input state.
  const excludedRows = new Map<string, { source: InputSource; reason: 'below-wanted' | 'curse' }>()
  for (const entry of built?.excluded ?? []) {
    if (entry.source.kind !== 'owned' && entry.source.kind !== 'extra') continue
    const key = `${entry.source.kind}:${entry.source.index}`
    if (!excludedRows.has(key)) excludedRows.set(key, entry)
  }
  for (const entry of excludedRows.values()) {
    const src = entry.source
    const levels =
      src.kind === 'owned' ? source.input?.ownedBooks[src.index]?.enchantments : src.kind === 'extra' ? source.input?.extraItems[src.index]?.enchantments : undefined
    if (levels === undefined) continue
    const detail = contentsText(levels)
    const count = src.kind === 'owned' ? (source.input?.ownedBooks[src.index]?.count ?? 1) : 1
    ownedUnused.push({
      source: src,
      count,
      label:
        src.kind === 'owned'
          ? msg('label.book', { list: detail ?? '' })
          : msg('label.extra', { item: itemText(targetItem ?? 'enchanted_book'), n: src.kind === 'extra' ? src.index + 1 : 1 }),
      reason: reasonOf(levels, entry.reason),
    })
  }
  // Owned books first, then extra items, each by index.
  const rank = (src: InputSource) => (src.kind === 'owned' ? src.index : src.kind === 'extra' ? 10_000 + src.index : 20_000)
  ownedUnused.sort((a, b) => rank(a.source) - rank(b.source))

  const extraEnchantments = source.warnings.flatMap((w) => (w.code === 'result-has-extra-enchantments' ? w.enchantments : []))

  return {
    planId: built?.planId ?? planIdOf(problem, settings),
    steps,
    getBooks,
    ownedUsed,
    ownedUnused,
    fallbackUsed,
    summary: source.summary,
    baseline: source.baseline,
    extraEnchantments,
    targetItem,
  }
}

export function displayPlanFromResult(
  result: SolveOk,
  problem: Problem,
  settings: Settings,
  context: { readonly built?: BuiltProblemView | null; readonly input?: InputView | null } = {},
): DisplayPlan {
  return buildDisplayPlan({
    problem,
    settings,
    plan: result.plan,
    summary: result.summary,
    baseline: result.baseline,
    warnings: result.warnings,
    built: context.built ?? null,
    input: context.input ?? null,
  })
}

export function displayPlanFromReference(
  reference: ReferencePlan,
  problem: Problem,
  settings: Settings,
  context: { readonly built?: BuiltProblemView | null; readonly input?: InputView | null } = {},
): DisplayPlan {
  return buildDisplayPlan({
    problem,
    settings,
    plan: reference.plan,
    summary: reference.summary,
    baseline: null,
    warnings: [],
    built: context.built ?? null,
    input: context.input ?? null,
  })
}
