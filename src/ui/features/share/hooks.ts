import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useDisplayPlan } from '../../plan/useDisplayPlan.ts'
import { useSolveView } from '../../solver/useSolveResult.ts'
import { pickSource } from '../../state/selectors.ts'
import { useAppStore } from '../../state/store.ts'
import { shownLinkOf } from '../../url/links.ts'
import { encodeShareHash, shareUrl, type ShareLink } from '../../url/shareHash.ts'
import { sharedHashFor, type SharePlanView } from './sharing.ts'

export function useSharePlan(): SharePlanView | null {
  const outcome = useSolveView((view) => view.outcome)
  const { plan } = useDisplayPlan(outcome)
  return useMemo(() => {
    if (plan === null || outcome?.kind !== 'result') return null
    return { plan, link: { input: outcome.input, settings: outcome.settings }, problem: outcome.problem }
  }, [plan, outcome])
}

/** The shared plan while one is shown, otherwise the user's own input; null when no item is chosen */
export function useShownLink(): ShareLink | null {
  const source = useAppStore(useShallow(pickSource))
  return useMemo(() => shownLinkOf(source), [source])
}

/** Null until the link is compressed. Pass a memoized link, since the result is matched to it by identity. */
export function useShareUrl(link: ShareLink | null): string | null {
  const share = useAppStore((s) => s.share)
  const fixed = useMemo(() => (link === null ? null : sharedHashFor(link, share)), [link, share])
  const [encoded, setEncoded] = useState<{ readonly link: ShareLink; readonly url: string } | null>(null)

  useEffect(() => {
    if (link === null || fixed !== null) return
    let current = true
    void encodeShareHash(link).then((hash) => {
      if (current) setEncoded({ link, url: shareUrl(hash) })
    })
    return () => {
      current = false
    }
  }, [link, fixed])

  if (link === null) return null
  if (fixed !== null) return shareUrl(fixed)
  return encoded !== null && encoded.link === link ? encoded.url : null
}
