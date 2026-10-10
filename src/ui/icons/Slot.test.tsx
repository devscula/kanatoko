// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { SLOT_ICON_SIZE, SLOT_SIZES } from './sizes.ts'
import { bookImage } from './bookImages.ts'
import { Slot } from './Slot.tsx'

const slotOf = (container: HTMLElement): HTMLElement => {
  const slot = container.firstElementChild
  if (!(slot instanceof HTMLElement)) throw new Error('no slot')
  return slot
}

describe('Slot', () => {
  it.each(SLOT_SIZES)('pairs a %ipx slot with its image size', (size) => {
    const { container } = render(<Slot size={size} item="boots" />)
    expect(slotOf(container)).toHaveAttribute('data-slot-size', String(size))
    expect(container.querySelector('[data-item-image="boots"] img')).toHaveAttribute('width', String(SLOT_ICON_SIZE[size]))
  })

  it('pairs each slot size with a 32 or 64px image', () => {
    expect(SLOT_ICON_SIZE).toEqual({ 36: 32, 72: 64 })
  })

  it('draws an empty slot without an image', () => {
    const { container } = render(<Slot size={72} />)
    expect(container.querySelector('img')).toBeNull()
    expect(slotOf(container).textContent).toBe('')
  })

  it('shows the letter tag over the image', () => {
    const { container } = render(<Slot size={72} item="enchanted_book" letter="A" />)
    const slot = slotOf(container)
    const texts = [...slot.children].filter((c) => !c.hasAttribute('data-item-image')).map((s) => s.textContent)
    expect(texts).toEqual(['A'])
    // The tag comes after the image so it renders on top
    expect(slot.firstElementChild).toHaveAttribute('data-item-image', 'enchanted_book')
  })

  it('passes the book contents to the image (a book with one enchantment shows the book image of that enchantment)', () => {
    const { container } = render(<Slot size={72} item="enchanted_book" book={{ mending: 1 }} />)
    expect(container.querySelector('img')).toHaveAttribute('src', bookImage({ mending: 1 })!.src)
  })

  it('omits the letter tag when absent', () => {
    const { container } = render(<Slot size={36} item="boots" letter={null} />)
    expect(slotOf(container).children).toHaveLength(1)
  })

  it('adds the enchanted glint only when enchanted', () => {
    expect(render(<Slot size={72} item="boots" enchanted />).container.querySelector('[data-glint]')).not.toBeNull()
    expect(render(<Slot size={72} item="boots" />).container.querySelector('[data-glint]')).toBeNull()
  })

  it('is hidden from assistive technology', () => {
    const { container } = render(<Slot size={72} item="boots" letter="A" />)
    expect(slotOf(container)).toHaveAttribute('aria-hidden', 'true')
    expect(slotOf(container)).not.toHaveAttribute('role')
  })

  it('switches to the placeholder frame and keeps a given class name', () => {
    const plain = slotOf(render(<Slot size={72} className="extra" />).container)
    const placeholder = slotOf(render(<Slot size={72} placeholder className="extra" />).container)
    expect(placeholder).toHaveClass('extra')
    const added = [...placeholder.classList].filter((c) => !plain.classList.contains(c))
    expect(added).toHaveLength(1)
  })
})
