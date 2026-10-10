// Problems and settings stay plain JSON (no Map, no classes): they are posted to the worker and hashed into plan IDs.

import type { Edition, EnchantmentId, GameData, ItemTypeId } from '../data/types.ts'
import type { Limits } from './limits.ts'

export type Objective = 'levels' | 'xp' | 'finalPwp'

export interface Settings {
  readonly edition: Edition
  /** null is Creative mode: no Too Expensive limit, every other rule unchanged. */
  readonly levelCap: 39 | null
  readonly objective: Objective
  /** Rename the result once, on a combine step (+1 level) or in a rename-only step. */
  readonly rename: boolean
}

export type EnchantLevels = Partial<Record<EnchantmentId, number>>

export interface BookStack {
  readonly level: number
  readonly count: number
}

export interface SimpleEnchantmentRequest {
  readonly id: EnchantmentId
  readonly level: number                    // final level wanted
  readonly sources?: readonly BookStack[]   // omitted -> [{ level, count: 1 }]
}

export interface SimpleProblem {
  readonly mode: 'simple'
  readonly item: ItemTypeId                 // 'enchanted_book': combine the books into one book, with no target item
  readonly enchantments: readonly SimpleEnchantmentRequest[]
}

export interface ItemInput {
  readonly enchantments: EnchantLevels
  readonly anvilUses: number
}
export interface TargetInput extends ItemInput {
  readonly itemType: ItemTypeId             // never 'enchanted_book' (use target: null)
}
export interface BookInput {
  readonly enchantments: EnchantLevels
  readonly anvilUses: number
  readonly count?: number                   // identical copies, default 1
}

export interface AdvancedProblem {
  readonly mode: 'advanced'
  readonly target: TargetInput | null       // null: books only, the result is a book
  readonly extraItems: readonly ItemInput[] // more items of the target's type, to sacrifice
  readonly books: readonly BookInput[]
  /**
   * At least these levels; other enchantments may remain. null asks for a maximal result: every input is used, and no
   * other plan that uses every input ends with every enchantment at least as high and at least one higher.
   */
  readonly goal: EnchantLevels | null
  readonly useOnlyNeeded: boolean           // only meaningful when goal !== null
}

export type Problem = SimpleProblem | AdvancedProblem

export type InputOrigin =
  | { readonly source: 'simple-item'; readonly itemType: ItemTypeId }
  | { readonly source: 'simple-book'; readonly enchantment: EnchantmentId; readonly level: number; readonly copy: number }
  | { readonly source: 'target' }
  | { readonly source: 'extra-item'; readonly index: number }
  | { readonly source: 'book'; readonly index: number; readonly copy: number }

export interface EngineInput {
  readonly kind: 'item' | 'book'
  readonly itemType: ItemTypeId | null      // null for books
  readonly enchantments: EnchantLevels
  readonly anvilUses: number
  readonly origin: InputOrigin
}

export interface NormalizedProblem {
  readonly inputs: readonly EngineInput[]   // an input is referred to by its index here everywhere else
  readonly targetIndex: number | null       // always 0 when present
  readonly goal: EnchantLevels | null       // null = maximal result (see AdvancedProblem.goal); never null in simple mode
  readonly useOnlyNeeded: boolean           // always false when goal === null
  /** reachableLevel of every enchantment found on any input. */
  readonly reachable: EnchantLevels
  /** Enchantments that can end up on the result: with a target, those applicable to its type and compatible with every
   *  enchantment it already has; with books only, all of them. */
  readonly eligible: readonly EnchantmentId[]
  /**
   * Inputs the search ignores, ascending; empty unless goal !== null && useOnlyNeeded. A book is ignored when it has no
   * goal enchantment and none of its enchantments is on, or exclusive with one on, a kept input (the target included).
   * Using such a book never makes a plan better. Input numbers stay as they are; ignored inputs end up in unusedInputs.
   */
  readonly excludedInputs: readonly number[]
}

export type InputPath =
  | { readonly part: 'target' } | { readonly part: 'extraItem'; readonly index: number }
  | { readonly part: 'book'; readonly index: number } | { readonly part: 'simple'; readonly enchantment: EnchantmentId }
  | { readonly part: 'goal'; readonly enchantment: EnchantmentId } | { readonly part: 'item' }

