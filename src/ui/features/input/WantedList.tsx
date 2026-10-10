import { useState } from 'react'
import { areCompatible } from '../../../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../../../data/types.ts'
import { Disclosure } from '../../components/base/Disclosure.tsx'
import { enchantmentLayout, isBookItem, type ConflictGroup, type ListBlock } from '../../data/enchantmentGroups.ts'
import { enchText, listText } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import type { BuiltProblem } from '../../state/buildProblem.ts'
import { existingConflicts } from '../../state/convert.ts'
import type { ValidationIssue } from '../../../engine/index.ts'
import type { InputState } from '../../state/types.ts'
import styles from './EnchantmentList.module.css'
import { INPUT_IDS } from './ids.ts'
import local from './Input.module.css'
import { MaxAllButton } from './MaxAllButton.tsx'
import { enchantmentSearchNames } from './names.ts'
import { matchesQuery } from './search.ts'
import { SearchField } from './SearchField.tsx'
import { useSlashFocus } from './slashFocus.ts'
import { WantedRow } from './WantedRow.tsx'

export interface WantedListProps {
  readonly edition: Edition
  readonly item: ItemTypeId
  readonly input: InputState
  readonly built: BuiltProblem | null
  /** Enchantments for which the fallback solve after an infeasible result used a new book. */
  readonly fallbackUsed: readonly EnchantmentId[]
  readonly issues?: ReadonlyMap<EnchantmentId, readonly ValidationIssue[]>
  readonly readOnly: boolean
  redirect(): void
}

const NONE: readonly EnchantmentId[] = []

export function WantedList({ edition, item, input, built, fallbackUsed, issues, readOnly, redirect }: WantedListProps) {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const isBook = isBookItem(item)
  const layout = enchantmentLayout(edition, item)
  const searching = isBook && query.trim() !== ''
  useSlashFocus(INPUT_IDS.wantedSearch, isBook)

  const owned = new Set<EnchantmentId>()
  for (const b of input.ownedBooks) for (const id of Object.keys(b.enchantments) as EnchantmentId[]) owned.add(id)
  for (const x of input.extraItems) for (const id of Object.keys(x.enchantments) as EnchantmentId[]) owned.add(id)

  const chosen = (id: EnchantmentId) => input.wanted[id] !== undefined || input.existing[id] !== undefined
  const matches = (id: EnchantmentId) => !searching || matchesQuery(query, enchantmentSearchNames(id))
  const blocks: ListBlock[] = layout.blocks.flatMap((block): ListBlock[] => {
    if (block.kind === 'single') return matches(block.id) ? [block] : []
    const members = block.group.members.filter(matches)
    return members.length === 0 ? [] : [{ kind: 'group', group: { ...block.group, members } }]
  })
  const curses = layout.curses.filter(matches)
  const resultCount = blocks.reduce((n, b) => n + (b.kind === 'single' ? 1 : b.group.members.length), 0) + curses.length
  const count = Object.keys(input.wanted).length
  // Wanted enchantments the list leaves out (from another edition's link, or not applicable) get rows first, to show their issues
  const listed = new Set(layout.candidates)
  const unlisted = (Object.keys(input.wanted) as EnchantmentId[]).filter((id) => !listed.has(id))

  const row = (id: EnchantmentId, conflictsWith: readonly EnchantmentId[] = NONE) => (
    <WantedRow
      key={id}
      id={id}
      wanted={input.wanted[id]}
      existing={input.existing[id]}
      blockedBy={existingConflicts(edition, input.existing, id)}
      conflictsWith={conflictsWith}
      coverage={built?.coverage[id]}
      ownedHolds={owned.has(id)}
      fallbackUsed={fallbackUsed.includes(id)}
      issues={issues?.get(id)}
      readOnly={readOnly}
      redirect={redirect}
    />
  )

  const groupRows = (group: ConflictGroup) =>
    group.members.map((id) =>
      row(
        id,
        group.members.filter((other) => other !== id && input.wanted[other] !== undefined && !areCompatible(edition, id, other)),
      ),
    )

  const heading = (group: ConflictGroup) =>
    group.heading.kind === 'pickOne'
      ? t('conflict.pickOne', { n: group.heading.count })
      : t('conflict.star', {
          center: enchText(group.heading.center),
          list: listText(
            group.heading.others.map((id) => enchText(id)),
            'or',
          ),
        })

  return (
    <section className={local.wanted} aria-labelledby={INPUT_IDS.wantedHeading}>
      <div className={local.wantedHead}>
        <h2 id={INPUT_IDS.wantedHeading} className={local.heading}>
          <PixelIcon name="star" size={16} />
          {t('wanted.title')}
        </h2>
        <span className={local.count}>{t('wanted.count', { n: count })}</span>
      </div>
      <MaxAllButton input={input} edition={edition} readOnly={readOnly} redirect={redirect} />
      <div className={styles.list}>
        {isBook && (
          <SearchField
            id={INPUT_IDS.wantedSearch}
            label={t('wanted.filter')}
            value={query}
            onChange={setQuery}
            resultCount={searching ? resultCount : null}
          />
        )}
        {unlisted.length > 0 && (
          <ul className={styles.rows}>{unlisted.map((id) => row(id))}</ul>
        )}
        <p id={INPUT_IDS.groupSr} className="visually-hidden">
          {t('conflict.groupSr')}
        </p>
        {searching && resultCount === 0 ? (
          <p className={styles.none}>{t('search.none')}</p>
        ) : (
          <ul className={styles.rows}>
            {blocks.map((block) =>
              block.kind === 'single' ? (
                row(block.id)
              ) : (
                <li key={`group-${block.group.key}`} className={styles.groupItem}>
                  <div role="group" className={styles.group} aria-labelledby={INPUT_IDS.group(block.group.key)} aria-describedby={INPUT_IDS.groupSr}>
                    <p id={INPUT_IDS.group(block.group.key)} className={styles.groupHeading}>
                      {heading(block.group)}
                    </p>
                    <ul className={styles.rows}>{groupRows(block.group)}</ul>
                  </div>
                </li>
              ),
            )}
            {searching && curses.map((id) => row(id))}
          </ul>
        )}
        {!searching && curses.length > 0 && (
          <Disclosure
            className={styles.curses}
            summary={
              <span className={local.iconLabel}>
                <PixelIcon name="curse" size={16} className={styles.curse} />
                {t('enchant.curses', { n: curses.length })}
              </span>
            }
            defaultOpen={layout.curseOnly || curses.some(chosen)}
          >
            <ul className={[styles.rows, styles.curseRows].join(' ')}>{curses.map((id) => row(id))}</ul>
          </Disclosure>
        )}
      </div>
    </section>
  )
}
