import { useEffect } from 'react'
import { createTranslator } from '../../i18n/render.ts'
import { useAppStore } from '../../state/store.ts'
import type { PrefsState } from '../../state/types.ts'

/** Also called at startup, before the first render. */
export function applyPrefsToDocument(prefs: PrefsState): void {
  const root = document.documentElement
  root.lang = prefs.lang
  // auto sets no attribute, so the CSS follows the OS setting.
  if (prefs.theme === 'auto') delete root.dataset.theme
  else root.dataset.theme = prefs.theme
  if (prefs.motion === 'auto') delete root.dataset.motion
  else root.dataset.motion = prefs.motion
  const t = createTranslator({ lang: prefs.lang, edition: 'java' })
  document.title = t.t('app.name')
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (meta === null) {
    meta = document.createElement('meta')
    meta.name = 'description'
    document.head.append(meta)
  }
  meta.content = t.t('app.description')
}

export function useDocumentPrefs(): void {
  const prefs = useAppStore((s) => s.prefs)
  useEffect(() => applyPrefsToDocument(prefs), [prefs])
}