export type ValidationIssue =
  | { readonly code: 'item-not-in-edition'; readonly itemType: ItemTypeId }
  | { readonly code: 'enchantment-not-in-edition'; readonly enchantment: EnchantmentId; readonly where: InputPath }
  | { readonly code: 'level-out-of-range'; readonly enchantment: EnchantmentId; readonly level: number; readonly maxLevel: number; readonly where: InputPath }
  | { readonly code: 'input-self-conflict'; readonly a: EnchantmentId; readonly b: EnchantmentId; readonly where: InputPath }
  | { readonly code: 'not-applicable-on-item-input'; readonly enchantment: EnchantmentId; readonly where: InputPath }
  | { readonly code: 'empty-book'; readonly where: InputPath }
  | { readonly code: 'anvil-uses-out-of-range'; readonly value: number; readonly where: InputPath }
  | { readonly code: 'count-out-of-range'; readonly value: number; readonly where: InputPath }
  | { readonly code: 'target-is-book' }
  | { readonly code: 'extra-items-without-target' }
  | { readonly code: 'extra-item-not-combinable'; readonly itemType: ItemTypeId }   // non-damageable type
  | { readonly code: 'duplicate-simple-enchantment'; readonly enchantment: EnchantmentId }

export type ValidationIssueCode = ValidationIssue['code']

/** PlanSummary field names, plus inputsUsed: the number of inputs a plan uses. */
export type PlanKeyName = 'totalLevels' | 'maxStepLevels' | 'xpPoints' | 'finalPriorWorkPenalty' | 'inputsUsed'

export type PlanKeys = { readonly [K in PlanKeyName]: number }

/**
 * Plans compare lexicographically on these keys and the smaller one wins. Full ties go to the plan found first, so the
 * same problem always gives the same plan.
 */
export const OBJECTIVE_KEYS = {
  levels: ['totalLevels', 'maxStepLevels', 'xpPoints', 'finalPriorWorkPenalty', 'inputsUsed'],
  xp: ['xpPoints', 'totalLevels', 'maxStepLevels', 'finalPriorWorkPenalty', 'inputsUsed'],
  finalPwp: ['finalPriorWorkPenalty', 'totalLevels', 'maxStepLevels', 'xpPoints', 'inputsUsed'],
} as const satisfies Record<Objective, readonly [PlanKeyName, PlanKeyName, PlanKeyName, PlanKeyName, PlanKeyName]>

/** Key values in the order of OBJECTIVE_KEYS[objective]. */
export type KeyVector = readonly [number, number, number, number, number]

export type PlanNode =
  | { readonly t: 'leaf'; readonly input: number; readonly preRename: boolean }
  | { readonly t: 'combine'; readonly left: PlanNode; readonly right: PlanNode; readonly rename: boolean }

export interface ComplexityEstimate {
  readonly complexity: number                 // C: (subset, left part) pairs the exact search enumerates
  readonly effectiveComplexity: number        // C_eff: C doubled for rename and again without a cap
  readonly fastPathEligible: boolean
  readonly level: 'instant' | 'ok' | 'slow' | 'too-complex'
  readonly hardLimit: number
}

export interface Baseline {
  readonly stepCosts: readonly number[]
  readonly totalLevels: number
  readonly maxStepLevels: number
  readonly xpPoints: number
  readonly firstTooExpensiveStep: number | null  // 1-based; first step >= 40 (survival only)
  readonly skippedInputs: readonly number[]
  /** With a goal: the chain meets it. Without one: no enchantment ends lower than on the plan's result. */
  readonly achievesGoal: boolean
  /** The chain is a like-for-like alternative: no skipped input, achievesGoal, named when rename, and in survival no
   *  step >= 40. The two savings below are null otherwise. */
  readonly comparable: boolean
  readonly savedLevels: number | null             // baseline - plan
  readonly savedXpPoints: number | null
}

