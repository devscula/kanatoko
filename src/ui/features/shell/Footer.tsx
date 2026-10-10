// Same order as in the settings sheet (WCAG 3.2.6 Consistent Help).

import { Button } from '../../components/base/Button.tsx'
import { useT } from '../../i18n/useT.ts'
import { useAppStore } from '../../state/store.ts'
import styles from './Footer.module.css'

export function Footer() {
  const { t } = useT()
  const openAbout = useAppStore((s) => s.openAbout)
  const openKeys = useAppStore((s) => s.openKeys)
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.links}>
          <Button variant="ghost" onClick={openKeys}>
            {t('settings.keyboard')}
          </Button>
          <Button variant="ghost" onClick={openAbout}>
            {t('footer.about')}
          </Button>
        </div>
      </div>
    </footer>
  )
}
