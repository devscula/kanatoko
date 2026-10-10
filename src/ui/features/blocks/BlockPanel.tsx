import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { romanNumeral } from '../../../data/format.ts'
import { maxLevel } from '../../../data/gameData.ts'
import type { EnchantmentId, ItemTypeId } from '../../../data/types.ts'
import { defaultAnvilUses, LIMITS } from '../../../engine/index.ts'
import type { EnchantLevels } from '../../../engine/index.ts'
import { AnchoredPopover } from '../../components/base/AnchoredPopover.tsx'
import { Button, IconButton } from '../../components/base/Button.tsx'
import { Stepper } from '../../components/base/Stepper.tsx'
import { listSeparator } from '../../i18n/render.ts'
import { enchText, itemText, listText, msg, type Text } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { ItemImage } from '../../icons/ItemImage.tsx'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { canHaveSpares, enchantEntries } from '../../state/convert.ts'
import type { AnvilUsesOverride } from '../../state/types.ts'
import { ItemPicker } from '../input/ItemPicker.tsx'
import { RenameToggle } from '../input/RenameToggle.tsx'
import { useInputView } from '../input/useInputView.ts'
import {
  addBooks,
  addExtra,
  chooseItem,
  clearExisting,
  clearMaterials,
  loadBlocksExample,
  removeBlock,
  removeExisting,
  setExisting,
  setExistingLevel,
  setTargetUses,
  syncStoredWanted,
  updateExtra,
  updateOneBook,
} from './actions.ts'
import styles from './BlockPanel.module.css'
import { EnchantSheet, type EnchantSheetMode } from './EnchantSheet.tsx'
import { bookCount, deriveWanted, type BlockWarning } from './model.ts'

type SheetState =
  | { readonly kind: 'item' }
  | { readonly kind: 'enchant'; readonly mode: EnchantSheetMode; readonly uid: string | null; readonly initial: EnchantLevels }
  | null

const LEAVE_MS = 180

