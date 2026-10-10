import type { ReactNode } from 'react'
import { useColumns, useHeightMode } from '../../components/base/useMediaQuery.ts'
import { INPUT_COLUMN_ID } from './inputColumn.ts'
import styles from './WorkbenchLayout.module.css'

export interface WorkbenchLayoutProps {
  /** No item chosen yet; the left column then spans the full width */
  readonly first: boolean
  readonly left: ReactNode
  readonly center: ReactNode
  readonly footer?: ReactNode
}

export function WorkbenchLayout({ first, left, center, footer }: WorkbenchLayoutProps) {
  const columns = useColumns()
  const { compact, pageScroll } = useHeightMode()
  const columnScroll = columns > 1 && !pageScroll && !first
  // Columns are focusable only when they scroll on their own; with whole-page scrolling there is nothing to scroll.
  const scrollable = columnScroll ? 0 : undefined

  return (
    <main
      className={styles.workbench}
      data-columns={first ? 1 : columns}
      data-first={first || undefined}
      data-compact={compact || undefined}
      data-fixed={columnScroll || undefined}
    >
      <section id={INPUT_COLUMN_ID} className={styles.left} aria-labelledby="input-heading" tabIndex={scrollable}>
        {/* The input panel renders the column heading with id="input-heading" */}
        {left}
        {columns > 1 && !first && footer}
      </section>
      {!first && (
        <section className={styles.center} aria-labelledby="results" tabIndex={scrollable}>
          {center}
        </section>
      )}
      {(columns === 1 || first) && footer}
    </main>
  )
}
