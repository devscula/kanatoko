import { useEffect, useRef, useState } from 'react'
import type { ItemTypeId } from '../../../data/types.ts'
import { pwp } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { Sheet } from '../../components/base/Sheet.tsx'
import { useT } from '../../i18n/useT.ts'
import { ItemImage } from '../../icons/ItemImage.tsx'
import { useDisplayPlan } from '../../plan/useDisplayPlan.ts'
import { useSolveView } from '../../solver/useSolveResult.ts'
import { useAppStore } from '../../state/store.ts'
import { EnchantmentDialog, type EnchantmentDialogResult } from './EnchantmentDialog.tsx'
import { INPUT_IDS } from './ids.ts'
import styles from './Input.module.css'
import { ItemCard } from './ItemCard.tsx'
import { ItemPicker } from './ItemPicker.tsx'
import { IssueNotes } from './IssueNotes.tsx'
import { NO_ISSUES, sortIssues } from './issues.ts'
import { capacityLeft } from './model.ts'
import { OwnedInventory } from './OwnedInventory.tsx'
import { RenameToggle } from './RenameToggle.tsx'
import { useInputView } from './useInputView.ts'
import { WantedList } from './WantedList.tsx'

type DialogState =
  | { readonly kind: 'item' }
  | { readonly kind: 'existing' }
  | { readonly kind: 'book'; readonly uid: string | null }
  | { readonly kind: 'extra'; readonly uid: string | null }
  | null

