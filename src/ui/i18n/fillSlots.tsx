import { Fragment, type ReactNode } from 'react'

/** A Private Use Area character, which never appears in messages or game names */
export const SLOT_MARK = ''

/**
 * Puts elements into message parameters: build the message with t(key, { name: SLOT_MARK }) and pass the elements here.
 * Word order stays in the message and only the values become elements, such as the number in "Step {n}".
 */
export function fillSlots(text: string, nodes: readonly ReactNode[]): ReactNode {
  const parts = text.split(SLOT_MARK)
  if (parts.length === 1) return text
  return parts.map((part, index) => (
    // The message fixes the order, so index keys are stable
    <Fragment key={index}>
      {index > 0 && nodes[index - 1]}
      {part}
    </Fragment>
  ))
}

export function fillSlot(text: string, node: ReactNode): ReactNode {
  return fillSlots(text, [node])
}
