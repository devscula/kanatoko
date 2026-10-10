import type { ItemTypeId } from '../../../data/types.ts'
import type { DiscardedEnchantment, EnchantLevels, Warning } from '../../../engine/index.ts'
import { enchText, itemText, listText, msg, type Text } from '../../i18n/text.ts'

export interface SummaryNoticeAction {
  readonly label: Text
  readonly run: () => void
}

export interface SummaryNotice {
  readonly id: string
  readonly text: Text
  readonly more?: Text
  readonly actions: readonly SummaryNoticeAction[]
}

export interface SummaryActions {
  onKeep(enchantments: EnchantLevels): void
  onChooseItem(): void
}
const discardedText = (items: readonly DiscardedEnchantment[]): Text =>
  listText(items.map((item) => enchText(item.id, item.inputLevel)))

export interface SummaryNoticeContext {
  /** Null when only books are involved */
  readonly itemType: ItemTypeId | null
}

export function summaryNotices(warnings: readonly Warning[], context: SummaryNoticeContext, actions: SummaryActions): SummaryNotice[] {
  const notices: SummaryNotice[] = []
  for (const warning of warnings) {
    switch (warning.code) {
      case 'enchantments-discarded': {
        const inapplicable = warning.items.filter((item) => item.reason === 'inapplicable')
        const conflict = warning.items.filter((item) => item.reason === 'conflict')
        if (inapplicable.length > 0) {
          notices.push({
            id: `${warning.code}-inapplicable`,
            text: msg('warning.discarded.inapplicable', {
              list: discardedText(inapplicable),
              item: itemText(context.itemType ?? 'enchanted_book'),
            }),
            actions: [],
          })
        }
        if (conflict.length > 0) {
          // keep is set only when the engine confirmed that keeping them works and costs more, which is the only time
          // the notice can say they were left off to lower the total
          const keep = warning.keep
          notices.push(
            keep === null
              ? { id: `${warning.code}-conflict`, text: msg('warning.discarded.conflict', { list: discardedText(conflict) }), actions: [] }
              : {
                  id: `${warning.code}-conflict`,
                  text: msg('warning.discarded', { list: discardedText(conflict) }),
                  more: msg('warning.discarded.keep', { t: keep.totalLevels }),
                  actions: [{ label: msg('warning.keepButton'), run: () => actions.onKeep(keep.enchantments) }],
                },
          )
        }
        break
      }
      // The goal is always the wanted enchantments, so the other warnings need no notice
      default:
        break
    }
  }
  return notices
}
