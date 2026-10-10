import { useId, type ReactNode, type Ref } from 'react'
import styles from './Switch.module.css'

export interface SwitchProps {
  readonly checked: boolean
  onChange(checked: boolean): void
  readonly label: ReactNode
  readonly description?: ReactNode
  readonly disabled?: boolean
  readonly id?: string
  readonly className?: string
  readonly ref?: Ref<HTMLButtonElement>
}

export function Switch({ checked, onChange, label, description, disabled = false, id, className, ref }: SwitchProps) {
  const autoId = useId()
  const descriptionId = `${id ?? autoId}-desc`
  return (
    <div className={[styles.row, className ?? ''].filter(Boolean).join(' ')}>
      <button
        ref={ref}
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description === undefined ? undefined : descriptionId}
        disabled={disabled}
        className={styles.switch}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.label}>{label}</span>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
      </button>
      {description !== undefined && (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      )}
    </div>
  )
}
