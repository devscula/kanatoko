import type { IconKey } from './iconKeys.ts'
import { GRID } from './pixelData.ts'
import styles from './PixelIcon.module.css'
import { iconLayers } from './raster.ts'
import type { UiIconSize } from './sizes.ts'

export interface PixelIconProps {
  readonly name: IconKey
  readonly size: UiIconSize
  /** Without it the icon is aria-hidden, as it should be next to a text label or inside a labelled button. */
  readonly label?: string
  readonly className?: string
}

const VIEW_BOX = `0 0 ${GRID} ${GRID}`
// At 24px only the inner 12x12 cells are in the viewBox, at 2px each.
const TRIM = 2
const TRIMMED_VIEW_BOX = `${TRIM} ${TRIM} ${GRID - 2 * TRIM} ${GRID - 2 * TRIM}`

export function PixelIcon({ name, size, label, className }: PixelIconProps) {
  const labelled = label !== undefined && label !== ''
  return (
    <svg
      className={className === undefined ? styles.icon : `${styles.icon} ${className}`}
      width={size}
      height={size}
      viewBox={size === 24 ? TRIMMED_VIEW_BOX : VIEW_BOX}
      shapeRendering="crispEdges"
      focusable="false"
      data-icon={name}
      {...(labelled ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {iconLayers(name).map((layer) => (
        <path key={layer.fill} d={layer.d} fill={layer.fill} />
      ))}
    </svg>
  )
}
