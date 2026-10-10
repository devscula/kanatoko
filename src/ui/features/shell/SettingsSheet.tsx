import { useId, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Lang } from '../../../data/types.ts'
import type { Objective } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { ConfirmDialog } from '../../components/base/ConfirmDialog.tsx'
import { RadioList } from '../../components/base/RadioList.tsx'
import { SegmentedControl } from '../../components/base/SegmentedControl.tsx'
import { DropdownSheet as Sheet } from '../../components/base/DropdownSheet.tsx'
import { Switch } from '../../components/base/Switch.tsx'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { selectReadOnly, selectRedoLabel, selectUndoLabel } from '../../state/selectors.ts'
import { useAppStore } from '../../state/store.ts'
import type { MotionPref, ThemePref } from '../../state/types.ts'
import { EditionSwitch } from './EditionSwitch.tsx'
import styles from './SettingsSheet.module.css'

type GameMode = 'survival' | 'creative'

export function SettingsSheet() {
  const { t } = useT()
  const open = useAppStore((s) => s.ui.settingsOpen)
  const focus = useAppStore((s) => s.ui.settingsFocus)
  const close = useAppStore((s) => s.closeSettings)
  const session = useAppStore((s) => s.session)
  const prefs = useAppStore((s) => s.prefs)
  const system = useAppStore((s) => s.system)
  const readOnly = useAppStore(selectReadOnly)
  const undoLabel = useAppStore(selectUndoLabel)
  const redoLabel = useAppStore(selectRedoLabel)
  const actions = useAppStore(
    useShallow((s) => ({
    undo: s.undo,
    redo: s.redo,
    setLevelCap: s.setLevelCap,
    setObjective: s.setObjective,
    setLang: s.setLang,
    setTheme: s.setTheme,
    setMotion: s.setMotion,
    setSingleKeyShortcuts: s.setSingleKeyShortcuts,
    restoreBackup: s.restoreBackup,
    clearAllInput: s.clearAllInput,
    openAbout: s.openAbout,
    openKeys: s.openKeys,
  })),
  )
  const [confirmClear, setConfirmClear] = useState(false)
  const gameModeRef = useRef<HTMLInputElement>(null)
  const objectiveRef = useRef<HTMLInputElement>(null)
  const editionId = useId()
  const languageId = useId()
  const themeId = useId()
  const motionId = useId()
  const lockedId = useId()

  const initialFocus = (): HTMLElement | null => {
    let target: HTMLElement | null = null
    if (focus === 'gameMode') target = gameModeRef.current
    if (focus === 'objective') target = objectiveRef.current
    if (focus === 'edition') target = document.querySelector<HTMLElement>(`[id="${editionId}-control"] [aria-checked="true"]`)
    target?.scrollIntoView({ block: 'center' })
    return target
  }

  const gameMode: GameMode = session.levelCap === null ? 'creative' : 'survival'
  const tieBreakKey = {
    levels: 'settings.tieBreak.levels',
    xp: 'settings.tieBreak.xp',
    finalPwp: 'settings.tieBreak.finalPwp',
  } as const satisfies Record<Objective, string>

  return (
    <>
      <Sheet open={open} onClose={close} title={t('settings.title')} variant="side" initialFocus={initialFocus}>
        <div className={styles.sections}>
          <div className={styles.history}>
            <Button icon="undo" disabled={undoLabel === null || readOnly} onClick={actions.undo} className={styles.historyButton}>
              {undoLabel === null ? t('header.undo') : t('settings.undoWith', { action: undoLabel })}
            </Button>
            <Button icon="redo" disabled={redoLabel === null || readOnly} onClick={actions.redo} className={styles.historyButton}>
              {redoLabel === null ? t('header.redo') : t('settings.redoWith', { action: redoLabel })}
            </Button>
          </div>

          {readOnly && (
            <p id={lockedId} className={styles.locked}>
              {t('banner.shared.locked')}
            </p>
          )}

          <section className={styles.section}>
            <RadioList<GameMode>
              legend={<span className={styles.withIcon}><PixelIcon name="heart" size={16} />{t('settings.gameMode')}</span>}
              value={gameMode}
              disabled={readOnly}
              selectedRef={gameModeRef}
              onChange={(mode) => actions.setLevelCap(mode === 'creative' ? null : 39)}
              options={[
                { value: 'survival', label: <span className={styles.withIcon}><PixelIcon name="limit" size={16} />{t('settings.survival')}</span> },
                { value: 'creative', label: <span className={styles.withIcon}><PixelIcon name="infinity" size={16} />{t('settings.creative')}</span> },
              ]}
            />
          </section>

          <section className={styles.section}>
            <RadioList<Objective>
              legend={<span className={styles.withIcon}><PixelIcon name="target" size={16} />{t('settings.objective')}</span>}
              value={session.objective}
              disabled={readOnly}
              selectedRef={objectiveRef}
              onChange={(objective) => actions.setObjective(objective)}
              options={[
                { value: 'levels', label: <span className={styles.withIcon}><PixelIcon name="xp-orb" size={16} />{t('settings.objective.levels')}</span> },
                { value: 'xp', label: <span className={styles.withIcon}><PixelIcon name="xp-orb" size={16} />{t('settings.objective.xp')}</span>, note: t('settings.objective.xpNote') },
                { value: 'finalPwp', label: <span className={styles.withIcon}><PixelIcon name="pwp" size={16} />{t('settings.objective.finalPwp')}</span>, note: t('settings.objective.finalPwpNote') },
              ]}
              description={t(tieBreakKey[session.objective])}
            />
          </section>

          <section className={[styles.section, styles.choices].join(' ')}>
            <div className={styles.choice}>
              <span id={editionId} className={styles.choiceLabel}>
                <PixelIcon name="edition" size={16} />
                {t('settings.edition')}
              </span>
              <EditionSwitch form="segmented" labelledBy={editionId} id={`${editionId}-control`} />
            </div>
            <div className={styles.choice}>
              <span id={languageId} className={styles.choiceLabel}>
                <PixelIcon name="language" size={16} />
                {t('settings.language')}
              </span>
              <SegmentedControl<Lang>
                labelledBy={languageId}
                value={prefs.lang}
                onChange={actions.setLang}
                options={[
                  { value: 'ja', label: t('lang.ja'), lang: 'ja' },
                  { value: 'en', label: t('lang.en'), lang: 'en' },
                ]}
              />
            </div>
            <div className={styles.choice}>
              <span id={themeId} className={styles.choiceLabel}>
                <PixelIcon name="theme-auto" size={16} />
                {t('settings.theme')}
              </span>
              <SegmentedControl<ThemePref>
                labelledBy={themeId}
                value={prefs.theme}
                onChange={actions.setTheme}
                options={[
                  { value: 'auto', label: t('settings.theme.auto') },
                  { value: 'light', label: t('settings.theme.light'), icon: 'sun' },
                  { value: 'dark', label: t('settings.theme.dark'), icon: 'moon' },
                ]}
              />
            </div>
            <div className={styles.choice}>
              <span id={motionId} className={styles.choiceLabel}>
                <PixelIcon name="motion" size={16} />
                {t('settings.reduceMotion')}
              </span>
              <SegmentedControl<MotionPref>
                labelledBy={motionId}
                value={prefs.motion}
                onChange={actions.setMotion}
                options={[
                  { value: 'auto', label: t('settings.reduceMotion.auto') },
                  { value: 'reduce', label: t('settings.reduceMotion.reduce') },
                  { value: 'full', label: t('settings.reduceMotion.full') },
                ]}
              />
            </div>
          </section>

          <section className={styles.section} aria-labelledby={`${themeId}-display`}>
            <h3 id={`${themeId}-display`} className={styles.heading}>
              <PixelIcon name="eye" size={16} />
              {t('settings.display')}
            </h3>
            <Switch label={t('settings.singleKey')} checked={prefs.singleKeyShortcuts} onChange={actions.setSingleKeyShortcuts} />
          </section>

          <section className={styles.section} aria-labelledby={`${themeId}-storage`}>
            <h3 id={`${themeId}-storage`} className={styles.heading}>
              <PixelIcon name="save" size={16} />
              {t('settings.storage')}
            </h3>
            <div className={styles.buttons}>
              <Button icon="undo" disabled={!system.hasBackup || readOnly} onClick={actions.restoreBackup}>
                {t('settings.restoreBackup')}
              </Button>
              <Button variant="danger" icon="trash" disabled={readOnly} onClick={() => setConfirmClear(true)}>
                {t('settings.clearAll')}
              </Button>
            </div>
            {!system.storageAvailable && <p className={styles.note}>{t('storage.unavailable')}</p>}
          </section>

          <section className={[styles.section, styles.data].join(' ')}>
            <p className={styles.note}>{t('about.dataVersion')}</p>
            <p className={styles.note}>{t('settings.dataNote')}</p>
            <div className={styles.buttons}>
              <Button icon="keyboard" onClick={actions.openKeys}>
                {t('settings.keyboard')}
              </Button>
              <Button icon="info" onClick={actions.openAbout}>
                {t('footer.about')}
              </Button>
            </div>
          </section>
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmClear}
        message={t('confirm.clearAll')}
        confirmLabel={t('confirm.clear')}
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false)
          actions.clearAllInput()
        }}
      />
    </>
  )
}
