import type { MouseEvent } from 'react'
import { LiveRegion } from './ui/components/base/LiveRegion.tsx'
import { ToastRegion } from './ui/components/base/Toast.tsx'
import { TooltipLayer } from './ui/components/base/TooltipLayer.tsx'
import { BlockPanel } from './ui/features/blocks/BlockPanel.tsx'
import { BLOCKS_UI } from './ui/features/blocks/mode.ts'
import { InputPanel } from './ui/features/input/index.tsx'
import { ResultBar, ResultPanel } from './ui/features/result/index.tsx'
import { ShareRoot } from './ui/features/share/index.tsx'
import {
  AboutDialog,
  AppHeader,
  BannerArea,
  Footer,
  KeyboardHelpDialog,
  SettingsSheet,
  useDocumentPrefs,
  useGlobalShortcuts,
  WorkbenchLayout,
} from './ui/features/shell/index.ts'
import { useT } from './ui/i18n/useT.ts'
import { useSolveView } from './ui/solver/useSolveResult.ts'
import { useAppStore } from './ui/state/store.ts'
import layout from './ui/styles/layout.module.css'

// Not a plain anchor jump, which would replace the hash that share links live in.
function skipToResults(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault()
  const heading = document.getElementById('results')
  heading?.focus()
  heading?.scrollIntoView({ block: 'start' })
}

// Kept apart so that each announcement re-renders only this component, not all of App.
function Announcers() {
  const { text } = useT()
  const announcement = useSolveView((view) => view.announcement)
  const assist = useAppStore((s) => s.ui.assist)
  return (
    <>
      <LiveRegion id="result-announcer" text={announcement === null ? null : text(announcement.text)} seq={announcement?.seq ?? 0} />
      <LiveRegion id="assist-announcer" text={assist.text === null ? null : text(assist.text)} seq={assist.seq} />
    </>
  )
}

export default function App() {
  useDocumentPrefs()
  useGlobalShortcuts()
  const { t } = useT()
  // Before an item is chosen, the item list takes the full width (but not while viewing a shared plan).
  const first = useAppStore((s) => !BLOCKS_UI && s.input.item === null && !s.share.active)

  return (
    <>
      {!first && (
        <a href="#results" className={layout.skip} onClick={skipToResults}>
          {t('skip.toSteps')}
        </a>
      )}
      <AppHeader />
      <BannerArea />
      <WorkbenchLayout
        first={first}
        left={
          <>{BLOCKS_UI ? <BlockPanel /> : <InputPanel />}</>
        }
        center={<ResultPanel />}
        footer={<Footer />}
      />
      <ResultBar />
      <SettingsSheet />
      <AboutDialog />
      <KeyboardHelpDialog />
      <ShareRoot />
      <ToastRegion />
      <TooltipLayer />
      <Announcers />
    </>
  )
}
