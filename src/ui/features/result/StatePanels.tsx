import { Button } from '../../components/base/Button.tsx'
import { focusFirstInputIssue, focusWhenReady } from '../../components/base/focus.ts'
import { useColumns } from '../../components/base/useMediaQuery.ts'
import type { TextArg } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { Slot } from '../../icons/Slot.tsx'
import { useAppStore } from '../../state/store.ts'
import type { EmptyReason } from '../../state/types.ts'
import { loadBlocksExample } from '../blocks/actions.ts'
import { BLOCKS_UI } from '../blocks/mode.ts'
import { inputColumn } from '../shell/inputColumn.ts'
import { ANCHOR_HEADING_ATTR } from './resultAnchor.ts'
import styles from './StatePanels.module.css'

type AnchorRef = (el: HTMLElement | null) => (() => void) | undefined

// The card text stands in for a heading as the result bar's focus target
const ANCHOR_TARGET = { [ANCHOR_HEADING_ATTR]: '', tabIndex: -1 } as const

function EmptyAnvil() {
  const { t } = useT()
  const parts = [
    ['left', t('slot.left')],
    ['right', t('slot.right')],
    ['take', t('slot.take')],
  ] as const
  return (
    <div className={styles.anvil} aria-hidden="true">
      {parts.map(([key, label], index) => (
        <span key={key} className={styles.anvilPart}>
          {index === 1 && <PixelIcon name="combine" size={24} className={styles.joiner} />}
          {index === 2 && <PixelIcon name="arrow-right" size={24} className={styles.joiner} />}
          <span className={styles.anvilSlot}>
            <Slot size={72} placeholder />
            <span className={styles.caption}>{label}</span>
          </span>
        </span>
      ))}
    </div>
  )
}

export interface EmptyStateProps {
  readonly reason: EmptyReason
}

export function EmptyState({ reason }: EmptyStateProps) {
  const { t } = useT()
  const wide = useColumns() === 2
  const loadExample = useAppStore((s) => s.loadExample)
  if (reason === 'noEnchantments') {
    const key = BLOCKS_UI
      ? wide ? 'blocks.resultEmptyWide' : 'blocks.resultEmptyNarrow'
      : wide ? 'wanted.emptyWide' : 'wanted.emptyNarrow'
    return (
      <div className={styles.card}>
        <EmptyAnvil />
        <p className={styles.message}>{t(key)}</p>
        {!BLOCKS_UI && <p className={styles.message}>{t('wanted.emptyHint')}</p>}
      </div>
    )
  }
  const key = BLOCKS_UI
    ? wide ? 'blocks.emptyFirstWide' : 'blocks.emptyFirstNarrow'
    : wide ? 'empty.firstWide' : 'empty.firstNarrow'
  return (
    <div className={styles.card}>
      <EmptyAnvil />
      <p className={styles.message}>{t(key)}</p>
      <div className={styles.actions}>
        <Button
          onClick={() => {
            if (BLOCKS_UI) loadBlocksExample()
            else loadExample()
            focusWhenReady(() => document.getElementById('results'))
          }}
        >
          {t('example.load')}
        </Button>
      </div>
    </div>
  )
}

// One book already has everything wanted, so the plan has no steps
export function TrivialState({ list }: { readonly list: TextArg }) {
  const { t } = useT()
  return (
    <div className={styles.card}>
      <p className={styles.message}>{t('book.single', { list })}</p>
    </div>
  )
}

function goToFirstIssue(): void {
  focusFirstInputIssue(inputColumn() ?? document)
}

export function InvalidState({ count, anchorRef }: { readonly count: number; readonly anchorRef?: AnchorRef }) {
  const { t } = useT()
  return (
    <div ref={anchorRef} className={styles.card}>
      <p className={styles.message} {...ANCHOR_TARGET}>
        {t('invalid.summary', { n: count })}
      </p>
      <div className={styles.actions}>
        <Button onClick={goToFirstIssue}>{t('invalid.goTo')}</Button>
      </div>
    </div>
  )
}

export function ErrorState({ repeated, onRetry, anchorRef }: { readonly repeated: boolean; onRetry(): void; readonly anchorRef?: AnchorRef }) {
  const { t } = useT()
  return (
    <div ref={anchorRef} className={[styles.card, styles.error].join(' ')}>
      <p className={styles.errorText} {...ANCHOR_TARGET}>
        <PixelIcon name="warning" size={16} className={styles.errorIcon} />
        <span>
          {t('error.failed')}
          {repeated && <span className={styles.repeat}>{t('error.repeat')}</span>}
        </span>
      </p>
      <div className={styles.actions}>
        <Button onClick={onRetry}>{t('compute.retry')}</Button>
      </div>
    </div>
  )
}