export type FailureReason =
  | { readonly code: 'goal-not-in-edition' | 'goal-not-applicable' | 'goal-enchantment-missing'; readonly enchantment: EnchantmentId }
  | { readonly code: 'goal-conflict'; readonly a: EnchantmentId; readonly b: EnchantmentId }
  | { readonly code: 'goal-conflicts-with-target'; readonly enchantment: EnchantmentId; readonly existing: EnchantmentId }
  | { readonly code: 'goal-level-unreachable'; readonly enchantment: EnchantmentId; readonly required: number; readonly reachable: number }
  | { readonly code: 'target-penalty-too-high'; readonly priorWorkPenalty: number }
  | { readonly code: 'too-expensive'; readonly uncappedTotal: number; readonly uncappedMaxStep: number; readonly stepsOverCap: readonly number[]; readonly minAchievableMaxStep: number | null }
  | { readonly code: 'cannot-use-all-inputs'; readonly unusable: readonly number[] }
  | { readonly code: 'no-plan' }

export type FailureReasonCode = FailureReason['code']

export type Suggestion =
  | { readonly code: 'drop-goal-enchantment'; readonly enchantment: EnchantmentId; readonly totalLevels: number; readonly maxStepLevels: number }
  | { readonly code: 'lower-goal-level'; readonly enchantment: EnchantmentId; readonly level: number; readonly totalLevels: number; readonly maxStepLevels: number }   // simple mode only
  | { readonly code: 'add-book'; readonly enchantment: EnchantmentId; readonly level: number; readonly totalLevels: number; readonly maxStepLevels: number }
  | { readonly code: 'remove-input'; readonly input: number; readonly totalLevels: number; readonly maxStepLevels: number }
  | { readonly code: 'enable-use-only-needed'; readonly totalLevels: number; readonly maxStepLevels: number }

export type SuggestionCode = Suggestion['code']

export type SolveMethod = 'tree-table' | 'exact' | 'trivial'

export interface Assumptions {
  readonly edition: Edition
  readonly levelCap: 39 | null
  readonly objective: Objective
  readonly rulesBasis: 'java-26.3-code' | 'bedrock-26.5x-wiki'
  readonly dataVersion: GameData['version']
  readonly fullDurability: true
  readonly xpAssumption: 'exact-levels-per-step'   // each step paid at exactly its cost in levels (stepXp)
}

interface ResultBase { readonly assumptions: Assumptions; readonly warnings: readonly Warning[]; readonly stats: SolveStats }

export interface SolveOk extends ResultBase {
  readonly status: 'ok'
  readonly method: SolveMethod
  readonly plan: Plan
  readonly summary: PlanSummary
  readonly baseline: Baseline | null
}
export interface SolveInfeasible extends ResultBase {
  readonly status: 'infeasible'
  readonly reasons: readonly FailureReason[]
  readonly suggestions: readonly Suggestion[]
  /** false when some candidates went unchecked (too costly, over the re-solve limit or budget, or undecided). */
  readonly suggestionsComplete: boolean
  /** The cap is known not to be the cause: no cap, only cap-independent reasons, or infeasible without the cap too. */
  readonly capExcluded: boolean
  readonly reference: ReferencePlan | null         // over-cap plan, display only
}
export interface SolveTooComplex extends ResultBase {
  readonly status: 'too-complex'
  readonly complexity: ComplexityEstimate
  readonly cause: 'complexity-limit' | 'state-limit' | 'time-limit'   // 'time-limit' includes the projected-time abort
  readonly reference: ReferencePlan | null
}
export interface SolveInvalid { readonly status: 'invalid'; readonly issues: readonly ValidationIssue[] }
export interface SolveEmpty { readonly status: 'empty' }
export interface SolveCancelled { readonly status: 'cancelled' }

export type SolveResult = SolveOk | SolveInfeasible | SolveTooComplex | SolveInvalid | SolveEmpty | SolveCancelled

export type SolveStatus = SolveResult['status']

