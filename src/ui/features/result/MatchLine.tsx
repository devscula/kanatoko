import type { Edition } from '../../../data/types.ts'
import { fillSlot, SLOT_MARK } from '../../i18n/fillSlots.tsx'
import { useT } from '../../i18n/useT.ts'
import styles from './MatchLine.module.css'

// The game text stays on one line, since a break between "Cost:" and the number makes it harder to compare
export function MatchLine({ edition, cost, className }: { readonly edition: Edition; readonly cost: number; readonly className?: string }) {
  const { t } = useT()
  if (edition === 'bedrock') return <p className={className}>{t('match.bedrock', { c: cost })}</p>
  return (
    <p className={className}>
      {fillSlot(t('match.java', { game: SLOT_MARK }), <span className={styles.game}>{t('match.gameCost', { c: cost })}</span>)}
    </p>
  )
}
