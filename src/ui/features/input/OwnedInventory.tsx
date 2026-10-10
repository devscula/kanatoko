import { useState } from 'react'
import { areCompatible, isApplicable } from '../../../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../../../data/types.ts'
import { defaultAnvilUses } from '../../../engine/index.ts'
import type { EnchantLevels, ValidationIssue } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { enchText, itemText, listText, msg, type Text } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { ItemImage } from '../../icons/ItemImage.tsx'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { unusedReasonText, type DisplayPlan } from '../../plan/displayPlan.ts'
import { canHaveSpares, enchantEntries, isBookTarget } from '../../state/convert.ts'
import { useAppStore } from '../../state/store.ts'
import type { AnvilUsesOverride, ExtraItem, OwnedBook } from '../../state/types.ts'
import { CardMenu } from './CardMenu.tsx'
import { INPUT_IDS } from './ids.ts'
import { IssueNotes } from './IssueNotes.tsx'
import styles from './Input.module.css'
import { SummaryDisclosure } from './SummaryDisclosure.tsx'

export interface OwnedInventoryProps {
  readonly edition: Edition
  readonly item: ItemTypeId
  readonly existing: EnchantLevels
  readonly books: readonly OwnedBook[]
  readonly extras: readonly ExtraItem[]
  /** null until solved. */
  readonly plan: DisplayPlan | null
  /** From capacityLeft. */
  readonly capacity: number | 'over' | null
  /** Keyed by row uid. */
  readonly issues?: ReadonlyMap<string, readonly ValidationIssue[]>
  readonly readOnly: boolean
  redirect(): void
  onAddBook(): void
  onAddExtra(): void
  onEditBook(uid: string): void
  onEditExtra(uid: string): void
}

function contentsText(enchantments: EnchantLevels): Text {
  return listText(enchantEntries(enchantments).map((e) => enchText(e.id, e.level)))
}

export function OwnedInventory({
  edition,
  item,
  existing,
  books,
  extras,
  plan,
  capacity,
  issues,
  readOnly,
  redirect,
  onAddBook,
  onAddExtra,
  onEditBook,
  onEditExtra,
}: OwnedInventoryProps) {
  const { t, text } = useT()
  const expanded = useAppStore((s) => s.ui.disclosures[INPUT_IDS.owned] ?? false)
  const toggle = useAppStore((s) => s.toggleDisclosure)
  const book = isBookTarget(item)
  const spares = canHaveSpares(item)
  const bookCount = books.reduce((n, b) => n + b.count, 0)
  const value =
    bookCount === 0 && extras.length === 0
      ? t('owned.none')
      : extras.length === 0
        ? t('owned.summary', { n: bookCount })
        : bookCount === 0
          ? t('owned.summarySpares', { m: extras.length })
          : t('owned.summaryWithSpares', { n: bookCount, m: extras.length })
  const title = book || !spares ? t('owned.titleBooks') : t('owned.title', { item: itemText(item) })
  const guard = (run: () => void) => () => (readOnly ? redirect() : run())
  const capacityText =
    capacity === null ? null : capacity === 'over' ? t('capacity.over') : capacity === 0 ? t('capacity.none') : t('capacity.left', { n: capacity })

  return (
    <SummaryDisclosure
      id={INPUT_IDS.owned}
      icon="chest"
      label={title}
      value={value}
      actionLabel={t('owned.open')}
      expanded={expanded}
      onToggle={() => toggle(INPUT_IDS.owned)}
      meta={
        capacityText === null ? undefined : (
          <span className={styles.capacity} data-over={capacity === 'over' || undefined}>
            {capacityText}
          </span>
        )
      }
    >
      <div className={styles.owned}>
        <p className={styles.muted}>{t('owned.note')}</p>
        {(books.length > 0 || extras.length > 0) && (
          <ul className={styles.ownedRows}>
            {books.map((b, index) => (
              <OwnedRow
                key={b.uid}
                uid={b.uid}
                kind="book"
                index={index}
                edition={edition}
                item={item}
                existing={existing}
                enchantments={b.enchantments}
                count={b.count}
                override={b.anvilUsesOverride}
                plan={plan}
                issues={issues?.get(b.uid)}
                readOnly={readOnly}
                redirect={redirect}
                onEdit={() => onEditBook(b.uid)}
              />
            ))}
            {extras.map((x, index) => (
              <OwnedRow
                key={x.uid}
                uid={x.uid}
                kind="extra"
                index={index}
                edition={edition}
                item={item}
                existing={existing}
                enchantments={x.enchantments}
                count={1}
                override={x.anvilUsesOverride}
                plan={plan}
                issues={issues?.get(x.uid)}
                readOnly={readOnly}
                redirect={redirect}
                onEdit={() => onEditExtra(x.uid)}
              />
            ))}
          </ul>
        )}
        <div className={styles.addButtons}>
          <Button id={INPUT_IDS.addBook} onClick={guard(onAddBook)}>
            <span className={styles.addButton}>
              <PlusImage item="enchanted_book" enchanted />
              {t('owned.addBook')}
            </span>
          </Button>
          {!book && (
            <Button onClick={guard(onAddExtra)} disabled={!spares} aria-describedby={spares ? undefined : `${INPUT_IDS.owned}-spare-why`}>
              <span className={styles.addButton}>
                <PlusImage item={item} enchanted={false} />
                {t('owned.addSpare', { item: itemText(item) })}
              </span>
            </Button>
          )}
          {!book && !spares && (
            <p id={`${INPUT_IDS.owned}-spare-why`} className={styles.spareNote}>
              {t('extra.notCombinable', { item: itemText(item) })}
            </p>
          )}
          {book && <p className={styles.spareNote}>{t('extra.bookTarget')}</p>}
          {spares && <p className={styles.spareNote}>{text(msg('owned.spareNote', { item: itemText(item) }))}</p>}
        </div>
      </div>
    </SummaryDisclosure>
  )
}

