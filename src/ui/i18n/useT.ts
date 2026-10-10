import { useMemo } from 'react'
import { selectActiveEdition } from '../state/selectors.ts'
import { useAppStore } from '../state/store.ts'
import { createTranslator, type Translator } from './render.ts'

export function useT(): Translator {
  const lang = useAppStore((s) => s.prefs.lang)
  const edition = useAppStore(selectActiveEdition)
  return useMemo(() => createTranslator({ lang, edition }), [lang, edition])
}
