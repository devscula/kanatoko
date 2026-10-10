import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { IconKey } from '../../icons/iconKeys.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import styles from './SegmentedControl.module.css'

export interface SegmentedOption<V extends string> {
  readonly value: V
  readonly label: ReactNode
  readonly icon?: IconKey
  /** For a label in another language than the UI, such as "English" in Japanese */
  readonly lang?: string
}

export interface SegmentedControlProps<V extends string> {
  readonly options: readonly SegmentedOption<V>[]
  readonly value: V
  onChange(value: V): void
  readonly label?: string
  readonly labelledBy?: string
  readonly disabled?: boolean
  readonly readOnly?: boolean
  onReadOnlyActivate?(): void
  readonly block?: boolean
  readonly className?: string
  readonly id?: string
}

export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  label,
  labelledBy,
  disabled = false,
  readOnly = false,
  onReadOnlyActivate,
  block = false,
  className,
  id,
}: SegmentedControlProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )

  const select = (index: number) => {
    const option = options[index]
    if (option === undefined) return
    refs.current[index]?.focus()
    if (readOnly) {
      onReadOnlyActivate?.()
      return
    }
    if (option.value !== value) onChange(option.value)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1
    const next: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }
    const target = next[event.key]
    if (target === undefined) return
    event.preventDefault()
    if (readOnly) {
      onReadOnlyActivate?.()
      return
    }
    select(target)
  }

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-disabled={disabled || readOnly || undefined}
      className={[styles.group, block ? styles.block : '', className ?? ''].filter(Boolean).join(' ')}
    >
      {options.map((option, index) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={readOnly || undefined}
            lang={option.lang}
            disabled={disabled}
            tabIndex={index === selectedIndex ? 0 : -1}
            className={styles.option}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.icon !== undefined && <PixelIcon name={option.icon} size={16} />}
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
