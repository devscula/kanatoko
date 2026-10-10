// Mount it at page load: screen readers only announce changes to a live region that already exists. data-modal-exempt
// keeps modalStack.ts from making it inert while a sheet is open.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export interface LiveRegionProps {
  readonly text: string | null
  /** Bump to announce again even when the text is unchanged */
  readonly seq: number
  readonly id?: string
}

// Clearing first and refilling a moment later makes screen readers announce a repeated text.
const REFILL_DELAY_MS = 50

export function LiveRegion({ text, seq, id }: LiveRegionProps) {
  const [content, setContent] = useState('')
  useEffect(() => {
    const clear = setTimeout(() => setContent(''), 0)
    const fill = text === null ? null : setTimeout(() => setContent(text), REFILL_DELAY_MS)
    return () => {
      clearTimeout(clear)
      if (fill !== null) clearTimeout(fill)
    }
  }, [text, seq])
  return createPortal(
    <div id={id} role="status" aria-live="polite" aria-atomic="true" className="visually-hidden" data-modal-exempt="">
      {content}
    </div>,
    document.body,
  )
}
