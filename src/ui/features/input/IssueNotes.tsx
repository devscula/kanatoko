import type { Edition, ItemTypeId } from '../../../data/types.ts'
import type { ValidationIssue } from '../../../engine/index.ts'
import { INPUT_ISSUE_MARK } from '../../components/base/focus.ts'
import { describeValidationIssue } from '../../i18n/engineCodes.ts'
import { useT } from '../../i18n/useT.ts'
import { PixelIcon } from '../../icons/PixelIcon.tsx'
import styles from './Input.module.css'

export function IssueNotes({ issues, edition, itemType }: { readonly issues: readonly ValidationIssue[]; readonly edition: Edition; readonly itemType: ItemTypeId | null }) {
  const { text } = useT()
  if (issues.length === 0) return null
  return (
    <div className={styles.issues} {...INPUT_ISSUE_MARK}>
      {issues.map((issue, i) => (
        <p key={`${issue.code}-${i}`} className={styles.issue}>
          <PixelIcon name="warning" size={16} className={styles.issueIcon} />
          <span>{text(describeValidationIssue(issue, { edition, itemType }))}</span>
        </p>
      ))}
    </div>
  )
}
