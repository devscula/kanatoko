import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import type { EnchantmentId } from '../../../data/types.ts'
import type { EnchantLevels, Problem } from '../../../engine/index.ts'
import { IconButton } from '../../components/base/Button.tsx'
import { SegmentedControl } from '../../components/base/SegmentedControl.tsx'
import { useColumns, useHeightMode, useMediaQuery } from '../../components/base/useMediaQuery.ts'
import { enchText, listText, msg } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import type { InputView } from '../../plan/builtProblem.ts'
import { targetItemOf } from '../../plan/displayPlan.ts'
import { assumptionParts, usesHowOf } from '../../plan/labels.ts'
import { builtOf, useDisplayPlan } from '../../plan/useDisplayPlan.ts'
import type { SolveActions, SolveOutcome, SolveView } from '../../solver/types.ts'
import { useSolveFields } from '../../solver/useSolveResult.ts'
import { ownedBooksCoveredBySupplements } from '../../state/buildProblem.ts'
import type { ResultView as ResultViewMode } from '../../state/slices/ui.ts'
import { getAppStore, useAppStore } from '../../state/store.ts'
import { ShareActions } from '../share/index.tsx'
import { INPUT_IDS } from '../input/ids.ts'
import { focusInputColumn, openItemChange } from '../shell/inputColumn.ts'
import { redirectToSharedBanner } from '../shell/readOnly.ts'
import { isSingleKeyAllowed } from '../shell/shortcuts.ts'
import { ComputeStatus } from './ComputeStatus.tsx'
import { AssumptionLine, ConditionChips } from './ConditionChips.tsx'
import { CreativeBanner } from './CreativeBanner.tsx'
import { InfeasiblePanel } from './InfeasiblePanel.tsx'
import { dropWanted, keepEnchantments, removeOwnedRows, setWantedLevel } from './inputActions.ts'
import { showsBusyBadge } from './model.ts'
import { useResultAnchorRef } from './resultAnchor.ts'
import { revealStep } from './revealStep.ts'
import styles from './ResultPanel.module.css'
import { EmptyState, ErrorState, InvalidState, TrivialState } from './StatePanels.tsx'
import { StepLedger } from './StepLedger.tsx'
import { StepList } from './StepList.tsx'
import { suggestionToast, type ShownSuggestion } from './suggestions.ts'
import { SummaryPanel } from './SummaryPanel.tsx'
import { DetailsPanel, ResultNotices, SummaryBar } from './SummaryPc.tsx'
import { TooComplexPanel } from './TooComplexPanel.tsx'
import { TreeView } from './TreeView.tsx'

interface BoundaryProps {
  readonly fallback: ReactNode
  readonly children: ReactNode
  readonly resetKey: number
}

interface BoundaryState {
  readonly failed: boolean
  readonly resetKey: number
}

// A new result clears the error through resetKey rather than a React key, which would remount the panel on every
// result and lose open breakdowns and focus.
class ResultErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Failed to render the result panel', error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const outcomeKeys = new WeakMap<object, number>()
let nextOutcomeKey = 1
function outcomeKey(outcome: SolveOutcome | null): number {
  if (outcome === null) return 0
  let key = outcomeKeys.get(outcome)
  if (key === undefined) {
    key = nextOutcomeKey++
    outcomeKeys.set(outcome, key)
  }
  return key
}

function useViewShortcut(enabled: boolean, view: ResultViewMode, setView: (view: ResultViewMode) => void): void {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key.toLowerCase() !== 't' || !isSingleKeyAllowed(event)) return
      if (document.querySelector('[aria-modal="true"]') !== null) return
      event.preventDefault()
      setView(view === 'list' ? 'tree' : 'list')
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled, view, setView])
}

function useInput(): InputView & { readonly anvilUsesOverride?: number | null } {
  return useAppStore((s) => s.input)
}

function blockedByShare(): boolean {
  if (!getAppStore().getState().share.active) return false
  redirectToSharedBanner()
  return true
}

function focusAnvilUses(): void {
  const stepper = document.getElementById(INPUT_IDS.usesStepper)
  const disclosure = document.getElementById(INPUT_IDS.usesDisclosure)
  const target =
    stepper?.querySelector<HTMLElement>('input, button') ?? stepper ?? disclosure?.querySelector<HTMLElement>('button') ?? disclosure ?? null
  if (target === null) {
    focusInputColumn()
    return
  }
  target.scrollIntoView({ block: 'center' })
  target.focus({ preventScroll: true })
}

