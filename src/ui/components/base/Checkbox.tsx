import { useId, type ReactNode, type Ref } from 'react'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import styles from './Checkbox.module.css'

export interface CheckboxProps {
  readonly checked: boolean
  onChange(checked: boolean): void
  readonly label: ReactNode
  readonly description?: ReactNode
  readonly disabled?: boolean
  /** Focusable but not toggleable; toggling calls onReadOnlyActivate instead. */
  readonly readOnly?: boolean
  onReadOnlyActivate?(): void
  readonly id?: string
  /** For when only part of the label should be the accessible name; by default the whole label is. */
  readonly labelledBy?: string
  readonly className?: string
  readonly ref?: Ref<HTMLInputElement>
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  readOnly = false,
  onReadOnlyActivate,
  id,
  labelledBy,
  className,
  ref,
}: CheckboxProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const descriptionId = `${inputId}-desc`
  return (
    <div className={[styles.field, className ?? ''].filter(Boolean).join(' ')}>
      <label className={styles.row} htmlFor={inputId}>
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          className={styles.input}
          checked={checked}
          disabled={disabled}
          aria-disabled={readOnly || undefined}
          aria-labelledby={labelledBy}
          aria-describedby={description === undefined ? undefined : descriptionId}
          onChange={(event) => {
            if (readOnly) {
              event.preventDefault()
              onReadOnlyActivate?.()
              return
            }
            onChange(event.target.checked)
          }}
        />
        <span className={styles.box} aria-hidden="true">
          <PixelIcon name="check" size={16} className={styles.check} />
        </span>
        <span className={styles.label}>{label}</span>
      </label>
      {description !== undefined && (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      )}
    </div>
  )
}
