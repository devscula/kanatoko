// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { bookImage } from './bookImages.ts'
import styles from './ItemImage.module.css'
import { ItemImage } from './ItemImage.tsx'
import { GLINT_TEXTURE } from './itemImageTable.ts'
import { itemImage } from './itemImages.ts'
import { PIXEL_ICON_SIZES } from './sizes.ts'

const rootOf = (container: HTMLElement): HTMLElement => {
  const root = container.firstElementChild
  if (!(root instanceof HTMLElement)) throw new Error('no item image')
  return root
}

const imgOf = (container: HTMLElement): HTMLImageElement => {
  const img = container.querySelector('img')
  if (img === null) throw new Error('no img')
  return img
}

describe('ItemImage', () => {
  it.each(PIXEL_ICON_SIZES)('shows the official image at %ipx', (size) => {
    const { container } = render(<ItemImage item="boots" size={size} />)
    const root = rootOf(container)
    expect(root).toHaveAttribute('data-item-image', 'boots')
    expect(root.style.getPropertyValue('--item-size')).toBe(`${size}px`)
    const img = imgOf(container)
    expect(img).toHaveAttribute('src', itemImage('boots').src)
    expect(img).toHaveAttribute('width', String(size))
    expect(img).toHaveAttribute('height', String(size))
    // Every icon size is a whole multiple of the 16px source
    expect(size % itemImage('boots').px).toBe(0)
    expect(img).toHaveClass(styles.img)
  })

  it('is decorative (alt="") without a label, so it is not announced', () => {
    const { container } = render(<ItemImage item="sword" size={32} />)
    expect(imgOf(container)).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('treats an empty label as decorative', () => {
    const { container } = render(<ItemImage item="sword" size={32} label="" />)
    expect(imgOf(container)).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('is an image with a name when labeled', () => {
    render(<ItemImage item="sword" size={48} label="剣" />)
    expect(screen.getByRole('img', { name: '剣' })).toHaveAttribute('src', itemImage('sword').src)
  })

  it('does not glint when not enchanted', () => {
    expect(render(<ItemImage item="boots" size={48} />).container.querySelector('[data-glint]')).toBeNull()
  })

  it('overlays the glint, masked to the item image, when enchanted', () => {
    const { container } = render(<ItemImage item="boots" size={48} enchanted label="ブーツ" />)
    const glint = container.querySelector<HTMLElement>('[data-glint]')
    expect(glint).not.toBeNull()
    expect(glint).toHaveClass(styles.glint)
    expect(glint).toHaveAttribute('aria-hidden', 'true')
    expect(glint!.style.maskImage).toBe(`url("${itemImage('boots').src}")`)
    // The phase follows the page clock (a negative delay)
    expect(glint!.style.getPropertyValue('--glint-delay')).toMatch(/^-?\d+ms$/)
    // Only the image has a name; the glint is not announced
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('always glints the enchanted book, as in the game', () => {
    expect(render(<ItemImage item="enchanted_book" size={32} />).container.querySelector('[data-glint]')).not.toBeNull()
  })

  it('shows the book image of the enchantment for a book with exactly one enchantment, glinting and masked to that image', () => {
    const { container } = render(<ItemImage item="enchanted_book" size={32} book={{ protection: 4 }} />)
    const src = bookImage({ protection: 4 })!.src
    expect(imgOf(container)).toHaveAttribute('src', src)
    expect(src).not.toBe(itemImage('enchanted_book').src)
    expect(container.querySelector<HTMLElement>('[data-glint]')!.style.maskImage).toBe(`url("${src}")`)
  })

  it('keeps the official book image for a book with two or more enchantments, an empty book and a book without contents', () => {
    for (const book of [{ protection: 4, mending: 1 }, {}, undefined]) {
      const { container, unmount } = render(<ItemImage item="enchanted_book" size={32} book={book} />)
      expect(imgOf(container), JSON.stringify(book)).toHaveAttribute('src', itemImage('enchanted_book').src)
      unmount()
    }
  })

  it('ignores the book contents for an item that is not a book', () => {
    const { container } = render(<ItemImage item="helmet" size={32} enchanted book={{ protection: 4 }} />)
    expect(imgOf(container)).toHaveAttribute('src', itemImage('helmet').src)
  })

  it('keeps a given class name', () => {
    const root = rootOf(render(<ItemImage item="bow" size={16} className="extra" />).container)
    expect(root).toHaveClass('extra')
    expect(root).toHaveClass(styles.image)
  })
})

/**
 * Reads the CSS source with Node's fs, because Vitest turns a CSS Module ?raw import into a class name proxy.
 * The inline type covers only the function used, which keeps Node's types out of the app tsconfig.
 */
function readCss(): string {
  type Fs = { readFileSync(path: string, encoding: 'utf8'): string }
  const { process } = globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): Fs } }
  const { dirname } = import.meta as ImportMeta & { readonly dirname: string }
  return process.getBuiltinModule('node:fs').readFileSync(`${dirname}/ItemImage.module.css`, 'utf8')
}

describe('ItemImage styles', () => {
  const css = readCss()
  /** The declarations of the first rule for the selector. */
  const block = (selector: string): string => {
    const start = css.indexOf(`${selector} {`)
    expect(start, selector).toBeGreaterThanOrEqual(0)
    return css.slice(start, css.indexOf('}', start))
  }

  it('scales the item image with nearest neighbor (no blur)', () => {
    expect(block('.img')).toContain('image-rendering: pixelated')
    expect(block('.glint')).toContain('image-rendering: pixelated')
  })

  it('animates the glint slowly with the motion token', () => {
    expect(block('.glint::before')).toMatch(/animation: glint var\(--dur-glint\) linear var\(--glint-delay, 0s\) infinite/)
  })

  it('stops the glint (but keeps it) when motion is reduced: the setting first, then the OS setting', () => {
    // Reduce chosen in settings
    expect(block(":global(html[data-motion='reduce']) .glint::before")).toContain('animation: none')
    // Auto follows the OS setting; Don't reduce overrides it
    const media = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(media.slice(0, media.indexOf('}\n}'))).toMatch(/:global\(html:not\(\[data-motion='full'\]\)\) \.glint::before \{\s*animation: none;/)
  })

  it('uses the official glint texture, scaled smoothly as in the game (.mcmeta "blur": true)', () => {
    expect(block('.glint::before')).toContain(`url('./items/${GLINT_TEXTURE.file}')`)
    expect(block('.glint::before')).toContain('image-rendering: auto')
  })

  it('adds the glint to the image (additive blend) instead of covering it', () => {
    expect(css).toMatch(/@supports \(mix-blend-mode: plus-lighter\) \{\s*\.glint \{\s*mix-blend-mode: plus-lighter;/)
    expect(block('.glint')).toContain('mix-blend-mode: screen')
  })
})
