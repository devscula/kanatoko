import { GAME_DATA } from '../../../data/gameData.generated.ts'
import type { Settings } from '../../../engine/index.ts'
import { NAME_LEVEL_SPACE, type Translator } from '../../i18n/render.ts'
import { gameModeName, objectiveName } from '../../i18n/settingNames.ts'
import { editionText, enchText, itemText, listText, msg, type Text } from '../../i18n/text.ts'
import type { DisplayPlan, DisplayStep } from '../../plan/displayPlan.ts'

export interface PlanTextContext {
  readonly settings: Settings
  /** The last line is left out when null */
  readonly url: string | null
}

export const planItem = (plan: DisplayPlan): Text => itemText(plan.targetItem ?? 'enchanted_book')

const counted = (label: Text, count: number): Text => (count > 1 ? msg('text.count', { label, n: count }) : label)

export function prepLines(plan: DisplayPlan): Text[] {
  const lines: Text[] = []
  if (plan.getBooks.length > 0) {
    const list = plan.getBooks.map((book) => msg('label.book', { list: enchText(book.id, book.level) }))
    lines.push(msg('text.getBooks', { list: listText(list) }))
  }
  if (plan.ownedUsed.length > 0) {
    lines.push(msg('text.fromOwned', { list: listText(plan.ownedUsed.map((entry) => entry.label)) }))
  }
  if (plan.ownedUnused.length > 0) {
    lines.push(msg('text.unused', { list: listText(plan.ownedUnused.map((entry) => counted(entry.label, entry.count))) }))
  }
  return lines
}

function stepLine(plan: DisplayPlan, step: DisplayStep, isLast: boolean): Text {
  const c = step.cost.total
  // In the target section the left slot always holds the same item, so its plain name is enough
  const left = step.section === 'target' && plan.targetItem !== null ? itemText(plan.targetItem) : step.left.label
  let line: Text
  if (step.right === null) line = msg('text.stepRename', { n: step.no, left, c })
  else if (step.section === 'materials') {
    line = msg('text.stepMake', { n: step.no, left, right: step.right.label, result: step.result.label, c })
  } else line = msg('text.stepApply', { n: step.no, left, right: step.right.label, c })

  const notes: Text[] = []
  if (step.renameHere) notes.push(msg('text.renameHere'))
  if (step.tooExpensive) notes.push(msg('text.overCap'))
  if (isLast) notes.push(msg('text.final'))
  return notes.length === 0 ? line : msg('text.withNotes', { line, notes: listText(notes) })
}

export function formatPlanText(plan: DisplayPlan, t: Translator, context: PlanTextContext): string {
  const { settings, url } = context
  const lines: Text[] = [
    msg('text.header', {
      item: planItem(plan),
      edition: editionText(settings.edition),
      version: GAME_DATA.version[settings.edition],
      mode: gameModeName(settings.levelCap),
      objective: objectiveName(settings.objective),
    }),
    msg('text.totals', { t: plan.summary.totalLevels, m: plan.summary.maxStepLevels, k: plan.steps.length }),
  ]

  lines.push(...prepLines(plan))

  const last = plan.steps.at(-1)
  for (const step of plan.steps) lines.push(stepLine(plan, step, step === last))

  if (url !== null) lines.push(msg('text.open', { url }))
  // The no-break space between an enchantment name and its level is for the screen; pasted text is easier to handle
  // with a plain space
  return lines.map((line) => t.text(line).replaceAll(NAME_LEVEL_SPACE, ' ')).join('\n')
}