export interface SolveStats {
  readonly elapsedMs: number
  readonly fastPath: { readonly eligible: boolean; readonly ineligibleBecause: string | null; readonly classes: number;
                       readonly shapesAtOptimum: number; readonly tieBreakEvaluations: number; readonly tieBreakComplete: boolean } | null
  readonly exact: { readonly complexity: number; readonly subsets: number; readonly states: number;
                    readonly transitions: number; readonly prunedByBound: number } | null
  readonly diagnosticsMs: number | null
}

export type ObjRef = { readonly kind: 'input'; readonly input: number } | { readonly kind: 'step'; readonly step: number }  // step: 1-based

export interface ObjectState {
  readonly kind: 'item' | 'book'
  readonly itemType: ItemTypeId | null
  readonly enchantments: readonly { readonly id: EnchantmentId; readonly level: number }[]  // game data order
  readonly anvilUses: number
  readonly priorWorkPenalty: number        // 2^anvilUses - 1
  readonly named: boolean
}

export type EnchantOutcome =
  | 'added'
  | 'increased'      // merged into the next level, or the right side had a higher level
  | 'unchanged'      // level stayed (right side lower, or both at max); Java still charges for it
  | 'conflict'       // conflictsWith is non-empty (inapplicable or not); Java charges +1 per conflict
  | 'inapplicable'   // not applicable to the left item and nothing conflicts: dropped at no cost

export interface EnchantCostLine {
  readonly id: EnchantmentId
  readonly leftLevel: number               // 0 if absent
  readonly rightLevel: number
  readonly resultLevel: number             // leftLevel when not transferred
  readonly multiplier: number
  readonly multiplierKind: 'book' | 'item'
  readonly cost: number                    // Java: mult * result; Bedrock: mult * (result - left); 0 if not transferred
  readonly outcome: EnchantOutcome
  readonly conflictsWith: readonly EnchantmentId[]   // set for an inapplicable enchantment too
}

export interface StepCost {
  readonly leftPenalty: number             // prior work penalty
  readonly rightPenalty: number            // prior work penalty, 0 for rename-only
  readonly enchantments: readonly EnchantCostLine[]
  readonly conflictPenalty: number         // Java only: sum of conflictsWith.length over the lines
  readonly rename: 0 | 1
  /** Java rename-only step whose leftPenalty + 1 exceeded 39: that unclamped value; total is then 39. Else null. */
  readonly clampedFrom: number | null
  /** The level cost the anvil shows: leftPenalty + rightPenalty + sum(cost) + conflictPenalty + rename. */
  readonly total: number
}

export interface PlanStep {
  readonly index: number                   // 1-based
  readonly kind: 'combine' | 'rename'
  readonly left: ObjRef
  readonly right: ObjRef | null
  readonly leftLabel: LabelSpec
  readonly rightLabel: LabelSpec | null
  readonly resultLabel: LabelSpec
  readonly before: { readonly left: ObjectState; readonly right: ObjectState | null }
  readonly after: ObjectState
  readonly cost: StepCost
  readonly xpPoints: number                // stepXp(cost.total)
  readonly cumulativeLevels: number
  readonly tooExpensive: boolean           // cost.total >= 40; only possible with levelCap null or in a ReferencePlan
  readonly consumedBy: number | null       // null for the final step
}

export interface Plan {
  readonly steps: readonly PlanStep[]
  readonly final: ObjectState
  readonly finalRef: ObjRef                // an input when there are no steps
  readonly usedInputs: readonly number[]
  readonly unusedInputs: readonly number[]
  readonly tree: PlanNode
}

export interface PlanSummary {
  readonly totalLevels: number
  readonly maxStepLevels: number
  readonly xpPoints: number
  readonly finalPriorWorkPenalty: number
  readonly finalAnvilUses: number
  readonly anvilOperations: number         // rename-only steps included
  readonly booksRequired: readonly { readonly enchantments: EnchantLevels; readonly anvilUses: number; readonly count: number; readonly inputs: readonly number[] }[]
  readonly extraItemsUsed: readonly number[]
  readonly finalEnchantments: EnchantLevels
  /** Book-only mode: the cost of applying the finished book to a fresh item that accepts every enchantment on it,
   *  pwp(final.anvilUses) + sum(bookMultiplier * level) in both editions. Items that accept fewer are charged less.
   *  null in item mode. */
  readonly applyToFreshItem: { readonly cost: number; readonly tooExpensive: boolean } | null
}

