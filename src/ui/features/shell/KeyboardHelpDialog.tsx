import { Sheet } from '../../components/base/Sheet.tsx'
import type { MessageKey } from '../../i18n/messages/index.ts'
import { useT } from '../../i18n/useT.ts'
import { useAppStore } from '../../state/store.ts'
import styles from './KeyboardHelpDialog.module.css'

/** Message key prefix of each row, and whether it is a single-key shortcut */
const ROWS = [
  ['tab', false],
  ['tiles', false],
  ['homeEnd', false],
  ['pickTile', false],
  ['pickRow', false],
  ['rowLevel', false],
  ['digits', true],
  ['choice', false],
  ['stepper', false],
  ['undo', false],
  ['redo', false],
  ['search', true],
  ['view', true],
  ['esc', false],
  ['help', true],
] as const

type RowId = (typeof ROWS)[number][0]
type RowKey = `keys.${RowId}.${'key' | 'where' | 'action'}`
// Fails to type-check if a row uses a message key that does not exist.
const rowKeysExist: RowKey extends MessageKey ? true : never = true
void rowKeysExist
const keyOf = (row: RowId, part: 'key' | 'where' | 'action'): RowKey => `keys.${row}.${part}`

export function KeyboardHelpDialog() {
  const { t } = useT()
  const open = useAppStore((s) => s.ui.keysOpen)
  const close = useAppStore((s) => s.closeKeys)
  return (
    <Sheet open={open} onClose={close} title={t('keys.title')}>
      <p className={styles.note}>{t('keys.singleKeyNote')}</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('keys.colKey')}</th>
            <th scope="col">{t('keys.colWhere')}</th>
            <th scope="col">{t('keys.colAction')}</th>
            <th scope="col" className={styles.single}>
              {t('keys.colSingle')}
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([row, single]) => (
            <tr key={row}>
              <th scope="row">
                <kbd className={styles.kbd}>{t(keyOf(row, 'key'))}</kbd>
              </th>
              <td className={styles.where}>{t(keyOf(row, 'where'))}</td>
              <td>{t(keyOf(row, 'action'))}</td>
              <td className={styles.single}>
                {single && (
                  <>
                    <span aria-hidden="true">{t('keys.singleYes')}</span>
                    <span className="visually-hidden">{t('keys.singleSr')}</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  )
}
