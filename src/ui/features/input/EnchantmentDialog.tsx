import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { maxLevel } from '../../../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../../../data/types.ts'
import { defaultAnvilUses, LIMITS } from '../../../engine/index.ts'
import type { EnchantLevels } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { Sheet } from '../../components/base/Sheet.tsx'
import { Stepper } from '../../components/base/Stepper.tsx'
import { enchText, itemText, listText, msg, type Text } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { ItemImage } from '../../icons/ItemImage.tsx'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { isBookTarget } from '../../state/convert.ts'
import { useAppStore } from '../../state/store.ts'
import type { AnvilUsesOverride } from '../../state/types.ts'
import { isSingleKeyAllowed } from '../shell/shortcuts.ts'
import { AnvilUsesField } from './AnvilUsesField.tsx'
import styles from './EnchantmentDialog.module.css'
import { deselectEnchantment, pickerCandidates, searchEnchantments, selectEnchantment } from './model.ts'
import { PickerList, ROW_ATTRIBUTE } from './PickerList.tsx'
import { SearchField } from './SearchField.tsx'
import { SummaryDisclosure } from './SummaryDisclosure.tsx'

export type EnchantmentDialogPurpose = 'book' | 'existing' | 'extra'

export interface EnchantmentDialogResult {
  readonly enchantments: EnchantLevels
  /** Only for book. */
  readonly count?: number
  /** Only for book and extra. */
  readonly anvilUsesOverride?: AnvilUsesOverride | null
}

export interface EnchantmentDialogProps {
  readonly open: boolean
  readonly purpose: EnchantmentDialogPurpose
  readonly editing?: boolean
  readonly edition: Edition
  readonly levelCap: 39 | null
  /** With 'enchanted_book', purpose is always 'book'. */
  readonly item: ItemTypeId
  /** Listed first when purpose is 'book'. */
  readonly wanted: EnchantLevels
  readonly initial: EnchantLevels
  readonly initialCount?: number
  readonly initialOverride?: AnvilUsesOverride | null
  readonly focusEnchantment?: EnchantmentId
  onSubmit(result: EnchantmentDialogResult): void
  onClose(): void
}