export function PlusImage({ item, enchanted }: { readonly item: ItemTypeId; readonly enchanted: boolean }) {
  return (
    <span className={styles.plusImage} aria-hidden="true">
      <ItemImage item={item} size={32} enchanted={enchanted} />
      <PixelIcon name="plus" size={16} className={styles.plusMark} />
    </span>
  )
}

interface OwnedRowProps {
  readonly uid: string
  readonly kind: 'book' | 'extra'
  readonly index: number
  readonly edition: Edition
  readonly item: ItemTypeId
  readonly existing: EnchantLevels
  readonly enchantments: EnchantLevels
  readonly count: number
  readonly override: AnvilUsesOverride | null
  readonly plan: DisplayPlan | null
  readonly issues?: readonly ValidationIssue[]
  readonly readOnly: boolean
  redirect(): void
  onEdit(): void
}

function OwnedRow({ uid, kind, index, edition, item, existing, enchantments, count, override, plan, issues, readOnly, redirect, onEdit }: OwnedRowProps) {
  const { t, text } = useT()
  const removeBook = useAppStore((s) => s.removeOwnedBook)
  const removeExtra = useAppStore((s) => s.removeExtraItem)
  const [menuOpen, setMenuOpen] = useState(false)
  const book = kind === 'book'
  const target = isBookTarget(item) ? null : item
  const autoValue = book ? defaultAnvilUses(edition, null, enchantments) : defaultAnvilUses(edition, target, enchantments)
  const uses = override ?? autoValue
  const label: Text = book ? contentsText(enchantments) : msg('label.extra', { item: itemText(item), n: index + 1 })
  const labelString = text(label)
  const entries = enchantEntries(enchantments)

  const tag =
    override === null && autoValue === 0
      ? null
      : override !== null
        ? t('owned.usesTagEntered', { n: uses })
        : t('owned.usesTag', { n: uses })
  const how = t(override === null ? 'owned.how.auto' : 'owned.how.entered')

  const warnings: string[] = []
  if (target !== null) {
    const inapplicable = entries.filter((e) => !isApplicable(edition, target, e.id)).map((e) => e.id)
    if (book && inapplicable.length > 0) {
      warnings.push(t('book.inapplicable', { name: listText(inapplicable.map((id) => enchText(id))), item: itemText(target) }))
    }
    for (const e of entries) {
      const rivals = (Object.keys(existing) as EnchantmentId[]).filter((x) => x !== e.id && !areCompatible(edition, e.id, x))
      if (rivals.length === 0) continue
      warnings.push(t('book.conflictWithTarget', { name: enchText(e.id), item: itemText(target), existing: listText(rivals.map((r) => enchText(r))) }))
      if (edition === 'java') warnings.push(t('book.conflictJavaNote'))
      break
    }
  }

  let usage: string | null = null
  if (plan !== null) {
    const sameRow = (s: { kind: string; index?: number }) => s.kind === (book ? 'owned' : 'extra') && s.index === index
    const used = plan.ownedUsed.filter((u) => sameRow(u.source as { kind: string; index?: number }))
    const unused = plan.ownedUnused.find((u) => sameRow(u.source as { kind: string; index?: number }))
    const steps = [...new Set(used.flatMap((u) => u.steps))].sort((a, b) => a - b)
    if (used.length > 0 && unused !== undefined) {
      usage = `${t('usage.used', { list: text(listText(steps)), k: steps.length })} ${t('usage.partly', { used: used.length, unused: unused.count })}`
    } else if (used.length > 0) {
      usage = t('usage.used', { list: text(listText(steps)), k: steps.length })
    } else if (unused !== undefined) {
      usage = t('owned.unusedWithReason', { reason: unusedReasonText(unused.reason, target) })
    }
  }

  const remove = () => {
    setMenuOpen(false)
    if (readOnly) {
      redirect()
      return
    }
    const next = document.getElementById(INPUT_IDS.ownedRow(uid))?.nextElementSibling as HTMLElement | null
    if (book) removeBook(uid, { label })
    else removeExtra(uid, { label })
    requestAnimationFrame(() => (next ?? document.getElementById(INPUT_IDS.addBook))?.focus())
  }

  return (
    <li id={INPUT_IDS.ownedRow(uid)} tabIndex={-1} className={styles.ownedRow}>
      <div className={styles.ownedMain}>
        <ItemImage item={book ? 'enchanted_book' : item} size={32} enchanted={book || entries.length > 0} book={enchantments} />
        <span className={styles.ownedLabel}>
          {book ? labelString : `${labelString}${entries.length > 0 ? ` ${text(contentsText(enchantments))}` : ''}`}
        </span>
        {count >= 2 && <span className={styles.copies}>{t('card.copies', { n: count })}</span>}
        {tag !== null && (
          <span className={styles.usesTag} aria-label={t('owned.usesTagSr', { n: uses, how })}>
            <PixelIcon name="pwp" size={16} />
            <span aria-hidden="true">{tag}</span>
          </span>
        )}
        <CardMenu label={t('owned.menu', { label })} open={menuOpen} onOpenChange={setMenuOpen}>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              setMenuOpen(false)
              if (readOnly) redirect()
              else onEdit()
            }}
          >
            <PixelIcon name="edit" size={16} />
            {t('owned.edit')}
          </button>
          <button type="button" className={styles.menuItem} onClick={remove}>
            <PixelIcon name="trash" size={16} />
            {t('owned.delete')}
          </button>
        </CardMenu>
      </div>
      {warnings.map((w) => (
        <p key={w} className={styles.ownedWarn}>
          <PixelIcon name="warning" size={16} />
          <span>{w}</span>
        </p>
      ))}
      {usage !== null && <p className={styles.ownedSub}>{usage}</p>}
      {issues !== undefined && <IssueNotes issues={issues} edition={edition} itemType={target} />}
    </li>
  )
}
