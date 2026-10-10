import type { ItemTypeId } from '../../../data/types.ts'
import type { Warning } from '../../../engine/index.ts'
import { Button } from '../../components/base/Button.tsx'
import { enchText, itemText, listText } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import styles from './CreativeBanner.module.css'
import { findWarning } from './model.ts'

export interface CreativeBannerProps {
  readonly warnings: readonly Warning[]
  readonly itemType: ItemTypeId | null
  onSurvival(): void
}

export function CreativeBanner({ warnings, itemType, onSurvival }: CreativeBannerProps) {
  const { t, lang } = useT()
  const overCap = findWarning(warnings, 'steps-over-survival-limit')
  const inapplicable = findWarning(warnings, 'creative-inapplicable-ignored')
  const gap = lang === 'ja' ? '' : ' '
  return (
    <section className={styles.banner} aria-labelledby="creative-banner-text">
      <PixelIcon name="warning" size={16} className={styles.icon} />
      <div className={styles.content}>
        <p id="creative-banner-text" className={styles.text}>
          {overCap !== undefined && overCap.steps.length > 0 ? t('creative.banner', { n: overCap.steps.length }) : t('creative.bannerNone')}
          {gap}
          {t('creative.noXp')}
        </p>
        {inapplicable !== undefined && (
          <p className={styles.text}>
            {t('warning.creativeInapplicable', {
              item: itemText(itemType ?? 'enchanted_book'),
              list: listText(inapplicable.enchantments.map((id) => enchText(id))),
            })}
          </p>
        )}
        <Button onClick={onSurvival}>{t('creative.backToSurvival')}</Button>
      </div>
    </section>
  )
}
