export interface WebShareData {
  readonly title: string
  readonly text?: string
  readonly url: string
}

export type WebShareOutcome =
  | 'shared'
  | 'cancelled'
  | 'unavailable'
  | 'failed'

export async function shareWithWebShare(data: WebShareData): Promise<WebShareOutcome> {
  if (typeof navigator === 'undefined') return 'unavailable'
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return 'unavailable'
  try {
    if (!navigator.canShare({ url: data.url })) return 'unavailable'
    await navigator.share({ title: data.title, url: data.url, ...(data.text === undefined ? {} : { text: data.text }) })
    return 'shared'
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}
