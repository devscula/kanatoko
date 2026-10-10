// UI code may import only this file, client.ts and src/data (no-restricted-imports in .oxlintrc.json).

export { estimateComplexity } from './complexity.ts'
export { defaultAnvilUses } from './defaultAnvilUses.ts'
export { lowerRequestLevel } from './diagnostics.ts'
export { LIMITS } from './limits.ts'
export type { Limits } from './limits.ts'
export { normalizeProblem, reachableLevel } from './normalize.ts'
export { meetsLevels, pwp, SURVIVAL_LEVEL_CAP } from './rules.ts'
export { assumptionsFor, createSolveTask, solveSync } from './solve.ts'
export type { SolveTask, SolveTaskProgress } from './solve.ts'
export { validateProblem } from './validate.ts'
export { stepXp, xpAtLevel, xpToNextLevel } from './xp.ts'

export { OBJECTIVE_KEYS } from './types.ts'
export type {
  AdvancedProblem,
  BookInput,
  BookStack,
  EnchantLevels,
  ItemInput,
  Objective,
  Problem,
  Settings,
  SimpleEnchantmentRequest,
  SimpleProblem,
  TargetInput,
  EngineInput,
  InputOrigin,
  InputPath,
  NormalizedProblem,
  ValidationIssue,
  ValidationIssueCode,
  KeyVector,
  PlanKeyName,
  PlanKeys,
  ComplexityEstimate,
  PlanNode,
  Baseline,
  FailureReason,
  FailureReasonCode,
  Suggestion,
  SuggestionCode,
  Assumptions,
  DiscardedEnchantment,
  EnchantCostLine,
  EnchantOutcome,
  KeepAlternative,
  LabelSpec,
  MaximalAlternative,
  ObjectState,
  ObjRef,
  Plan,
  PlanStep,
  PlanSummary,
  ReferencePlan,
  SolveCancelled,
  SolveEmpty,
  SolveInfeasible,
  SolveInvalid,
  SolveMethod,
  SolveOk,
  SolveResult,
  SolveStats,
  SolveStatus,
  SolveTooComplex,
  StepCost,
  Warning,
  WarningCode,
  ClientResult,
  SolveOptions,
  SolveProgress,
  SolverClient,
  WorkerRequest,
  WorkerResponse,
} from './types.ts'
