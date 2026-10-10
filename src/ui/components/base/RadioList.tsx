import { useId, type ReactNode, type Ref } from 'react'
import styles from './RadioList.module.css'

export interface RadioOption<V extends string> {
  readonly value: V
  readonly label: ReactNode
  /** Shown only while the option is selected */
  readonly note?: ReactNode
}

export interface RadioListProps<V extends string> {
  readonly legend: ReactNode
  readonly options: readonly RadioOption<V>[]
  readonly value: V
  onChange(value: V): void
  readonly disabled?: boolean
  readonly description?: ReactNode
  readonly name?: string
  readonly className?: string
  readonly selectedRef?: Ref<HTMLInputElement>
  readonly id?: string
}

export function RadioList<V extends string>({
  legend,
  options,
  value,
  onChange,
  disabled = false,
  description,
  name,
  className,
  selectedRef,
  id,
}: RadioListProps<V>) {
  const autoId = useId()
  const groupName = name ?? autoId
  return (
    <fieldset id={id} className={[styles.fieldset, className ?? ''].filter(Boolean).join(' ')} disabled={disabled}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>
        {options.map((option) => {
          const checked = option.value === value
          return (
            <div key={option.value} className={styles.option}>
              <label className={styles.row}>
                <input
                  ref={checked ? selectedRef : undefined}
                  type="radio"
                  className={styles.input}
                  name={groupName}
                  value={option.value}
                  checked={checked}
                  onChange={() => onChange(option.value)}
                />
                <span className={styles.mark} aria-hidden="true">
                  <span className={styles.dot} />
                </span>
                <span className={styles.label}>{option.label}</span>
              </label>
              {checked && option.note !== undefined && <p className={styles.note}>{option.note}</p>}
            </div>
          )
        })}
      </div>
      {description !== undefined && <p className={styles.description}>{description}</p>}
    </fieldset>
  )
}
