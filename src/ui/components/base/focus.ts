import { focusableWithin } from './modalStack.ts'

/** For targets that may not have rendered yet, such as right after switching tabs. Gives up after `frames` frames. */
export function focusWhenReady(find: () => HTMLElement | null | undefined, frames = 20): void {
  const attempt = (left: number) => {
    const target = find()
    if (target) {
      target.focus()
      return
    }
    if (left > 0) requestAnimationFrame(() => attempt(left - 1))
  }
  requestAnimationFrame(() => attempt(frames))
}

export const INPUT_ISSUE_ATTR = 'data-input-issue'

/** Spread onto the element that shows an input issue and its fix button, for focusFirstInputIssue. */
export const INPUT_ISSUE_MARK = { [INPUT_ISSUE_ATTR]: '' } as const

/** Falls back to the first control of the enclosing card or list row. Returns whether focus moved. */
export function focusFirstInputIssue(root: ParentNode = document): boolean {
  const marked = root.querySelector<HTMLElement>(`[${INPUT_ISSUE_ATTR}]`)
  if (marked === null) return false
  marked.scrollIntoView({ block: 'center' })
  const container = marked.parentElement?.closest<HTMLElement>('li, article, fieldset') ?? null
  const target = focusableWithin(marked)[0] ?? (container === null ? undefined : focusableWithin(container)[0])
  if (target === undefined) return false
  target.focus({ preventScroll: true })
  return true
}