export function BlockPanel() {
  const { t, text, lang } = useT()
  const { input, edition, readOnly, redirect } = useInputView()
  const [sheet, setSheet] = useState<SheetState>(null)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const anchorRef = useMemo(() => ({ current: anchorEl }), [anchorEl])
  const addBookRef = useRef<HTMLButtonElement>(null)
  const addExistingRef = useRef<HTMLButtonElement>(null)
  const openAt = (next: NonNullable<SheetState>, el: HTMLElement | null) => {
    setAnchorEl(el)
    setSheet(next)
  }
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set())
  const { item } = input
  const derived = useMemo(() => deriveWanted(input, edition), [input, edition])
  const present = useMemo(() => {
    const ids = new Set<EnchantmentId>()
    for (const b of input.ownedBooks) for (const { id } of enchantEntries(b.enchantments)) ids.add(id)
    return ids
  }, [input.ownedBooks])

  // Restored input may carry wanted enchantments typed into the form input; bring them in line with the blocks once.
  const synced = useRef(false)
  useEffect(() => {
    if (synced.current) return
    synced.current = true
    syncStoredWanted()
  }, [])

  const guard = (run: () => void) => () => (readOnly ? redirect() : run())
  const guardAt = (run: (el: HTMLElement) => void) => (event: MouseEvent<HTMLElement>) => (readOnly ? redirect() : run(event.currentTarget))

  const remove = (uid: string, key: string, label: Text) =>
    guard(() => {
      setLeaving((prev) => new Set(prev).add(key))
      window.setTimeout(() => {
        removeBlock(uid, label)
        setLeaving((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }, LEAVE_MS)
    })

  // The clear button unmounts once the list is empty, so hand focus to the list's add button.
  const clearAll = (run: () => void, next: RefObject<HTMLElement | null>) => {
    if (readOnly) return redirect()
    run()
    requestAnimationFrame(() => next.current?.focus())
  }

  const warningText = (w: BlockWarning) =>
    `${text(enchText(w.id))}: ${
      w.kind === 'conflict' && w.with !== undefined ? t('blocks.warnConflict', { name: enchText(w.with) }) : t('blocks.warnNotApplicable', { item: itemText(item ?? 'boots') })
    }`

  const onSheetSubmit = (levels: EnchantLevels) => {
    const current = sheet
    setSheet(null)
    if (current?.kind !== 'enchant' || readOnly) return
    const { mode, uid } = current
    if (mode === 'existing') setExisting(levels)
    else if (mode === 'bulk') addBooks(enchantEntries(levels).map(({ id, level }) => ({ [id]: level })))
    else if (mode === 'book') {
      if (uid === null) addBooks([levels])
      else updateOneBook(uid, levels)
    } else if (mode === 'extra') {
      if (uid === null) addExtra(levels)
      else updateExtra(uid, levels)
    }
  }

  const onPickItem = (id: ItemTypeId) => {
    setSheet(null)
    if (readOnly) redirect()
    else chooseItem(id)
  }

  const books = bookCount(input)
  const spares = canHaveSpares(item)
  const hasExisting = enchantEntries(input.existing).length > 0
  // A block is one physical book, so a row with count n shows n blocks.
  const bookRows = input.ownedBooks.flatMap((book) => Array.from({ length: book.count }, (_, i) => ({ book, key: `${book.uid}#${i}` })))
  const hasMaterials = bookRows.length > 0 || input.extraItems.length > 0
  const targetUses = item === null ? 0 : (input.anvilUsesOverride ?? defaultAnvilUses(edition, item, input.existing))

  return (
    <section className={styles.panel} aria-labelledby="input-heading">
      <header className={styles.header}>
        <h2 id="input-heading" className={styles.heading}>
          <PixelIcon name="anvil" size={32} />
          {t('blocks.heading')}
        </h2>
        {item !== null && (
          <p className={styles.count} aria-live="polite">
            <span className={styles.countPart} title={t('blocks.countBooks', { n: books })}>
              <ItemImage item="enchanted_book" size={16} />
              <span className="visually-hidden">{t('blocks.countBooks', { n: books })}</span>
              <span aria-hidden="true">{books}</span>
            </span>
            {input.extraItems.length > 0 && (
              <span className={styles.countPart} title={t('blocks.countExtras', { n: input.extraItems.length, item: itemText(item) })}>
                <ItemImage item={item} size={16} />
                <span className="visually-hidden">{t('blocks.countExtras', { n: input.extraItems.length, item: itemText(item) })}</span>
                <span aria-hidden="true">{input.extraItems.length}</span>
              </span>
            )}
          </p>
        )}
      </header>

      {item === null ? (
        <div className={styles.empty}>
          <button type="button" className={styles.emptySlot} aria-haspopup="dialog" onClick={guardAt((el) => openAt({ kind: 'item' }, el))}>
            <span className={styles.emptyPlus}>
              <PixelIcon name="plus" size={48} />
            </span>
            <span className={styles.emptyLabel}>{t('blocks.choosePlain')}</span>
          </button>
          <Button variant="secondary" onClick={guard(loadBlocksExample)}>
            {t('example.load')}
          </Button>
        </div>
      ) : (
        <>
          {/* Item to enchant */}
          <article className={styles.target}>
            <button
              type="button"
              className={`${styles.targetSlot} ${styles.tip}`}
              aria-haspopup="dialog"
              aria-label={t('blocks.changeItem')}
              data-tip={t('blocks.changeItem')}
              onClick={guardAt((el) => openAt({ kind: 'item' }, el))}
            >
              <ItemImage item={item} size={96} enchanted={hasExisting} />
            </button>
            <div className={styles.targetBody}>
              <div className={styles.targetHead}>
                <h3 className={styles.targetName}>{text(itemText(item))}</h3>
                <div className={styles.targetActions}>
                  <UsesMenu
                    value={targetUses}
                    override={input.anvilUsesOverride}
                    onChange={(o) => (readOnly ? redirect() : setTargetUses(o))}
                  />
                </div>
              </div>
              <div className={styles.targetChips}>
                {enchantEntries(input.existing).map(({ id, level }) => (
                  <ExistingChip
                    key={id}
                    id={id}
                    level={level}
                    onLevel={(next) => (readOnly ? redirect() : setExistingLevel(id, next))}
                    onRemove={() => (readOnly ? redirect() : removeExisting(id, enchText(id, maxLevel(id) > 1 ? level : undefined)))}
                  />
                ))}
                <button
                  ref={addExistingRef}
                  type="button"
                  className={`${styles.addButton} ${styles.tip}`}
                  data-icon-only=""
                  aria-label={t('blocks.existing')}
                  data-tip={t('blocks.existing')}
                  onClick={guardAt((el) => openAt({ kind: 'enchant', mode: 'existing', uid: null, initial: input.existing }, el))}
                >
                  <span className={styles.addIcon}>
                    <ItemImage item="enchanted_book" size={32} />
                    <AddMark icon={hasExisting ? 'edit' : 'plus'} />
                  </span>
                </button>
                {hasExisting && <ClearAllButton label={t('blocks.clearExisting')} onClick={() => clearAll(clearExisting, addExistingRef)} />}
                <UsesBadge value={targetUses} />
              </div>
            </div>
          </article>

          {/* Books and spares */}
          {hasMaterials && (
            <ul className={styles.capsules}>
              {bookRows.map(({ book, key }) => {
                const label = listLabel(book.enchantments, text)
                const warnings = derived.warnings[book.uid] ?? []
                const uses = book.anvilUsesOverride ?? 0
                return (
                  <li key={key} className={styles.capsuleItem} data-leaving={leaving.has(key) || undefined}>
                    <button
                      type="button"
                      className={`${styles.capsule} ${styles.tip}`}
                      data-warn={warnings.length > 0 || undefined}
                      onClick={guardAt((el) => openAt({ kind: 'enchant', mode: 'book', uid: book.uid, initial: book.enchantments }, el))}
                      aria-label={text(listText([`${t('blocks.book')}: ${label}`, ...warnings.map(warningText)], 'sentence'))}
                      data-tip={warnings.length > 0 ? text(listText(warnings.map(warningText), 'sentence')) : undefined}
                    >
                      <ItemImage item="enchanted_book" size={32} book={book.enchantments} />
                      <span className={styles.capsuleText}>{capsuleLabel(book.enchantments, warnings, text, listSeparator(lang, 'dot'))}</span>
                      {uses > 0 && (
                        <span className={styles.capsuleUses}>
                          <PixelIcon name="anvil" size={16} />
                          {uses}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      className={`${styles.chipX} ${styles.tip}`}
                      aria-label={`${t('blocks.remove')}: ${label}`}
                      data-tip={t('blocks.remove')}
                      onClick={remove(book.uid, key, msg('blocks.book'))}
                    >
                      <PixelIcon name="close" size={16} />
                    </button>
                  </li>
                )
              })}
              {input.extraItems.map((extra) => {
                const warnings = derived.warnings[extra.uid] ?? []
                const name = t('blocks.extra', { item: itemText(item) })
                const label = listLabel(extra.enchantments, text)
                return (
                  <li key={extra.uid} className={styles.capsuleItem} data-leaving={leaving.has(extra.uid) || undefined}>
                    <button
                      type="button"
                      className={`${styles.capsule} ${styles.tip}`}
                      data-warn={warnings.length > 0 || undefined}
                      onClick={guardAt((el) => openAt({ kind: 'enchant', mode: 'extra', uid: extra.uid, initial: extra.enchantments }, el))}
                      aria-label={text(listText([label === '' ? name : `${name}: ${label}`, ...warnings.map(warningText)], 'sentence'))}
                      data-tip={warnings.length > 0 ? text(listText(warnings.map(warningText), 'sentence')) : undefined}
                    >
                      <ItemImage item={item} size={32} enchanted={label !== ''} />
                      <span className={styles.capsuleText}>{label === '' ? name : capsuleLabel(extra.enchantments, warnings, text, listSeparator(lang, 'dot'))}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.chipX} ${styles.tip}`}
                      aria-label={`${t('blocks.remove')}: ${name}`}
                      data-tip={t('blocks.remove')}
                      onClick={remove(extra.uid, extra.uid, msg('blocks.extra', { item: itemText(item) }))}
                    >
                      <PixelIcon name="close" size={16} />
                    </button>
                  </li>
                )
              })}
              <li className={styles.capsuleItem}>
                <ClearAllButton
                  label={input.extraItems.length > 0 ? t('blocks.clearMaterials', { item: itemText(item) }) : t('blocks.clearBooks')}
                  onClick={() => clearAll(clearMaterials, addBookRef)}
                  large
                />
              </li>
            </ul>
          )}

          <div className={styles.addRow}>
            <button
              ref={addBookRef}
              type="button"
              className={`${styles.addButton} ${styles.tip}`}
              aria-label={t('blocks.addBook')}
              data-tip={t('blocks.addBook')}
              onClick={guardAt((el) => openAt({ kind: 'enchant', mode: 'book', uid: null, initial: {} }, el))}
            >
              <span className={styles.addIcon}>
                <ItemImage item="enchanted_book" size={32} />
                <AddMark />
              </span>
              <span className={styles.addLabel}>{t('blocks.addBookShort')}</span>
            </button>
            {spares && (
              <button
                type="button"
                className={`${styles.addButton} ${styles.tip}`}
                aria-label={t('blocks.addExtra', { item: itemText(item) })}
                data-tip={t('blocks.addExtra', { item: itemText(item) })}
                onClick={guardAt((el) => openAt({ kind: 'enchant', mode: 'extra', uid: null, initial: {} }, el))}
              >
                <span className={styles.addIcon}>
                  <ItemImage item={item} size={32} />
                  <AddMark />
                </span>
                <span className={styles.addLabel}>{t('blocks.addExtraShort', { item: itemText(item) })}</span>
              </button>
            )}
            <button
              type="button"
              className={`${styles.addButton} ${styles.tip}`}
              aria-label={t('blocks.addBulk')}
              data-tip={t('label.withDetail', { label: t('blocks.addBulk'), detail: t('blocks.addBulkHint') })}
              onClick={guardAt((el) => openAt({ kind: 'enchant', mode: 'bulk', uid: null, initial: {} }, el))}
            >
              <span className={styles.bulkIcons} aria-hidden="true">
                <ItemImage item="enchanted_book" size={32} />
                <ItemImage item="enchanted_book" size={32} />
                <ItemImage item="enchanted_book" size={32} />
                <AddMark />
              </span>
              <span className={styles.addLabel}>{t('blocks.addBulkShort')}</span>
            </button>
          </div>

          <div className={styles.rename}>
            <RenameToggle checked={input.rename} readOnly={readOnly} redirect={redirect} />
          </div>
        </>
      )}

      <AnchoredPopover anchor={anchorRef} open={sheet?.kind === 'item'} onClose={() => setSheet(null)} label={t('blocks.choose')} variant="menu" className={styles.itemMenu}>
        <div className={styles.itemMenuBody}>
          <ItemPicker edition={edition} selected={item} onSelect={onPickItem} purpose="dropdown" />
        </div>
      </AnchoredPopover>
      {sheet?.kind === 'enchant' && item !== null && (
        <EnchantSheet
          key={`${sheet.mode}-${sheet.uid ?? 'new'}`}
          anchor={anchorRef}
          mode={sheet.mode}
          editing={sheet.uid !== null}
          edition={edition}
          item={item}
          initial={sheet.initial}
          present={present}
          onSubmit={onSheetSubmit}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  )
}

function capsuleLabel(levels: EnchantLevels, warnings: readonly BlockWarning[], text: (t: Text) => string, separator: string) {
  return enchantEntries(levels).map(({ id, level }, i) => (
    <Fragment key={id}>
      {i > 0 && separator}
      <span data-warn={warnings.some((w) => w.id === id) || undefined}>{text(enchText(id, maxLevel(id) > 1 ? level : undefined))}</span>
    </Fragment>
  ))
}

function listLabel(levels: EnchantLevels, text: (t: Text) => string): string {
  return text(listText(enchantEntries(levels).map(({ id, level }) => enchText(id, level))))
}

function AddMark({ icon = 'plus' }: { readonly icon?: 'plus' | 'edit' }) {
  return (
    <span className={styles.addMark} aria-hidden="true">
      <PixelIcon name={icon} size={16} />
    </span>
  )
}

function ClearAllButton({ label, onClick, large = false }: { readonly label: string; readonly onClick: () => void; readonly large?: boolean }) {
  const { t } = useT()
  return (
    <button type="button" className={`${styles.clearAll} ${styles.tip}`} data-large={large || undefined} aria-label={label} data-tip={label} onClick={onClick}>
      <PixelIcon name="trash" size={16} />
      <span aria-hidden="true">{t('blocks.clearShort')}</span>
    </button>
  )
}

function UsesBadge({ value }: { readonly value: number }) {
  const { t } = useT()
  if (value <= 0) return null
  const tip = t('blocks.usesTip', { n: value, p: 2 ** value - 1 })
  return (
    <span className={`${styles.usesBadge} ${styles.tip}`} role="img" tabIndex={0} aria-label={tip} data-tip={tip}>
      <PixelIcon name="anvil" size={16} />
      <span aria-hidden="true">{value}</span>
    </span>
  )
}

interface UsesMenuProps {
  readonly value: number
  readonly override: AnvilUsesOverride | null
  onChange(next: AnvilUsesOverride | null): void
}

function UsesMenu({ value, override, onChange }: UsesMenuProps) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className={styles.menuWrap}>
      <IconButton icon="more" label={t('blocks.more')} variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className={styles.menu} role="group" aria-label={t('blocks.usesLabel')}>
          <span className={styles.menuLabel}>
            <PixelIcon name="anvil" size={16} />
            {t('blocks.usesLabel')}
          </span>
          <Stepper
            value={value}
            min={0}
            max={LIMITS.maxAnvilUses}
            onChange={onChange}
            label={t('blocks.usesLabel')}
            valueText={t('blocks.uses', { n: value })}
            decrementLabel="−"
            incrementLabel="+"
          />
          {override !== null && (
            <Button variant="ghost" icon="auto-reset" onClick={() => onChange(null)}>
              {t('blocks.usesAuto')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

interface ExistingChipProps {
  readonly id: EnchantmentId
  readonly level: number
  onLevel(level: number): void
  onRemove(): void
}

function ExistingChip({ id, level, onLevel, onRemove }: ExistingChipProps) {
  const { t, text } = useT()
  const [open, setOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  const name = text(enchText(id))
  const max = maxLevel(id)
  const label = text(enchText(id, max > 1 ? level : undefined))
  const close = () => setOpen(false)
  return (
    <span className={styles.chipWrap}>
      {max > 1 ? (
        <button
          ref={chipRef}
          type="button"
          className={styles.chipButton}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t('blocks.editEnchant', { name: enchText(id, level) })}
          onClick={() => setOpen((v) => !v)}
        >
          {label}
          <PixelIcon name="chevron-right" size={16} className={styles.chipCaret} />
        </button>
      ) : (
        <span className={styles.chipStatic}>{label}</span>
      )}
      <button
        type="button"
        className={`${styles.chipX} ${styles.tip}`}
        aria-label={t('blocks.removeEnchant', { name })}
        data-tip={t('blocks.removeEnchant', { name })}
        onClick={onRemove}
      >
        <PixelIcon name="close" size={16} />
      </button>
      {max > 1 && (
        <AnchoredPopover anchor={chipRef} open={open} onClose={close} label={t('blocks.levelOf', { name })}>
          <span className={styles.levels} role="radiogroup" aria-label={t('blocks.levelOf', { name })}>
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === level}
                aria-label={text(enchText(id, n))}
                className={styles.level}
                data-autofocus={n === level || undefined}
                onClick={() => {
                  onLevel(n)
                  close()
                  chipRef.current?.focus()
                }}
              >
                {romanNumeral(n)}
              </button>
            ))}
          </span>
        </AnchoredPopover>
      )}
    </span>
  )
}
