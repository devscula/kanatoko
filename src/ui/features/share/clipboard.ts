export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // No permission or not a secure context: fall back to the older way
  }
  return copyWithSelection(text)
}

// For contexts without the Clipboard API, such as a page served over http
function copyWithSelection(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const previous = document.activeElement
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.style.position = 'fixed'
  area.style.inset = '0 auto auto 0'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
  return ok
}
