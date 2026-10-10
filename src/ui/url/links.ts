import { buildSettings, isInputEmpty } from '../state/convert.ts'
import type { ShareState } from '../state/slices/share.ts'
import type { InputState, SessionState } from '../state/types.ts'
import { linksEqual, type ShareLink } from './shareHash.ts'

export interface OwnInputSource {
  readonly input: InputState
  readonly session: SessionState
}

export interface ShownInputSource extends OwnInputSource {
  readonly share: ShareState
}

export function ownLinkOf(source: OwnInputSource): ShareLink | null {
  if (source.input.item === null) return null
  return { input: source.input, settings: buildSettings(source.session, source.input.rename) }
}

export function shownLinkOf(source: ShownInputSource): ShareLink | null {
  const { plan } = source.share
  if (source.share.active && plan !== null) return { input: plan.input, settings: plan.settings }
  return ownLinkOf(source)
}

export function matchesOwnInput(link: ShareLink, source: OwnInputSource): boolean {
  const own = ownLinkOf(source)
  return own !== null && linksEqual(own, link)
}

/** True when replacing the user's input loses nothing, including when nothing has been saved. */
export function isOwnInputEmpty(source: OwnInputSource): boolean {
  return isInputEmpty(source.input)
}
