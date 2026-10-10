// The failure screen avoids the store and useT, since either may be what broke, and takes the language from <html lang>.
// Reset backs up and clears the saved input and drops the share hash, so the same input or link cannot fail again.

import type { ErrorInfo, ReactNode } from 'react'
import { ErrorBoundary } from '../../components/base/ErrorBoundary.tsx'
import { createTranslator } from '../../i18n/render.ts'
import { clearStoredInput } from '../../state/persistIo.ts'
import { selectDoc } from '../../state/slices/history.ts'
import type { SafeStorage } from '../../state/storage.ts'
import { getAppStore } from '../../state/store.ts'
import { DEFAULT_INPUT, type InputDoc } from '../../state/types.ts'
import styles from './AppErrorBoundary.module.css'

/** Tests pass their own to avoid a real reload. */
export type Reloader = () => void

function reloadWithoutHash(): void {
  const { pathname, search, hash } = window.location
  if (hash === '') window.location.reload()
  else window.location.replace(`${pathname}${search}`)
}

/** null when the store itself is broken */
function currentDoc(): InputDoc | null {
  try {
    return selectDoc(getAppStore().getState())
  } catch {
    return null
  }
}

function resetInputAndReload(storage: SafeStorage, reload: Reloader = reloadWithoutHash): void {
  clearStoredInput(storage, currentDoc())
  try {
    // Pending saves may be flushed on unload, so make sure they write the empty input.
    getAppStore().setState({ input: DEFAULT_INPUT })
  } catch {
    // The saved input is already cleared, so the reload starts empty anyway.
  }
  reload()
}

function AppFailure({ storage, reload }: { readonly storage: SafeStorage; readonly reload?: Reloader }) {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'ja'
  const { t } = createTranslator({ lang, edition: 'java' })
  return (
    <main className={styles.failure}>
      <div className={styles.inner} role="alert">
        <p className={styles.app}>{t('app.name')}</p>
        <h1 className={styles.title}>{t('error.renderFailed')}</h1>
        <p className={styles.note}>{t('error.renderFailedNote')}</p>
        <button type="button" className={styles.button} onClick={() => resetInputAndReload(storage, reload)}>
          {t('error.resetAndReload')}
        </button>
      </div>
    </main>
  )
}

function logRenderError(error: unknown, info: ErrorInfo): void {
  console.error('Rendering failed', error, info.componentStack)
}

export interface AppErrorBoundaryProps {
  readonly storage: SafeStorage
  readonly children: ReactNode
  readonly reload?: Reloader
}

export function AppErrorBoundary({ storage, children, reload }: AppErrorBoundaryProps) {
  return (
    <ErrorBoundary fallback={<AppFailure storage={storage} reload={reload} />} onError={logRenderError}>
      {children}
    </ErrorBoundary>
  )
}
