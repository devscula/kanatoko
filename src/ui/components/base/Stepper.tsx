// The -/+ buttons stay out of the tab order: keyboard users work the spinbutton directly.

import type { KeyboardEvent } from 'react'
import { IconButton } from './Button.tsx'
import styles from './Stepper.module.css'

export interface StepperProps {
  readonly value: number
  readonly min: number
  readonly max: number
  onChange(value: number): void
  readonly labelledBy?: string
  readonly label?: string
  readonly valueText: string
  readonly decrementLabel: string
  readonly incrementLabel: string
  readonly describedBy?: string
  readonly pageStep?: number
  readonly readOnly?: boolean
  onReadOnlyActivate?(): void
  readonly id?: string
  readonly className?: string
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  labelledBy,
  label,
  valueText,
  decrementLabel,
  incrementLabel,
  describedBy,
  pageStep = 3,
  readOnly = false,
  onReadOnlyActivate,
  id,
  className,
}: StepperProps) {
  const set = (next: number) => {
    if (readOnly) {
      onReadOnlyActivate?.()
      return
    }
    const clamped = Math.max(min, Math.min(max, next))
    if (clamped !== value) onChange(clamped)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowUp: value + 1,
      ArrowRight: value + 1,
      ArrowDown: value - 1,
      ArrowLeft: value - 1,
      PageUp: value + pageStep,
      PageDown: value - pageStep,
      Home: min,
      End: max,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    set(next)
  }

  return (
    <div className={[styles.stepper, className ?? ''].filter(Boolean).join(' ')}>
      <IconButton
        icon="minus"
        label={decrementLabel}
        tabIndex={-1}
        disabled={value <= min}
        aria-disabled={readOnly || undefined}
        onClick={() => set(value - 1)}
      />
      <div
        id={id}
        role="spinbutton"
        tabIndex={0}
        className={styles.value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        aria-labelledby={labelledBy}
        aria-label={labelledBy === undefined ? label : undefined}
        aria-describedby={describedBy}
        aria-readonly={readOnly || undefined}
        onKeyDown={onKeyDown}
      >
        {value}
      </div>
      <IconButton
        icon="plus"
        label={incrementLabel}
        tabIndex={-1}
        disabled={value >= max}
        aria-disabled={readOnly || undefined}
        onClick={() => set(value + 1)}
      />
    </div>
  )
}
