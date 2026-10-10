/** Whole multiples of 16px only, so that the pixels stay sharp. */
export const PIXEL_ICON_SIZES = [16, 32, 48, 64, 96, 128] as const
export type PixelIconSize = (typeof PIXEL_ICON_SIZES)[number]

/**
 * 24 draws at 2px per cell like 32 but leaves out the two empty cells on each side, so that an icon matches the pixel
 * size of the item images without taking a 32px box.
 */
export const UI_ICON_SIZES = [16, 24, 32, 48, 64, 96, 128] as const
export type UiIconSize = (typeof UI_ICON_SIZES)[number]

export const SLOT_SIZES = [36, 72] as const
export type SlotSize = (typeof SLOT_SIZES)[number]

export const SLOT_ICON_SIZE: Readonly<Record<SlotSize, PixelIconSize>> = {
  36: 32,
  72: 64,
}
