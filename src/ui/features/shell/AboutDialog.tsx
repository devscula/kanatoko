import { Sheet } from '../../components/base/Sheet.tsx'
import { useT } from '../../i18n/useT.ts'
import { BOOK_IMAGE_PACK } from '../../icons/bookImageTable.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import { useAppStore } from '../../state/store.ts'
import styles from './AboutDialog.module.css'
import { PROJECT } from './projectInfo.ts'

/** Same markup as the wiki link in CostBreakdown */
function ExternalLink({ href, children }: { readonly href: string; readonly children: string }) {
  const { t } = useT()
  return (
    <a className={styles.external} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <PixelIcon name="external" size={16} />
      <span className="visually-hidden">{t('a11y.external')}</span>
    </a>
  )
}

export function AboutDialog() {
  const { t } = useT()
  const open = useAppStore((s) => s.ui.aboutOpen)
  const close = useAppStore((s) => s.closeAbout)
  return (
    <Sheet open={open} onClose={close} title={t('about.title')}>
      <div className={styles.about}>
        <div className={styles.lead}>
          <PixelIcon name="anvil" size={48} />
          <p className={styles.appName}>{t('app.name')}</p>
        </div>
        <p>{t('about.purpose')}</p>
        <p>{t('about.method')}</p>
        <p>{t('about.data')}</p>
        <p>{t('about.icons')}</p>
        <p>{t('about.itemImages')}</p>
        <p>{t('about.bookImages')}</p>
        <ul className={styles.links}>
          <li>
            <ExternalLink href={BOOK_IMAGE_PACK.page}>{t('about.bookImagesPage')}</ExternalLink>
          </li>
          <li>
            <ExternalLink href={BOOK_IMAGE_PACK.licenseUrl}>{t('about.bookImagesLicense')}</ExternalLink>
          </li>
        </ul>
        <p>{t('about.fonts')}</p>
        <p>{t('about.contact', { owner: PROJECT.owner })}</p>
        <ul className={styles.links}>
          <li>
            <ExternalLink href={PROJECT.issuesUrl}>{t('about.contactLink')}</ExternalLink>
          </li>
        </ul>
        <p className={styles.disclaimer}>{t('about.disclaimer')}</p>
        <p className={styles.version}>{t('about.dataVersion')}</p>
      </div>
    </Sheet>
  )
}
