import { useRef, type KeyboardEvent } from 'react'
import { romanNumeral } from '../../../data/format.ts'
import { maxLevel } from '../../../data/gameData.ts'
import type { EnchantmentId } from '../../../data/types.ts'
import { enchText } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import styles from './LevelChips.module.css'

export interface LevelChipsProps {
  readonly id: EnchantmentId
  /** null when the enchantment itself is not selected */
  readonly value: number | null
  /** Called only when the level actually changes */
  onChange(level: number): void
  readonly readOnly?: boolean
  onReadOnlyActivate?(): void
  readonly className?: string
}

export function LevelChips({ id, value, onChange, readOnly = false, onReadOnlyActivate, className }: LevelChipsProps) {
  const { t, text } = useT()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const last = maxLevel(id)
  const levels = Array.from({ length: last }, (_, i) => i + 1)
  const name = text(enchText(id))
  const tabbable = value !== null && value >= 1 && value <= last ? value : 1

  const choose = (level: number) => {
    refs.current[level - 1]?.focus()
    if (readOnly) {
      onReadOnlyActivate?.()
      return
    }
    if (level !== value) onChange(level)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, level: number) => {
    const moves: Record<string, number> = {
      ArrowRight: level === last ? 1 : level + 1,
      ArrowDown: level === last ? 1 : level + 1,
      ArrowLeft: level === 1 ? last : level - 1,
      ArrowUp: level === 1 ? last : level - 1,
      Home: 1,
      End: last,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    choose(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('a11y.enchantLevels', { name })}
      aria-disabled={readOnly || undefined}
      className={[styles.chips, className ?? ''].filter(Boolean).join(' ')}
    >
      {levels.map((level) => (
        <button
          key={level}
          ref={(el) => {
            refs.current[level - 1] = el
          }}
          type="button"
          role="radio"
          aria-checked={level === value}
          aria-label={t('a11y.enchantLevel', { name, n: level })}
          aria-disabled={readOnly || undefined}
          tabIndex={level === tabbable ? 0 : -1}
          className={styles.chip}
          onClick={() => choose(level)}
          onKeyDown={(event) => onKeyDown(event, level)}
        >
          {romanNumeral(level)}
        </button>
      ))}
    </div>
  )
}
