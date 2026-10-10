import { REVEAL_MS } from '../../components/base/motion.ts'
import { prefersReducedMotion } from '../../components/base/useMediaQuery.ts'
import { getAppStore } from '../../state/store.ts'
import { STEP_ID_PREFIX, stepCardId } from './model.ts'

// Scrolls and focuses directly instead of going through the URL hash, which share links use
export function revealStep(no: number): void {
  const state = getAppStore().getState()
  const switched = state.ui.resultView !== 'list'
  if (switched) state.setResultView('list')
  const run = () => {
    const card = document.getElementById(stepCardId(STEP_ID_PREFIX, no))
    if (card === null) return
    card.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    // Ledger rows focus their formula, step cards their heading
    const heading = card.querySelector<HTMLElement>('[data-step-title]') ?? card.querySelector<HTMLElement>('[tabindex="-1"]')
    heading?.focus({ preventScroll: true })
    card.setAttribute('data-revealed', '')
    setTimeout(() => card.removeAttribute('data-revealed'), REVEAL_MS)
  }
  // After switching to the list, wait for it to render
  if (switched) requestAnimationFrame(run)
  else run()
}