export function InputPanel() {
  const { t } = useT()
  const view = useInputView()
  const { input, edition, levelCap, built, readOnly, redirect } = view
  const setItem = useAppStore((s) => s.setItem)
  const setExisting = useAppStore((s) => s.setExisting)
  const addOwnedBook = useAppStore((s) => s.addOwnedBook)
  const updateOwnedBook = useAppStore((s) => s.updateOwnedBook)
  const addExtraItem = useAppStore((s) => s.addExtraItem)
  const updateExtraItem = useAppStore((s) => s.updateExtraItem)
  const loadExample = useAppStore((s) => s.loadExample)
  const setDisclosure = useAppStore((s) => s.setDisclosure)
  const [dialog, setDialog] = useState<DialogState>(null)
  const pendingFocus = useRef<string | null>(null)

  // Result for the current input only; a stale result shown while solving is ignored
  const outcome = useSolveView((v) => v.outcome)
  const estimate = useSolveView((v) => v.estimate)
  const current =
    outcome?.kind === 'result' && built !== null && (outcome.planId === built.planId || outcome.firstBuilt?.planId === built.planId)
      ? outcome
      : null
  const { plan } = useDisplayPlan(current)
  const fallbackUsed = plan?.fallbackUsed ?? []
  const issues =
    current?.result.status === 'invalid' && built !== null ? sortIssues(current.result.issues, built, input) : NO_ISSUES
  // Whether the item's own anvil uses help explain an infeasible result
  const reasons = current?.result.status === 'infeasible' ? current.result.reasons : []
  const itemPenalty = pwp(built?.effectiveUses.item ?? 0)
  const penaltyReason = reasons.find((r) => r.code === 'target-penalty-too-high')
  const usesWarn = penaltyReason !== undefined || (itemPenalty >= 15 && reasons.some((r) => r.code === 'too-expensive'))
  const usesNote = usesWarn
    ? t('infeasible.targetNote', { min: (penaltyReason?.code === 'target-penalty-too-high' ? penaltyReason.priorWorkPenalty : itemPenalty) + 1 })
    : null

  useEffect(() => {
    if (usesWarn) setDisclosure(INPUT_IDS.usesDisclosure, true)
  }, [usesWarn, setDisclosure])

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    document.getElementById(target)?.focus()
  })

  const guard = (run: () => void) => () => (readOnly ? redirect() : run())

  const onSelectItem = (id: ItemTypeId) => {
    if (readOnly) {
      redirect()
      return
    }
    setItem(id)
    setDialog(null)
    pendingFocus.current = INPUT_IDS.itemCard
  }

  const { item } = input
  if (item === null) {
    return (
      <section className={styles.first} aria-labelledby={INPUT_IDS.itemHeading}>
        <div className={styles.firstHead}>
          <div>
            <h2 id={INPUT_IDS.itemHeading} className={styles.firstTitle}>
              {t('item.question')}
            </h2>
            <p className={styles.lead}>{t('item.lead')}</p>
          </div>
          <Button onClick={guard(loadExample)}>
            <span className={styles.addButton}>
              <ItemImage item="boots" size={32} />
              {t('example.load')}
            </span>
          </Button>
        </div>
        <ItemPicker edition={edition} selected={null} onSelect={onSelectItem} purpose="first" labelledBy={INPUT_IDS.itemHeading} />
      </section>
    )
  }

  const onDialogSubmit = (result: EnchantmentDialogResult) => {
    const current = dialog
    setDialog(null)
    if (current === null || readOnly) return
    if (current.kind === 'existing') {
      setExisting(result.enchantments)
      pendingFocus.current = INPUT_IDS.itemCard
    } else if (current.kind === 'book') {
      const draft = { enchantments: result.enchantments, count: result.count ?? 1, anvilUsesOverride: result.anvilUsesOverride ?? null }
      const uid = current.uid === null ? addOwnedBook(draft) : updateOwnedBook(current.uid, draft)
      if (uid !== '') pendingFocus.current = INPUT_IDS.ownedRow(uid)
    } else if (current.kind === 'extra') {
      const draft = { enchantments: result.enchantments, anvilUsesOverride: result.anvilUsesOverride ?? null }
      if (current.uid === null) pendingFocus.current = INPUT_IDS.ownedRow(addExtraItem(draft))
      else updateExtraItem(current.uid, draft)
    }
  }

  const editingBook = dialog?.kind === 'book' && dialog.uid !== null ? input.ownedBooks.find((b) => b.uid === dialog.uid) : undefined
  const editingExtra = dialog?.kind === 'extra' && dialog.uid !== null ? input.extraItems.find((x) => x.uid === dialog.uid) : undefined

  return (
    <section className={styles.panel} aria-labelledby={INPUT_IDS.heading}>
      <h2 id={INPUT_IDS.heading} className="visually-hidden">
        {t('layout.inputHeading')}
      </h2>
      <ItemCard
        edition={edition}
        levelCap={levelCap}
        item={item}
        existing={input.existing}
        override={input.anvilUsesOverride}
        readOnly={readOnly}
        redirect={redirect}
        usesWarn={usesWarn}
        usesNote={usesNote}
        onChangeItem={() => setDialog({ kind: 'item' })}
        onEditExisting={() => setDialog({ kind: 'existing' })}
      />
      <IssueNotes issues={issues.item} edition={edition} itemType={item} />
      <WantedList
        edition={edition}
        item={item}
        input={input}
        built={built}
        fallbackUsed={fallbackUsed}
        issues={issues.wanted}
        readOnly={readOnly}
        redirect={redirect}
      />
      <OwnedInventory
        edition={edition}
        item={item}
        existing={input.existing}
        books={input.ownedBooks}
        extras={input.extraItems}
        plan={plan}
        capacity={capacityLeft(estimate)}
        issues={issues.rows}
        readOnly={readOnly}
        redirect={redirect}
        onAddBook={() => setDialog({ kind: 'book', uid: null })}
        onAddExtra={() => setDialog({ kind: 'extra', uid: null })}
        onEditBook={(uid) => setDialog({ kind: 'book', uid })}
        onEditExtra={(uid) => setDialog({ kind: 'extra', uid })}
      />
      <RenameToggle checked={input.rename} readOnly={readOnly} redirect={redirect} />

      <Sheet open={dialog?.kind === 'item'} onClose={() => setDialog(null)} title={t('item.pickerTitle')}>
        <div className={styles.pickerDialog}>
          <ItemPicker edition={edition} selected={item} onSelect={onSelectItem} purpose="dialog" />
        </div>
      </Sheet>
      {dialog !== null && dialog.kind !== 'item' && (
        <EnchantmentDialog
          // Rebuilt on every open, so closing discards changes
          key={`${dialog.kind}-${dialog.kind === 'existing' ? '' : (dialog.uid ?? 'new')}`}
          open
          purpose={dialog.kind}
          editing={dialog.kind !== 'existing' && dialog.uid !== null}
          edition={edition}
          levelCap={levelCap}
          item={item}
          wanted={input.wanted}
          initial={dialog.kind === 'existing' ? input.existing : (editingBook?.enchantments ?? editingExtra?.enchantments ?? {})}
          initialCount={editingBook?.count ?? 1}
          initialOverride={editingBook?.anvilUsesOverride ?? editingExtra?.anvilUsesOverride ?? null}
          onSubmit={onDialogSubmit}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  )
}
