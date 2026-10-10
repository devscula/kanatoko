// The logo is the favicon file itself, so the tab and the header always show the same picture.

import type { Lang } from '../../../data/types.ts'
import { Button, IconButton } from '../../components/base/Button.tsx'
import { SegmentedControl } from '../../components/base/SegmentedControl.tsx'
import { MEDIA, useMediaQuery } from '../../components/base/useMediaQuery.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { selectRedoLabel, selectUndoLabel } from '../../state/selectors.ts'
import { useAppStore } from '../../state/store.ts'
import styles from './AppHeader.module.css'
import { EditionSwitch } from './EditionSwitch.tsx'

export function AppHeader() {
  const { t } = useT()
  const wide = useMediaQuery(MEDIA.cols2)
  const lang = useAppStore((s) => s.prefs.lang)
  const setLang = useAppStore((s) => s.setLang)
  const undoLabel = useAppStore(selectUndoLabel)
  const redoLabel = useAppStore(selectRedoLabel)
  const readOnly = useAppStore((s) => s.share.active)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)
  const openSettings = useAppStore((s) => s.openSettings)
  const openKeys = useAppStore((s) => s.openKeys)
  const full = useMediaQuery('(min-width: 1440px)')

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <h1 className={styles.brand}>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} width={32} height={32} alt="" className={styles.logo} />
          <span className={styles.name}>{t('app.name')}</span>
        </h1>
        <div className={styles.controls}>
          {wide ? (
            <>
              <EditionSwitch form="segmented" />
              {full && (
                <span className={styles.lang}>
                  <PixelIcon name="language" size={16} />
                  <SegmentedControl<Lang>
                    options={[
                      { value: 'ja', label: t('lang.ja'), lang: 'ja' },
                      { value: 'en', label: t('lang.en'), lang: 'en' },
                    ]}
                    value={lang}
                    onChange={setLang}
                    label={t('settings.language')}
                  />
                </span>
              )}
              <div className={styles.history}>
                {full ? (
                  <>
                    <Button
                      variant="ghost"
                      icon="undo"
                      disabled={undoLabel === null || readOnly}
                      title={undoLabel === null ? undefined : t('settings.undoWith', { action: undoLabel })}
                      aria-label={undoLabel === null ? undefined : t('settings.undoWith', { action: undoLabel })}
                      onClick={undo}
                      className={styles.historyButton}
                    >
                      {t('header.undo')}
                    </Button>
                    <Button
                      variant="ghost"
                      icon="redo"
                      disabled={redoLabel === null || readOnly}
                      title={redoLabel === null ? undefined : t('settings.redoWith', { action: redoLabel })}
                      aria-label={redoLabel === null ? undefined : t('settings.redoWith', { action: redoLabel })}
                      onClick={redo}
                      className={styles.historyButton}
                    >
                      {t('header.redo')}
                    </Button>
                    <Button variant="ghost" icon="keyboard" onClick={openKeys} className={styles.historyButton}>
                      {t('header.keyboard')}
                    </Button>
                  </>
                ) : (
                  // Accessible names use the same words as the labeled buttons
                  <>
                    <IconButton
                      icon="undo"
                      variant="ghost"
                      label={undoLabel === null ? t('header.undo') : t('settings.undoWith', { action: undoLabel })}
                      disabled={undoLabel === null || readOnly}
                      onClick={undo}
                    />
                    <IconButton
                      icon="redo"
                      variant="ghost"
                      label={redoLabel === null ? t('header.redo') : t('settings.redoWith', { action: redoLabel })}
                      disabled={redoLabel === null || readOnly}
                      onClick={redo}
                    />
                    <IconButton icon="keyboard" variant="ghost" label={t('header.keyboard')} onClick={openKeys} />
                  </>
                )}
              </div>
              <Button variant="secondary" icon="gear" onClick={() => openSettings()}>
                {t('header.settings')}
              </Button>
            </>
          ) : (
            <>
              <EditionSwitch form="select" />
              <IconButton icon="gear" label={t('header.settings')} onClick={() => openSettings()} />
            </>
          )}
        </div>
      </div>
    </header>
  )
}
