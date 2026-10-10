import { useEffect, useId, useState } from 'react'
import { Button } from '../../components/base/Button.tsx'
import { RESULT_BAR_COVER_VAR, useCoverVariable } from '../../components/base/coverVariable.ts'
import { MEDIA, useMediaQuery } from '../../components/base/useMediaQuery.ts'
import { fillSlots, SLOT_MARK } from '../../i18n/fillSlots.tsx'
import { useT } from '../../i18n/useT.ts'
import { useSolveFields } from '../../solver/useSolveResult.ts'
import { focusResultAnchor, useAnchorPosition } from './resultAnchor.ts'
import { resultBarContent } from './resultBarContent.ts'
import styles from './ResultBar.module.css'

function Figures({ total, max, steps }: { readonly total: number; readonly max: number; readonly steps: number }) {
  const { t, num } = useT()
  return fillSlots(t('resultBar.summary', { t: SLOT_MARK, m: SLOT_MARK, k: SLOT_MARK }), [
    <span key="t" className={styles.xp}>
      {num(total)}
    </span>,
    <span key="m" className={styles.xp}>
      {num(max)}
    </span>,
    <span key="k" className={styles.number}>
      {num(steps)}
    </span>,
  ])
}

// base.css adjusts the scroll padding and the toast position from this flag
function useDocumentFlag(name: 'resultBar', on: boolean): void {
  useEffect(() => {
    if (!on) return
    const root = document.documentElement
    root.dataset[name] = ''
    return () => {
      delete root.dataset[name]
    }
  }, [name, on])
}

const BAR_FIELDS = ['outcome', 'stale'] as const

export function ResultBar() {
  const { t, text } = useT()
  // Wider layouts scroll each column separately, so the summary stays in view there
  const narrow = !useMediaQuery(MEDIA.medium)
  const position = useAnchorPosition()
  const solve = useSolveFields(BAR_FIELDS)
  const hintId = useId()
  const content = resultBarContent(solve)
  const show = narrow && position === 'below' && content !== null
  useDocumentFlag('resultBar', show)
  const [bar, setBar] = useState<HTMLDivElement | null>(null)
  useCoverVariable(show ? bar : null, RESULT_BAR_COVER_VAR, 'bottom')
  if (!show) return null
  return (
    <div ref={setBar} className={styles.bar}>
      <p className={styles.text}>
        {content.kind === 'figures' ? (
          <Figures total={content.summary.totalLevels} max={content.summary.maxStepLevels} steps={content.steps} />
        ) : (
          text(content.text)
        )}
      </p>
      <Button onClick={focusResultAnchor} aria-describedby={hintId}>
        {content.kind === 'figures' ? t('resultBar.show') : text(content.action)}
      </Button>
      <span id={hintId} hidden>
        {t('a11y.skipResult')}
      </span>
    </div>
  )
}
