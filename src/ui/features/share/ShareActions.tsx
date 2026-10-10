import { Button, IconButton } from '../../components/base/Button.tsx'
import { useT } from '../../i18n/useT.ts'
import { useSharePlan, useShareUrl, useShownLink } from './hooks.ts'
import styles from './ShareActions.module.css'
import { copyPlanText, shareLink } from './sharing.ts'

export interface ShareActionsProps {
  readonly iconOnly?: boolean
}

export function ShareActions({ iconOnly = false }: ShareActionsProps = {}) {
  const translator = useT()
  const { t } = translator
  const view = useSharePlan()
  const link = useShownLink()
  const linkUrl = useShareUrl(link)
  const planUrl = useShareUrl(view?.link ?? null)

  if (iconOnly) {
    return (
      <div role="group" aria-label={t('share.actionsLabel')} className={styles.actions}>
        <IconButton
          icon="share"
          variant="ghost"
          label={t('share.button')}
          disabled={link === null}
          onClick={() => link !== null && void shareLink(link, view, translator, linkUrl)}
        />
        {view !== null && (
          <IconButton icon="copy" variant="ghost" label={t('share.copyText')} onClick={() => void copyPlanText(view, translator, planUrl)} />
        )}
      </div>
    )
  }

  return (
    <div role="group" aria-label={t('share.actionsLabel')} className={styles.actions}>
      <Button
        className={styles.action}
        icon="share"
        disabled={link === null}
        onClick={() => link !== null && void shareLink(link, view, translator, linkUrl)}
      >
        {t('share.button')}
      </Button>
      {view !== null && (
        <Button className={styles.action} icon="copy" onClick={() => void copyPlanText(view, translator, planUrl)}>
          {t('share.copyText')}
        </Button>
      )}
    </div>
  )
}
