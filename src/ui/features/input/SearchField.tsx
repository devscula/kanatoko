import { useEffect, useRef, type JSX, type KeyboardEvent } from 'react'
import { IconButton } from '../../components/base/Button.tsx'
import { msg } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { useAppStore } from '../../state/store.ts'
import styles from './SearchField.module.css'

export const SEARCH_ANNOUNCE_MS = 300

export interface SearchFieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  onChange(value: string): void
  /** null when not searching; nothing is announced then. */
  readonly resultCount: number | null
}

export function SearchField({ id, label, value, onChange, resultCount }: SearchFieldProps): JSX.Element {
  const { t } = useT()
  const announce = useAppStore((s) => s.announce)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasValue = value !== ''

  useEffect(() => {
    if (value.trim() === '' || resultCount === null) return
    const timer = setTimeout(() => announce(msg('search.count', { n: resultCount })), SEARCH_ANNOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value, resultCount, announce])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape' || !hasValue) return
    // Tells an enclosing Sheet that this Escape only cleared the field, so it stays open
    event.preventDefault()
    onChange('')
  }

  const clear = () => {
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <div className={styles.field} data-has-value={hasValue || undefined}>
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <PixelIcon name="search" size={16} className={styles.icon} />
      <input
        ref={inputRef}
        id={id}
        type="search"
        className={styles.input}
        placeholder={label}
        value={value}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {hasValue && <IconButton icon="close" label={t('search.clear')} variant="ghost" className={styles.clear} onClick={clear} />}
    </div>
  )
}