export function EnchantmentDialog({
  open,
  purpose,
  editing = false,
  edition,
  levelCap,
  item,
  wanted,
  initial,
  initialCount = 1,
  initialOverride = null,
  focusEnchantment,
  onSubmit,
  onClose,
}: EnchantmentDialogProps) {
  const { t, text } = useT()
  const showToast = useAppStore((s) => s.showToast)
  const searchId = useId()
  const emptyId = useId()
  const countLabelId = useId()
  const usesId = useId()
  const [draft, setDraft] = useState<EnchantLevels>(initial)
  const [count, setCount] = useState(initialCount)
  const [override, setOverride] = useState<AnvilUsesOverride | null>(initialOverride)
  const [usesOpen, setUsesOpen] = useState(false)
  const [query, setQuery] = useState('')

  const book = isBookTarget(item)
  const itemType = book ? null : item
  const candidates = useMemo(
    () => pickerCandidates(purpose === 'book' ? 'book' : 'targetEnchantments', edition, itemType),
    [purpose, edition, itemType],
  )
  const matches = useMemo(() => (query.trim() === '' ? null : searchEnchantments(query, candidates.all)), [query, candidates])
  const empty = Object.keys(draft).length === 0
  const blocked = empty && purpose !== 'existing'
  const autoValue = purpose === 'book' ? defaultAnvilUses(edition, null, draft) : defaultAnvilUses(edition, itemType, draft)
  const usesValue = override ?? autoValue
  const usesSummary = override === null ? t('uses.summary.auto', { n: autoValue }) : t('uses.summary.entered', { n: usesValue })

  const select = (id: EnchantmentId, level: number) => {
    const before = draft
    const { next, replaced } = selectEnchantment(draft, id, level, edition)
    setDraft(next)
    if (replaced.length > 0) {
      showToast(msg('toast.conflictReplaced', { list: listText(replaced.map((r) => enchText(r))) }), {
        actions: [{ label: msg('toast.undo'), run: () => setDraft(before) }],
      })
    }
  }

  const submit = () => {
    if (blocked) return
    if (purpose === 'book') onSubmit({ enchantments: draft, count, anvilUsesOverride: override })
    else if (purpose === 'extra') onSubmit({ enchantments: draft, anvilUsesOverride: override })
    else onSubmit({ enchantments: draft })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.id === searchId && matches?.length === 1) {
      event.preventDefault()
      select(matches[0], maxLevel(matches[0]))
      return
    }
    if (event.key !== '/' || !isSingleKeyAllowed(event.nativeEvent)) return
    event.preventDefault()
    document.getElementById(searchId)?.focus()
  }

  const title: Text =
    purpose === 'book'
      ? msg(editing ? 'picker.titleBookEdit' : 'picker.titleBook')
      : purpose === 'extra'
        ? msg(editing ? 'composer.titleSpareEdit' : 'composer.titleSpare', { item: itemText(item) })
        : msg('existing.dialogTitle', { item: itemText(item) })
  const submitLabel: Text =
    editing || purpose === 'existing'
      ? msg('picker.submitEdit')
      : purpose === 'book'
        ? msg('picker.submitBook')
        : msg('composer.submitSpare', { item: itemText(item) })
  const titleIcon =
    purpose === 'book' ? (
      <ItemImage item="enchanted_book" size={32} enchanted />
    ) : (
      <ItemImage item={item} size={32} enchanted={purpose === 'existing'} />
    )
  const submitIcon =
    purpose === 'existing' || editing ? null : (
      <span className={styles.plusImage} aria-hidden="true">
        <ItemImage item={purpose === 'book' ? 'enchanted_book' : item} size={32} enchanted={purpose === 'book'} />
        <PixelIcon name="plus" size={16} className={styles.plusMark} />
      </span>
    )

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span className={styles.titleWithIcon}>
          {titleIcon}
          {text(title)}
        </span>
      }
      initialFocus={
        focusEnchantment === undefined
          ? undefined
          : () => document.querySelector<HTMLElement>(`[${ROW_ATTRIBUTE}="${focusEnchantment}"] input`)
      }
      footer={
        <div className={styles.footer}>
          {blocked && (
            <p id={emptyId} className={styles.empty}>
              {t('picker.empty')}
            </p>
          )}
          {purpose === 'existing' && <p className={styles.empty}>{t('existing.clearHint')}</p>}
          <div className={styles.actions}>
            <Button className={styles.cancel} onClick={onClose}>
              {t('composer.cancel')}
            </Button>
            <Button variant="primary" disabled={blocked} aria-describedby={blocked ? emptyId : undefined} onClick={submit}>
              <span className={styles.submitContent}>
                {submitIcon}
                {text(submitLabel)}
              </span>
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.body} onKeyDown={onKeyDown}>
        <SearchField
          id={searchId}
          label={t('enchant.search')}
          value={query}
          onChange={setQuery}
          resultCount={matches === null ? null : matches.length}
        />
        <PickerList
          edition={edition}
          itemType={itemType}
          candidates={candidates}
          matches={matches}
          value={draft}
          wanted={purpose === 'book' && !book ? wanted : undefined}
          onSelect={select}
          onDeselect={(id) => setDraft(deselectEnchantment(draft, id))}
        />
        {purpose !== 'existing' && (
          <div className={styles.bookFields}>
            {purpose === 'book' && (
            <div className={styles.countRow}>
              <span id={countLabelId} className={styles.countLabel}>
                <PixelIcon name="stack" size={16} /> {t('adv.count')}
              </span>
              <Stepper
                value={count}
                min={1}
                max={LIMITS.maxStackCount}
                onChange={setCount}
                labelledBy={countLabelId}
                valueText={t('adv.countValue', { n: count })}
                decrementLabel={t('adv.countDec')}
                incrementLabel={t('adv.countInc')}
              />
            </div>
            )}
            <SummaryDisclosure
              id={usesId}
              icon="pwp"
              label={t('uses.title')}
              value={usesSummary}
              actionLabel={t('uses.change')}
              expanded={usesOpen}
              onToggle={() => setUsesOpen(!usesOpen)}
            >
              <AnvilUsesField
                context={purpose === 'book' ? 'book' : 'extra'}
                edition={edition}
                levelCap={levelCap}
                itemType={purpose === 'book' ? null : itemType}
                enchantments={draft}
                autoValue={autoValue}
                override={override}
                onChange={(next) => setOverride(next)}
              />
            </SummaryDisclosure>
          </div>
        )}
      </div>
    </Sheet>
  )
}
