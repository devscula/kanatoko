import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react'
import { Button } from '../../components/base/Button.tsx'
import { DropdownSheet as Sheet } from '../../components/base/DropdownSheet.tsx'
import { msg } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { useAppStore } from '../../state/store.ts'
import { copyToClipboard } from './clipboard.ts'
import { useSharePlan, useShareUrl, useShownLink } from './hooks.ts'
import styles from './ShareSheet.module.css'
import { copyPlanText } from './sharing.ts'

function selectAll(event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) {
  event.currentTarget.select()
}

type CopyStatus = 'copied' | 'manual' | null

function LinkPanel() {
  const translator = useT()
  const { t } = translator
  const link = useShownLink()
  const url = useShareUrl(link)
  const view = useSharePlan()
  const planUrl = useShareUrl(view?.link ?? null)
  const announce = useAppStore((s) => s.announce)
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<CopyStatus>(null)
  const inputId = useId()
  const noteId = useId()

  // The link arrives later because compression is async; reselect it if the field already has focus
  useEffect(() => {
    const input = inputRef.current
    if (input !== null && url !== null && document.activeElement === input) input.select()
  }, [url])

  const copyLink = async () => {
    if (url === null) return
    if (await copyToClipboard(url)) {
      setStatus('copied')
      // Unlike the label by the button, the announcement says what was copied, since the sheet also offers Copy as text
      announce(msg('toast.linkCopied'))
      return
    }
    inputRef.current?.focus()
    inputRef.current?.select()
    setStatus('manual')
    announce(msg('share.copyManual'))
  }

  return (
    <div className={styles.panel}>
      <div className={styles.field}>
        <label htmlFor={inputId} className="visually-hidden">
          {t('share.linkLabel')}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className={styles.input}
          type="text"
          inputMode="none"
          readOnly
          spellCheck={false}
          autoComplete="off"
          value={url ?? ''}
          aria-describedby={noteId}
          onFocus={selectAll}
          onClick={selectAll}
        />
      </div>
      <div className={styles.copyRow}>
        <Button variant="primary" icon="copy" disabled={url === null} onClick={() => void copyLink()}>
          {t('share.copyLink')}
        </Button>
        {status !== null && (
          <p className={styles.status} data-status={status}>
            {status === 'copied' && <PixelIcon name="check" size={16} />}
            {status === 'copied' ? t('toast.copied') : t('share.copyManual')}
          </p>
        )}
      </div>
      {view !== null && (
        <div className={styles.more}>
          <Button icon="copy" onClick={() => void copyPlanText(view, translator, planUrl)}>
            {t('share.copyText')}
          </Button>
        </div>
      )}
      <p id={noteId} className={styles.note}>
        {t('share.includes')}
      </p>
    </div>
  )
}

function ManualTextPanel({ text }: { readonly text: string }) {
  const { t } = useT()
  const announce = useAppStore((s) => s.announce)
  const areaId = useId()
  const hintId = useId()

  useEffect(() => {
    announce(msg('share.copyManual'))
  }, [announce])

  return (
    <div className={styles.panel}>
      <p id={hintId} className={styles.status} data-status="manual">
        {t('share.copyManual')}
      </p>
      <div className={styles.field}>
        <label htmlFor={areaId} className="visually-hidden">
          {t('share.textLabel')}
        </label>
        <textarea
          id={areaId}
          className={`${styles.input} ${styles.text}`}
          readOnly
          spellCheck={false}
          rows={10}
          value={text}
          aria-describedby={hintId}
          onFocus={selectAll}
          onClick={selectAll}
        />
      </div>
    </div>
  )
}

export function ShareSheet() {
  const { t } = useT()
  const open = useAppStore((s) => s.shareSheet.open)
  const manualText = useAppStore((s) => s.shareSheet.manualText)
  const close = useAppStore((s) => s.closeShareSheet)
  return (
    <Sheet open={open} onClose={close} width="narrow" title={manualText === null ? t('share.sheetTitle') : t('share.copyText')}>
      {manualText === null ? <LinkPanel /> : <ManualTextPanel text={manualText} />}
    </Sheet>
  )
}
