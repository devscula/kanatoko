// Only elements marked here are restored, so that inert set by other code is left alone. data-modal-exempt elements (the
// toasts) are never made inert, so that an undo toast stays usable above a sheet.

const MARK = 'data-modal-inert'
const stack: HTMLElement[] = []

// Detached entries do not count. Closing an outer modal detaches a sheet open inside it in the same render, and the outer
// cleanup, which returns focus to its opener, runs first; taking the detached sheet as the top would leave the
// background inert and lose that focus.
function topEntry(): HTMLElement | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].isConnected) return stack[i]
    stack.splice(i, 1)
  }
  return undefined
}

function apply(): void {
  const top = topEntry()
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue
    const exempt = child.hasAttribute('data-modal-exempt')
    const shouldBeInert = top !== undefined && !exempt && child !== top && !child.contains(top)
    if (shouldBeInert && !child.inert) {
      child.inert = true
      child.setAttribute('inert', '')
      child.setAttribute(MARK, '')
    } else if (!shouldBeInert && child.hasAttribute(MARK)) {
      child.inert = false
      child.removeAttribute('inert')
      child.removeAttribute(MARK)
    }
  }
}

export function pushModal(container: HTMLElement): () => void {
  stack.push(container)
  apply()
  return () => {
    const index = stack.lastIndexOf(container)
    if (index >= 0) stack.splice(index, 1)
    apply()
  }
}

export function isTopModal(container: HTMLElement): boolean {
  return topEntry() === container
}

export function topModal(): HTMLElement | null {
  return topEntry() ?? null
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// Assumes rendered where checkVisibility is missing, as in jsdom.
function isRendered(el: HTMLElement): boolean {
  return typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })
}

/**
 * Tab stops in DOM order. As in the browser, radio buttons sharing a name count once: the checked one, or the first
 * when none is checked.
 */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert], [hidden], [aria-hidden="true"]') && el.tabIndex >= 0 && isRendered(el),
  )
  const radioStop = new Map<string, HTMLInputElement>()
  for (const el of candidates) {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || el.name === '') continue
    const current = radioStop.get(el.name)
    if (current === undefined || (el.checked && !current.checked)) radioStop.set(el.name, el)
  }
  return candidates.filter((el) => !(el instanceof HTMLInputElement && el.type === 'radio' && el.name !== '') || radioStop.get(el.name) === el)
}

export function exemptFocusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-modal-exempt]')).flatMap((region) => focusableWithin(region))
}

/**
 * Tab cycles through the modal's controls, then the toast controls, then back. When focus is outside that ring, as on a
 * heading with tabindex="-1", it moves to the next or previous control in DOM order.
 */
export function trapTab(root: HTMLElement, event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>): void {
  if (event.key !== 'Tab') return
  const inside = focusableWithin(root)
  const ring = [...inside, ...exemptFocusables()]
  event.preventDefault()
  if (ring.length === 0) return
  const active = document.activeElement
  const index = active instanceof HTMLElement ? ring.indexOf(active) : -1
  let next: HTMLElement | undefined
  if (index >= 0) {
    next = ring[(index + (event.shiftKey ? -1 : 1) + ring.length) % ring.length]
  } else if (active instanceof Node && root.contains(active)) {
    const follows = (el: HTMLElement) => (active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    next = event.shiftKey ? (inside.findLast((el) => !follows(el)) ?? ring.at(-1)) : (inside.find(follows) ?? ring[0])
  } else {
    next = event.shiftKey ? ring.at(-1) : ring[0]
  }
  next?.focus()
}
