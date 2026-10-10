import type { KeyboardEvent } from 'react'
import { enchantmentName, romanNumeral } from '../../../data/format.ts'
import { getEnchantment } from '../../../data/gameData.ts'
import type { EnchantmentId } from '../../../data/types.ts'
import { LevelChips } from '../../components/base/LevelChips.tsx'
import chipStyles from '../../components/base/LevelChips.module.css'
import { enchText, listText, msg, romanText } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import type { Coverage } from '../../state/buildProblem.ts'
import { useAppStore } from '../../state/store.ts'
import styles from './EnchantmentList.module.css'
import type { ValidationIssue } from '../../../engine/index.ts'
import { INPUT_IDS } from './ids.ts'
import { IssueNotes } from './IssueNotes.tsx'
import local from './Input.module.css'
import { announceLevel } from './levelAnnounce.ts'

export interface WantedRowProps {
  readonly id: EnchantmentId
  readonly wanted: number | undefined
  readonly existing: number | undefined
  /** Enchantments already on the item that conflict with this one; any of them makes the row unselectable. */
  readonly blockedBy: readonly EnchantmentId[]
  /** Wanted members of the same conflict group that clash with this one. */
  readonly conflictsWith: readonly EnchantmentId[]
  readonly coverage: Coverage | undefined
  /** An owned book or spare carries this enchantment. */
  readonly ownedHolds: boolean
  /** The fallback solve after an infeasible result used a new book for this enchantment. */
  readonly fallbackUsed: boolean
  readonly issues?: readonly ValidationIssue[]
  readonly readOnly: boolean
  redirect(): void
}

