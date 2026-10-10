import { useRef, type ReactNode } from 'react'
import { useT } from '../../i18n/useT.ts'
import { Button } from './Button.tsx'
import styles from './ConfirmDialog.module.css'
import { Sheet } from './Sheet.tsx'

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly message: ReactNode
  readonly confirmLabel: ReactNode
  readonly tone?: 'danger' | 'primary'
  onConfirm(): void
  onCancel(): void
}

export function ConfirmDialog({ open, message, confirmLabel, tone = 'primary', onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useT()
  // Focus starts on Cancel, the safe choice. The message is also the dialog's name, so the visible copy is aria-hidden.
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      role="alertdialog"
      width="narrow"
      title={message}
      hideTitle
      hideClose
      initialFocus={() => cancelRef.current}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            {t('confirm.cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className={styles.message} aria-hidden="true">
        {message}
      </p>
    </Sheet>
  )
}
