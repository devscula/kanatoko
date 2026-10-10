import type { Problem } from '../../../engine/index.ts'
import type { Translator } from '../../i18n/render.ts'
import { editionText, itemText, msg } from '../../i18n/text.ts'
import type { DisplayPlan } from '../../plan/displayPlan.ts'
import { buildSettings } from '../../state/convert.ts'
import type { ShareState } from '../../state/slices/share.ts'
import { getAppStore } from '../../state/store.ts'
import { shownLinkOf } from '../../url/links.ts'
import { canonicalHash, encodeShareHash, isShareHash, linksEqual, shareUrl, type ShareLink } from '../../url/shareHash.ts'
import { copyToClipboard } from './clipboard.ts'
import { formatPlanText, type PlanTextContext } from './formatPlanText.ts'
import { shareWithWebShare } from './webShare.ts'

export interface SharePlanView {
  readonly plan: DisplayPlan
  readonly link: ShareLink
  /** For the assumptions line in print */
  readonly problem: Problem
}

// Sharing an opened shared plan again passes on the received hash unchanged
export function sharedHashFor(link: ShareLink, share: ShareState): string | null {
  const plan = share.active ? share.plan : null
  return plan !== null && linksEqual(link, plan) ? canonicalHash(plan.hash) : null
}

export async function resolveShareUrl(link: ShareLink, share: ShareState = getAppStore().getState().share): Promise<string> {
  return shareUrl(sharedHashFor(link, share) ?? (await encodeShareHash(link)))
}

/** Without context, uses the settings of the shown plan and the share link in the address bar */
export function formatPlanAsText(plan: DisplayPlan, t: Translator, context?: PlanTextContext): string {
  return formatPlanText(plan, t, context ?? currentTextContext())
}

function currentTextContext(): PlanTextContext {
  const state = getAppStore().getState()
  const settings = shownLinkOf(state)?.settings ?? buildSettings(state.session, false)
  const hash = typeof window === 'undefined' ? '' : canonicalHash(window.location.hash)
  return { settings, url: isShareHash(hash) ? shareUrl(hash) : null }
}

/** Pass url when it is already built, so the share call follows the user's click without waiting */
export async function shareLink(link: ShareLink, view: SharePlanView | null, t: Translator, url: string | null): Promise<void> {
  const target = url ?? (await resolveShareUrl(link))
  // The summary line goes along only when the shared plan has an ok result
  const summary = view !== null && linksEqual(view.link, link) ? view.plan.summary : null
  const outcome = await shareWithWebShare({
    title: t.t('share.title', { item: itemText(link.input.item ?? 'enchanted_book') }),
    text:
      summary === null
        ? undefined
        : t.t('share.text', {
            t: summary.totalLevels,
            m: summary.maxStepLevels,
            k: summary.anvilOperations,
            edition: editionText(link.settings.edition),
          }),
    url: target,
  })
  if (outcome === 'unavailable' || outcome === 'failed') getAppStore().getState().openShareSheet()
}

export async function copyPlanText(view: SharePlanView, t: Translator, url: string | null): Promise<void> {
  const text = formatPlanText(view.plan, t, { settings: view.link.settings, url: url ?? (await resolveShareUrl(view.link)) })
  const store = getAppStore().getState()
  if (await copyToClipboard(text)) store.showToast(msg('toast.copied'))
  else store.openShareSheet({ manualText: text })
}
