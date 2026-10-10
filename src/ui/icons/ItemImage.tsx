import { useState, type CSSProperties } from 'react'
import type { ItemTypeId } from '../../data/types.ts'
import type { EnchantLevels } from '../../engine/index.ts'
import { bookImage } from './bookImages.ts'
import styles from './ItemImage.module.css'
import { itemImage } from './itemImages.ts'
import type { PixelIconSize } from './sizes.ts'

export interface ItemImageProps {
  readonly item: ItemTypeId
  readonly size: PixelIconSize
  /** Without it the image is decorative, as it should be next to a text label. */
  readonly label?: string
  /** The enchanted book glints regardless, as in the game. */
  readonly enchanted?: boolean
  /**
   * For enchanted_book only: a single enchantment shows that enchantment's book image. Omit it for a book that stands for
   * no particular enchantment.
   */
  readonly book?: EnchantLevels
  readonly className?: string
}

function Glint({ src }: { readonly src: string }) {
  // Offset by the mount time so that every glint moves in step, as in the game
  const [phase] = useState(() => `${-Math.round(performance.now())}ms`)
  const mask = `url("${src}")`
  return (
    <span
      className={styles.glint}
      style={{ maskImage: mask, WebkitMaskImage: mask, '--glint-delay': phase } as CSSProperties}
      aria-hidden="true"
      data-glint=""
    />
  )
}

export function ItemImage({ item, size, label, enchanted = false, book, className }: ItemImageProps) {
  const image = (item === 'enchanted_book' && book !== undefined ? bookImage(book) : null) ?? itemImage(item)
  return (
    <span
      className={className === undefined ? styles.image : `${styles.image} ${className}`}
      style={{ '--item-size': `${size}px` } as CSSProperties}
      data-item-image={item}
    >
      <img className={styles.img} src={image.src} width={size} height={size} alt={label ?? ''} draggable={false} />
      {(enchanted || image.foil) && <Glint src={image.src} />}
    </span>
  )
}
