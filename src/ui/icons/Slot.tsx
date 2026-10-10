// Slots are aria-hidden because the text around them carries the same content.
import type { ItemTypeId } from '../../data/types.ts'
import type { EnchantLevels } from '../../engine/index.ts'
import { ItemImage } from './ItemImage.tsx'
import { SLOT_ICON_SIZE, type SlotSize } from './sizes.ts'
import styles from './Slot.module.css'

export interface SlotProps {
  readonly size: SlotSize
  readonly item?: ItemTypeId | null
  readonly enchanted?: boolean
  readonly book?: EnchantLevels
  /** Tag of a made book or item, such as 'A' or 'AA'. */
  readonly letter?: string | null
  readonly placeholder?: boolean
  readonly className?: string
}

const SIZE_CLASS: Readonly<Record<SlotSize, string | undefined>> = {
  36: styles.s36,
  72: styles.s72,
}

function classNames(...names: readonly (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

export function Slot({ size, item = null, enchanted = false, book, letter = null, placeholder = false, className }: SlotProps) {
  return (
    <span className={classNames(styles.slot, SIZE_CLASS[size], placeholder && styles.placeholder, className)} data-slot-size={size} aria-hidden>
      {item !== null && <ItemImage item={item} size={SLOT_ICON_SIZE[size]} enchanted={enchanted} book={book} />}
      {letter !== null && letter !== '' && <span className={styles.letter}>{letter}</span>}
    </span>
  )
}