export function WantedRow({ id, wanted, existing, blockedBy, conflictsWith, coverage, ownedHolds, fallbackUsed, issues, readOnly, redirect }: WantedRowProps) {
  const { t, text, lang, edition } = useT()
  const select = useAppStore((s) => s.selectWanted)
  const deselect = useAppStore((s) => s.deselectWanted)
  const announce = useAppStore((s) => s.announce)
  const def = getEnchantment(id)
  const max = def.maxLevel
  const on = existing ?? 0
  const blocked = blockedBy.length > 0
  const locked = wanted === undefined && on > 0
  const selected = wanted !== undefined
  const checkId = INPUT_IDS.check(id)
  const nameId = INPUT_IDS.name(id)
  const noteId = INPUT_IDS.note(id)

  const choose = (level: number) => {
    if (readOnly) redirect()
    else select(id, level)
  }

  const toggle = () => {
    if (readOnly) redirect()
    else if (blocked) announce(msg('wanted.blocked', { existing: listText(blockedBy.map((b) => enchText(b))) }))
    else if (selected) deselect(id)
    else if (locked) {
      if (on < max) select(id, max)
    } else select(id)
  }

  const onCheckKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if (!selected || max === 1) return
    event.preventDefault()
    const next = Math.min(max, Math.max(on + 1, 1, wanted + (event.key === 'ArrowRight' ? 1 : -1)))
    if (next !== wanted) {
      choose(next)
      announceLevel(id, next)
    }
  }

  const notes: { key: string; icon: 'chest' | 'lock' | 'blocked' | null; text: string }[] = []
  if (blocked) {
    notes.push({ key: 'blocked', icon: null, text: t('wanted.blocked', { existing: listText(blockedBy.map((b) => enchText(b))) }) })
  } else if (locked) {
    notes.push({ key: 'on', icon: null, text: max === 1 ? t('wanted.onSingle') : t('wanted.on', { level: romanText(on) }) })
  } else if (selected && on > 0) {
    notes.push({ key: 'raise', icon: null, text: t('wanted.onRaise', { from: romanText(on), to: romanText(wanted) }) })
  }
  if (selected && coverage !== undefined) {
    if (fallbackUsed) notes.push({ key: 'fallback', icon: null, text: t('wanted.fallback') })
    else if (coverage.kind === 'owned' && ownedHolds) notes.push({ key: 'owned', icon: 'chest', text: t('wanted.fromOwned') })
    else if (coverage.kind === 'supplement' && coverage.cursedOnly) notes.push({ key: 'cursed', icon: null, text: t('wanted.ownedCursed') })
    else if (coverage.kind === 'supplement' && ownedHolds && coverage.reachable > 0) {
      notes.push({
        key: 'short',
        icon: null,
        text: t('wanted.ownedShort', { reach: romanText(coverage.reachable), level: romanText(wanted) }),
      })
    }
  }
  if (!selected && !locked && !blocked && conflictsWith.length > 0) {
    notes.push({ key: 'conflict', icon: null, text: t('conflict.with', { name: listText(conflictsWith.map((c) => enchText(c))) }) })
  }

  const markIcon = blocked ? 'blocked' : locked ? 'lock' : null

  return (
    <li
      className={styles.row}
      data-selected={selected || undefined}
      data-readonly={readOnly || undefined}
      data-curse={def.curse || undefined}
      data-locked={locked || undefined}
      data-blocked={blocked || undefined}
    >
      <div className={styles.head}>
        {markIcon === null ? (
          <input
            id={checkId}
            type="checkbox"
            className={styles.input}
            checked={selected}
            aria-labelledby={nameId}
            aria-describedby={notes.length > 0 ? noteId : undefined}
            aria-disabled={readOnly || undefined}
            onChange={toggle}
            onKeyDown={onCheckKeyDown}
          />
        ) : (
          <input
            id={checkId}
            type="checkbox"
            className={styles.input}
            checked={locked}
            aria-labelledby={nameId}
            aria-describedby={noteId}
            aria-disabled="true"
            onChange={toggle}
          />
        )}
        <label htmlFor={checkId} className={styles.hit}>
          {markIcon === null ? (
            <span className={styles.box} aria-hidden="true">
              <PixelIcon name="check" size={16} className={styles.checkMark} />
            </span>
          ) : (
            <span className={local.rowIcon} aria-hidden="true">
              <PixelIcon name={markIcon} size={16} />
            </span>
          )}
          <span className={styles.names}>
            <span className={styles.name}>
              <span id={nameId}>{text(enchText(id))}</span>
              {def.curse && <PixelIcon name="curse" size={16} className={styles.curse} />}
            </span>
            {lang === 'ja' && (
              <span lang="en" className={styles.english}>
                {enchantmentName(id, edition, 'en')}
              </span>
            )}
          </span>
          {selected && max > 1 && (
            <span className={styles.levelText} aria-hidden="true">
              {romanNumeral(wanted)}
            </span>
          )}
        </label>
        {max > 1 && !blocked && on < max && (
          on === 0 ? (
            <LevelChips id={id} value={wanted ?? null} onChange={choose} readOnly={readOnly} onReadOnlyActivate={redirect} className={styles.chips} />
          ) : (
            <LockedChips id={id} on={on} wanted={wanted} onChoose={choose} onReset={() => (readOnly ? redirect() : deselect(id))} />
          )
        )}
      </div>
      {notes.length > 0 && (
        <p id={noteId} className={styles.note}>
          {notes.map((note, i) => (
            <span key={note.key}>
              {i > 0 && ' '}
              {note.icon !== null && <PixelIcon name={note.icon} size={16} className={local.inlineIcon} />}
              {note.text}
            </span>
          ))}
        </p>
      )}
      {issues !== undefined && <IssueNotes issues={issues} edition={edition} itemType={null} />}
    </li>
  )
}

/** Levels below the one already on the item are locked. Choosing that level itself clears the wanted level. */
function LockedChips({
  id,
  on,
  wanted,
  onChoose,
  onReset,
}: {
  readonly id: EnchantmentId
  readonly on: number
  readonly wanted: number | undefined
  onChoose(level: number): void
  onReset(): void
}) {
  const { t, text } = useT()
  const max = getEnchantment(id).maxLevel
  const name = text(enchText(id))
  const current = wanted ?? on
  return (
    <div role="radiogroup" aria-label={t('a11y.enchantLevels', { name })} className={[chipStyles.chips, styles.chips].join(' ')}>
      {Array.from({ length: max }, (_, i) => i + 1).map((level) => {
        const below = level < on
        const atOn = level === on
        const disabled = below || (atOn && wanted === undefined)
        return (
          <button
            key={level}
            type="button"
            role="radio"
            className={chipStyles.chip}
            aria-checked={level === current}
            aria-disabled={disabled || undefined}
            aria-label={disabled ? t('wanted.onLocked', { level: romanText(on) }) : t('a11y.enchantLevel', { name, n: level })}
            tabIndex={level === current ? 0 : -1}
            onClick={() => {
              if (disabled) return
              if (atOn) onReset()
              else if (level !== wanted) onChoose(level)
            }}
          >
            {romanNumeral(level)}
          </button>
        )
      })}
    </div>
  )
}
