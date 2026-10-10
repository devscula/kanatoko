import { itemText, msg, type Text } from '../../i18n/text.ts'
import type { DisplayPlan, DisplayStep, SlotView } from '../../plan/displayPlan.ts'

/** Whether the step applies an input book, not a merged one, to the target item */
export function appliesPlainBook(step: DisplayStep): boolean {
  const right = step.right
  return step.section === 'target' && right !== null && right.letter === null && right.item === 'enchanted_book' && right.source !== null
}

export function rowTitle(plan: DisplayPlan, step: DisplayStep): Text {
  if (plan.targetItem !== null && appliesPlainBook(step)) {
    return msg('title.apply', { item: itemText(plan.targetItem), right: msg('label.bookPlain') })
  }
  return step.title
}

export function rowContent(step: DisplayStep, lang: 'ja' | 'en', render: (value: Text) => string): string {
  if (step.right === null) return render(step.left.fullLabel)
  if (step.section === 'materials') {
    const part = (slot: SlotView) => render(slot.detail ?? slot.label)
    return `${part(step.left)}${lang === 'ja' ? ' ＋ ' : ' + '}${part(step.right)}`
  }
  return render(step.right.fullLabel)
}

