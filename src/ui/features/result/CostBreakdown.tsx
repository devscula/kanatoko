import { compareTooltipOrder } from '../../../data/tooltipOrder.ts'
import type { Edition } from '../../../data/types.ts'
import type { EnchantCostLine, ObjectState } from '../../../engine/index.ts'
import { enchText, msg, romanText, type Text } from '../../i18n/text.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import type { DisplayStep } from '../../plan/displayPlan.ts'
import styles from './CostBreakdown.module.css'
import { enchantmentCost, WIKI_URLS } from './model.ts'

export interface CostBreakdownProps {
  readonly step: DisplayStep
  readonly edition: Edition
  /** Its row is left out when null */
  readonly after: ObjectState | null
  readonly id?: string
}

function lineName(line: EnchantCostLine): Text {
  if (line.outcome === 'conflict' || line.outcome === 'inapplicable') return msg('bd.notApplied', { name: enchText(line.id, line.rightLevel) })
  return enchText(line.id, line.resultLevel)
}

// Java Edition charges for the resulting level, Bedrock Edition only for the levels gained
function lineFormula(line: EnchantCostLine, edition: Edition): Text | null {
  if (line.outcome === 'conflict' || line.outcome === 'inapplicable') return null
  if (edition === 'bedrock' && line.leftLevel > 0) {
    return msg('bd.lineBedrock', { mult: line.multiplier, to: romanText(line.resultLevel), from: romanText(line.leftLevel) })
  }
  return msg('bd.line', { mult: line.multiplier, level: line.resultLevel })
}

export function CostBreakdown({ step, edition, after, id }: CostBreakdownProps) {
  const { t, text, num, lang } = useT()
  const { cost } = step
  return (
    <div className={styles.breakdown} id={id}>
      <table className={styles.table}>
        <caption className="visually-hidden">{t('step.breakdown')}</caption>
        <tbody>
          {cost.enchantments.length > 0 && (
            <tr className={styles.group}>
              <th scope="row">{t('bd.enchantments')}</th>
              <td />
              <td className={styles.num}>{num(enchantmentCost(cost))}</td>
            </tr>
          )}
          {[...cost.enchantments].sort((a, b) => compareTooltipOrder(a.id, b.id)).map((line) => {
            const formula = lineFormula(line, edition)
            return (
              <tr key={line.id} className={styles.line}>
                <th scope="row">{text(lineName(line))}</th>
                <td className={styles.formula}>{formula === null ? '' : text(formula)}</td>
                <td className={styles.num}>{num(line.cost)}</td>
              </tr>
            )
          })}
          <tr>
            <th scope="row">{t('bd.leftPwp')}</th>
            <td />
            <td className={styles.num}>{num(cost.leftPenalty)}</td>
          </tr>
          {step.right !== null && (
            <tr>
              <th scope="row">{t('bd.rightPwp')}</th>
              <td />
              <td className={styles.num}>{num(cost.rightPenalty)}</td>
            </tr>
          )}
          {edition === 'java' && cost.conflictPenalty > 0 && (
            <tr>
              <th scope="row">{t('bd.conflict', { n: cost.conflictPenalty })}</th>
              <td />
              <td className={styles.num}>{num(cost.conflictPenalty)}</td>
            </tr>
          )}
          {cost.rename === 1 && (
            <tr>
              <th scope="row">{t('bd.rename')}</th>
              <td />
              <td className={styles.num}>{num(1)}</td>
            </tr>
          )}
          <tr className={styles.total}>
            <th scope="row">{t('bd.total')}</th>
            <td />
            <td className={styles.num}>{num(cost.total)}</td>
          </tr>
        </tbody>
      </table>
      {cost.clampedFrom !== null && <p className={styles.note}>{t('bd.clamped', { x: cost.clampedFrom })}</p>}
      <dl className={styles.after}>
        <div className={styles.afterRow}>
          <dt>{t('bd.xp')}</dt>
          <dd className={styles.num}>{num(step.xpPoints)}</dd>
        </div>
        {after !== null && (
          <div className={styles.afterRow}>
            <dt>
              {t('bd.resultPwp')}
              <span className={styles.uses}>{t('bd.resultUses', { n: after.anvilUses })}</span>
            </dt>
            <dd className={[styles.num, styles.pwp].join(' ')}>{num(after.priorWorkPenalty)}</dd>
          </div>
        )}
      </dl>
      <a className={styles.wiki} href={WIKI_URLS[lang]} target="_blank" rel="noopener noreferrer">
        {t('bd.wiki')}
        <PixelIcon name="external" size={16} className={styles.external} />
        <span className="visually-hidden">{t('a11y.external')}</span>
      </a>
    </div>
  )
}
