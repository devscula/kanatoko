// The hash is not touched here: src/ui/url watches the share slice and rewrites it.

import { useEffect, useState } from 'react'
import { Banner } from '../../components/base/Banner.tsx'
import { Button } from '../../components/base/Button.tsx'
import { ConfirmDialog } from '../../components/base/ConfirmDialog.tsx'
import { editionText, itemText, listText, msg } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { useAppStore } from '../../state/store.ts'
import styles from './BannerArea.module.css'
import { focusInputColumn } from './inputColumn.ts'
import { SHARED_EDIT_BUTTON_ID } from './readOnly.ts'

// The banner and the pressed button go away, so focus moves on to the next control in DOM order, the first one in the
// input column, rather than falling back to the top of the page (WCAG 2.4.3).
function focusActiveTab(): void {
  focusInputColumn()
}

export function BannerArea() {
  const { t, text } = useT()
  const share = useAppStore((s) => s.share)
  const banners = useAppStore((s) => s.system.banners)
  const dismiss = useAppStore((s) => s.dismissBanner)
  const announce = useAppStore((s) => s.announce)
  const replaceWithShared = useAppStore((s) => s.replaceWithSharedPlan)
  const exitShared = useAppStore((s) => s.exitSharedPlan)
  const [confirmReplace, setConfirmReplace] = useState(false)

  useEffect(() => {
    if (banners.linkUnreadable) announce(msg('banner.linkUnreadable'))
  }, [banners.linkUnreadable, announce])
  useEffect(() => {
    if (banners.dataDropped) announce(msg('banner.dataDropped', { list: listText(banners.dataDropped) }))
  }, [banners.dataDropped, announce])

  const plan = share.active ? share.plan : null
  // A book-merging plan has no item, so it is shown as an enchanted book.
  const sharedItem = plan === null ? null : (plan.input.item ?? 'enchanted_book')
  const anything =
    plan !== null ||
    banners.linkUnreadable ||
    banners.dataDropped !== null ||
    banners.storageUnavailable ||
    banners.storageCorrupt
  if (!anything) return null

  return (
    <div className={styles.area}>
      {plan !== null && sharedItem !== null && (
        <Banner
          tone="shared"
          icon="info"
          label={t('banner.region.shared')}
          note={share.lockedNotice === true ? t('banner.shared.locked') : undefined}
          actions={
            <>
              <Button id={SHARED_EDIT_BUTTON_ID} variant="secondary" icon="edit" onClick={() => setConfirmReplace(true)}>
                {t('banner.shared.edit')}
              </Button>
              <Button
                variant="secondary"
                icon="undo"
                onClick={() => {
                  exitShared()
                  focusActiveTab()
                }}
              >
                {t('banner.shared.back')}
              </Button>
            </>
          }
        >
          {t('banner.shared', { edition: editionText(plan.settings.edition), item: itemText(sharedItem) })}
        </Banner>
      )}
      {banners.linkUnreadable && (
        <Banner icon="warning" label={t('banner.region.link')} onClose={() => dismiss('linkUnreadable')}>
          {t('banner.linkUnreadable')}
        </Banner>
      )}
      {banners.dataDropped !== null && (
        <Banner label={t('banner.region.data')} onClose={() => dismiss('dataDropped')}>
          {text(msg('banner.dataDropped', { list: listText(banners.dataDropped) }))}
        </Banner>
      )}
      {banners.storageUnavailable && (
        <Banner icon="warning" label={t('banner.region.storage')} onClose={() => dismiss('storageUnavailable')}>
          {t('banner.storageUnavailable')}
        </Banner>
      )}
      {banners.storageCorrupt && (
        <Banner icon="warning" label={t('banner.region.storage')} onClose={() => dismiss('storageCorrupt')}>
          {t('banner.storageCorrupt')}
        </Banner>
      )}
      <ConfirmDialog
        open={confirmReplace}
        message={t('confirm.replaceWithShared')}
        confirmLabel={t('confirm.replace')}
        onCancel={() => setConfirmReplace(false)}
        onConfirm={() => {
          setConfirmReplace(false)
          replaceWithShared()
          focusActiveTab()
        }}
      />
    </div>
  )
}