export type LabelSpec =
  | { readonly t: 'input'; readonly input: number; readonly origin: InputOrigin }
  | { readonly t: 'product'; readonly step: number; readonly kind: 'book' | 'item'; readonly itemType: ItemTypeId | null; readonly targetLineage: boolean }
  | { readonly t: 'final' }

export interface ReferencePlan { readonly plan: Plan; readonly summary: PlanSummary; readonly overCap: true }

export interface DiscardedEnchantment {
  readonly id: EnchantmentId
  readonly inputLevel: number                // highest level of id on a used input
  readonly finalLevel: number                // level on the result; 0 = not on the result
  readonly inputs: readonly number[]         // used inputs carrying id above finalLevel
  readonly reason: 'conflict' | 'inapplicable'
}
export interface KeepAlternative {
  readonly enchantments: EnchantLevels       // added to the goal so that they are kept
  readonly totalLevels: number
  readonly maxStepLevels: number
}
export interface MaximalAlternative {
  readonly enchantments: EnchantLevels       // final enchantments of another maximal result
  readonly totalLevels: number
  readonly maxStepLevels: number
}

export type Warning =
  | { readonly code: 'bedrock-rules-from-wiki' }                                   // always for Bedrock
  | { readonly code: 'bedrock-unverified-value'; readonly detail: 'loyalty-item-multiplier' | 'no-effect-refused' }
  | { readonly code: 'steps-over-survival-limit'; readonly steps: readonly number[] } // levelCap null and some step >= 40
  | { readonly code: 'creative-inapplicable-ignored'; readonly enchantments: readonly EnchantmentId[] }
  | { readonly code: 'result-has-extra-enchantments'; readonly enchantments: readonly EnchantmentId[] } // goal set, final has others
  | { readonly code: 'enchantments-discarded'; readonly items: readonly DiscardedEnchantment[]; readonly keep: KeepAlternative | null }
  | { readonly code: 'below-reachable-level'; readonly items: readonly { readonly id: EnchantmentId; readonly level: number; readonly reachable: number }[] }
  | { readonly code: 'other-maximal-results'; readonly results: readonly MaximalAlternative[] }
  | { readonly code: 'final-book-too-expensive-to-apply'; readonly cost: number }
  | { readonly code: 'inputs-unused'; readonly inputs: readonly number[] }
  | { readonly code: 'tie-break-partial' }
  | { readonly code: 'slow-search'; readonly complexity: number }

export type WarningCode = Warning['code']

export type WorkerRequest =
  | { readonly type: 'solve'; readonly id: number; readonly problem: Problem; readonly settings: Settings; readonly options?: SolveOptions }
  | { readonly type: 'cancel'; readonly id: number }

export type WorkerResponse =
  | { readonly type: 'progress'; readonly id: number; readonly phase: 'fast' | 'exact' | 'diagnostics'; readonly done: number; readonly total: number; readonly elapsedMs: number }
  | { readonly type: 'result'; readonly id: number; readonly result: SolveResult }
  | { readonly type: 'error'; readonly id: number; readonly message: string }       // an engine bug

export type SolveProgress = Extract<WorkerResponse, { type: 'progress' }>

export interface SolveOptions {
  readonly forceMethod?: 'exact' | 'tree-table'     // tests only; 'tree-table' on an ineligible problem -> error
  readonly levelCapOverride?: number | null         // tests and diagnostics
  readonly limits?: Partial<Limits>
  readonly skipDiagnostics?: boolean
  readonly skipBaseline?: boolean
}

export type ClientResult =
  | SolveResult
  | { readonly status: 'error'; readonly cause: 'engine-exception' | 'worker-crashed' | 'watchdog'; readonly message: string; readonly retryable: true }

export interface SolverClient {
  /** Supersedes any previous request. Never rejects; every returned promise resolves exactly once. */
  solve(problem: Problem, settings: Settings, onProgress?: (p: Extract<WorkerResponse, { type: 'progress' }>) => void): Promise<ClientResult>
  cancel(): void
  dispose(): void
}
