import { focusableWithin } from '../../components/base/modalStack.ts'
import { INPUT_IDS } from '../input/ids.ts'

export const INPUT_COLUMN_ID = 'input-column'

export function inputColumn(): HTMLElement | null {
  return document.getElementById(INPUT_COLUMN_ID)
}

export function focusInputColumn(): void {
  requestAnimationFrame(() => {
    const column = inputColumn()
    if (column === null) return
    const first = focusableWithin(column)[0]
    if (first === undefined) return
    first.scrollIntoView({ block: 'nearest' })
    first.focus({ preventScroll: true })
  })
}

/** Opens the item picker by pressing the item row's first button. */
export function openItemChange(): void {
  requestAnimationFrame(() => {
    const card = document.getElementById(INPUT_IDS.itemCard)
    const button = card?.querySelector<HTMLElement>('button') ?? card?.parentElement?.querySelector<HTMLElement>('button') ?? null
    if (button !== null) button.click()
    else focusInputColumn()
  })
}