// Leaves out announcement and estimate so their updates do not re-render the panel
export type ResultSolveView = Omit<SolveView, 'announcement' | 'estimate'> & SolveActions

const RESULT_FIELDS = ['outcome', 'pending', 'stale', 'slow', 'slowPredicted', 'cancelled', 'failures', 'extraSuggestions'] as const

export interface ResultViewProps {
  readonly solve: ResultSolveView
  /** Read from the solver when omitted */
  readonly computeProgress?: number | null
}

export function ResultPanel() {
  return <ResultView solve={useSolveFields(RESULT_FIELDS)} />
}

function levelsList(levels: EnchantLevels) {
  return listText((Object.keys(levels) as EnchantmentId[]).map((id) => enchText(id, levels[id])))
}

// Takes the solve state as a prop so tests can render sample results
export function ResultView({ solve, computeProgress }: ResultViewProps) {
  const { t } = useT()
  const columns = useColumns()
  const pc = columns >= 2
  const { compact } = useHeightMode()
  const [conditionsOpen, setConditionsOpen] = useState(false)
  const wideCenter = useMediaQuery('(min-width: 1600px)')
  const view = useAppStore((s) => s.ui.resultView)
  const setResultView = useAppStore((s) => s.setResultView)
  const input = useInput()
  const anchorRef = useResultAnchorRef()

  const { outcome } = solve
  const result = outcome?.kind === 'result' ? outcome.result : null
  const built = useDisplayPlan(outcome)
  const { plan } = built
  const hasSteps = plan !== null && plan.steps.length > 0

  useViewShortcut(hasSteps, view, setResultView)

  const applySuggestion = (suggestion: ShownSuggestion) => {
    if (outcome?.kind !== 'result' || solve.pending || blockedByShare()) return
    const toast = suggestionToast(suggestion, outcome.problem)
    if (suggestion.code === 'drop-goal-enchantment') dropWanted(suggestion.enchantment, toast)
    else setWantedLevel(suggestion.enchantment, suggestion.level, toast)
  }
  const setLevelCap = (levelCap: 39 | null) => {
    if (blockedByShare()) return
    getAppStore().getState().setLevelCap(levelCap, { toast: true })
  }
  const onKeep = (levels: EnchantLevels) => {
    if (blockedByShare()) return
    keepEnchantments(levels)
  }
  const onChooseItem = () => {
    if (blockedByShare()) return
    // The item change dialog belongs to the input column
    openItemChange()
  }

  const usesOf = (problem: Problem) => {
    const target = problem.mode === 'advanced' ? problem.target : null
    if (targetItemOf(problem) === null) return null
    return { n: target?.anvilUses ?? 0, how: usesHowOf(input) }
  }

  let body: ReactNode = null
  if (outcome?.kind === 'empty') {
    body = <EmptyState reason={outcome.reason} />
  } else if (outcome?.kind === 'result' && result !== null) {
    const { problem, settings } = outcome
    const conditions = (
      <div className={styles.conditions} data-compact={(pc && compact && !conditionsOpen) || undefined}>
        <ConditionChips settings={settings}>
          <AssumptionLine
            parts={assumptionParts(problem, {
              anvilUsesOverride: input.anvilUsesOverride ?? null,
              hasSupplements: (plan?.getBooks.length ?? builtOf(outcome)?.supplements.length ?? 0) > 0,
            })}
            settings={settings}
          />
        </ConditionChips>
        {pc && compact && (
          <IconButton
            icon="more"
            variant="ghost"
            className={styles.conditionsMore}
            label={t(conditionsOpen ? 'conditions.collapse' : 'conditions.expand')}
            aria-expanded={conditionsOpen}
            onClick={() => setConditionsOpen((open) => !open)}
          />
        )}
      </div>
    )
    // Java Edition never passes owned books that the books to get already cover to the engine, so only Bedrock
    // offers to remove them
    const belowRows = result.status === 'too-complex' && settings.edition === 'bedrock' ? ownedBooksCoveredBySupplements(outcome.input, outcome.built) : []
    const belowCount = belowRows.reduce((n, index) => n + outcome.input.ownedBooks[index].count, 0)
    const removeBelow = () => {
      // The row indexes are stale during a calculation or once the owned books have changed
      if (solve.pending || blockedByShare() || getAppStore().getState().input.ownedBooks !== outcome.input.ownedBooks) return
      removeOwnedRows(belowRows, msg('owned.summary', { n: belowCount }))
    }
    switch (result.status) {
      case 'ok':
        if (built.failed) {
          body = <ErrorState repeated={false} onRetry={solve.retry} anchorRef={anchorRef} />
          break
        }
        if (plan === null || plan.steps.length === 0) {
          const goal = problem.mode === 'simple' ? Object.fromEntries(problem.enchantments.map((e) => [e.id, e.level])) : (problem.goal ?? {})
          body = (
            <>
              <TrivialState list={levelsList(goal as EnchantLevels)} />
            </>
          )
          break
        }
        body = (
          <>
            {settings.levelCap === null && (
              <CreativeBanner warnings={result.warnings} itemType={targetItemOf(problem)} onSurvival={() => setLevelCap(39)} />
            )}
            {pc ? (
              <SummaryBar
                plan={plan}
                stale={solve.stale}
                compact={compact}
                trivialRename={result.method === 'trivial'}
                anchorRef={anchorRef}
              />
            ) : (
              <SummaryPanel
                plan={plan}
                problem={problem}
                warnings={result.warnings}
                stale={solve.stale}
                trivialRename={result.method === 'trivial'}
                anchorRef={anchorRef}
                onKeep={onKeep}
                onChooseItem={onChooseItem}
              />
            )}
            {conditions}
            {pc && (
              <ResultNotices plan={plan} problem={problem} warnings={result.warnings} newBooks={plan.fallbackUsed} onKeep={onKeep} onChooseItem={onChooseItem} />
            )}
            {view === 'tree' ? (
              <TreeView plan={plan} enginePlan={result.plan} onJump={revealStepSafe} />
            ) : pc ? (
              <StepLedger plan={plan} enginePlan={result.plan} mode={problem.mode} edition={settings.edition} stale={solve.stale} />
            ) : (
              <StepList plan={plan} enginePlan={result.plan} mode={problem.mode} edition={settings.edition} stale={solve.stale} />
            )}
            {pc && <DetailsPanel plan={plan} />}
            {!pc && (
              <div className={styles.shareBottom}>
                <ShareActions />
              </div>
            )}
          </>
        )
        break
      case 'infeasible':
        body = (
          <>
            <InfeasiblePanel
              result={result}
              problem={problem}
              settings={settings}
              stale={solve.stale}
              onApply={applySuggestion}
              onCreative={() => setLevelCap(null)}
              anchorRef={anchorRef}
              uses={usesOf(problem)}
              onCheckUses={focusAnvilUses}
              extra={solve.extraSuggestions != null && solve.extraSuggestions.planId === outcome.planId ? solve.extraSuggestions : null}
            />
            {conditions}
          </>
        )
        break
      case 'too-complex':
        body = (
          <>
            <TooComplexPanel
              result={result}
              problem={problem}
              settings={settings}
              anchorRef={anchorRef}
              belowCount={belowCount}
              onRemoveBelow={removeBelow}
            />
            {conditions}
          </>
        )
        break
      case 'invalid':
        body = <InvalidState count={result.issues.length} anchorRef={anchorRef} />
        break
      case 'empty':
        body = <EmptyState reason="noEnchantments" />
        break
      case 'error':
        body = <ErrorState repeated={solve.failures >= 2} onRetry={solve.retry} anchorRef={anchorRef} />
        break
    }
  }

  return (
    <div className={styles.result} aria-busy={solve.stale || undefined}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          {/* The skip link, the column's aria-labelledby and several focus moves look up this id */}
          <h2 id="results" tabIndex={-1} className={styles.heading}>
            <PixelIcon name="anvil" size={32} />
            <span>{t('results.heading')}</span>
          </h2>
          {showsBusyBadge(solve) && <span className={styles.busy}>{t('compute.busy')}</span>}
        </div>
        {hasSteps && (
          <SegmentedControl<ResultViewMode>
            label={t('results.viewLabel')}
            value={view}
            onChange={setResultView}
            options={[
              { value: 'list', label: t('results.list'), icon: 'list' },
              { value: 'tree', label: t('results.tree'), icon: 'tree' },
            ]}
            className={styles.view}
          />
        )}
        {pc && hasSteps && (
          <div className={styles.shareTop}>
            <ShareActions iconOnly={!wideCenter} />
          </div>
        )}
      </div>
      <ComputeStatus solve={solve} progress={computeProgress} />
      <ResultErrorBoundary resetKey={outcomeKey(outcome)} fallback={<ErrorState repeated={false} onRetry={solve.retry} anchorRef={anchorRef} />}>
        {body}
      </ResultErrorBoundary>
    </div>
  )
}

function revealStepSafe(no: number): void {
  revealStep(no)
}
