import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { initShare } from './ui/features/share/index.tsx'
import { AppErrorBoundary } from './ui/features/shell/AppErrorBoundary.tsx'
import { applyPrefsToDocument } from './ui/features/shell/documentPrefs.ts'
import { startSolver } from './ui/solver/useSolveResult.ts'
import { loadInitialState, startPersistence } from './ui/state/persistence.ts'
import { browserStorage, wrapStorage } from './ui/state/storage.ts'
import { createAppStore, setAppStore } from './ui/state/store.ts'
import './ui/styles/index.css'

const storage = wrapStorage(browserStorage())
const { initial } = loadInitialState(storage)
const store = createAppStore({ storage }, initial)
setAppStore(store)
applyPrefsToDocument(store.getState().prefs)
startPersistence(store, storage)
initShare(store)
startSolver(store)

const root = document.getElementById('root')
if (root === null) throw new Error('#root is missing in index.html')

createRoot(root, {
  onUncaughtError: (error, info) => console.error('Uncaught render error', error, info.componentStack),
}).render(
  <StrictMode>
    <AppErrorBoundary storage={storage}>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
