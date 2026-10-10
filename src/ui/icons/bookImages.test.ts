import { GAME_DATA } from '../../data/gameData.generated.ts'
import { BOOK_IMAGE_LEVELS, BOOK_IMAGE_PACK, bookImageFile } from './bookImageTable.ts'
import { bookImage } from './bookImages.ts'
import sources from './books/SOURCES.md?raw'

const PNGS = import.meta.glob<string>('./books/*.png', { eager: true, query: '?inline', import: 'default' })
const FILES = Object.keys(import.meta.glob('./books/*')).map((key) => key.slice('./books/'.length))

function pngSize(file: string): { readonly width: number; readonly height: number } {
  const dataUrl = PNGS[`./books/${file}`]
  expect(dataUrl, `${file} (run scripts/extract-book-icons.mjs)`).toMatch(/^data:image\/png;base64,/)
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('IHDR')
  const view = new DataView(bytes.buffer)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('every level of every enchantment has a book image', () => {
  it('lists levels 1 to the maximum of all enchantments of both editions', () => {
    const expected = GAME_DATA.enchantments.flatMap((def) => Array.from({ length: def.maxLevel }, (_, i) => `${def.id} ${i + 1}`))
    expect(BOOK_IMAGE_LEVELS.map(({ id, level }) => `${id} ${level}`)).toEqual(expected)
    expect(new Set(GAME_DATA.enchantments.map((def) => def.id)).size).toBe(43)
  })

  it.each(BOOK_IMAGE_LEVELS.map(({ id, level }) => [id, level] as const))('%s %i', (id, level) => {
    const file = bookImageFile(id, level)
    expect(pngSize(file)).toEqual({ width: 16, height: 16 })
    const image = bookImage({ [id]: level })
    // The URL Vite resolves: /src/... in tests, a data URL or hashed file in builds
    expect(image?.src).toMatch(new RegExp(`/books/${file.replace('.', '\\.')}$`))
    expect(image?.px).toBe(16)
    // Enchanted books always glint in the game
    expect(image?.foil).toBe(true)
  })

  it('keeps no stray files: the folder holds the table images and SOURCES.md', () => {
    const expected = [...BOOK_IMAGE_LEVELS.map(({ id, level }) => bookImageFile(id, level)), 'SOURCES.md']
    expect([...FILES].sort()).toEqual(expected.sort())
  })

  it('records the author, the distribution page, the license and the source of every file in SOURCES.md', () => {
    for (const { id, level } of BOOK_IMAGE_LEVELS) expect(sources).toContain(`| \`${bookImageFile(id, level)}\` | ${id} | ${level} |`)
    expect(sources).toContain(BOOK_IMAGE_PACK.author)
    expect(sources).toContain(BOOK_IMAGE_PACK.page)
    expect(sources).toContain(BOOK_IMAGE_PACK.license)
    expect(sources).toContain(BOOK_IMAGE_PACK.licenseUrl)
  })
})

describe('bookImage uses the pack image only for a book with exactly one enchantment', () => {
  it('returns null for a book with two or more enchantments (the official book image is used)', () => {
    expect(bookImage({ protection: 4, mending: 1 })).toBeNull()
    expect(bookImage({ sharpness: 5, looting: 3, unbreaking: 3 })).toBeNull()
  })

  it('returns null for a book without enchantments', () => {
    expect(bookImage({})).toBeNull()
  })

  it('ignores entries without a level (EnchantLevels treats them as not present)', () => {
    expect(bookImage({ mending: 1, unbreaking: undefined })?.src).toMatch(/\/books\/mending_1\.png$/)
    expect(bookImage({ mending: 1, unbreaking: 0 })?.src).toMatch(/\/books\/mending_1\.png$/)
  })

  it('tells each level apart (I, II … and the maximum have different images)', () => {
    const srcs = [1, 2, 3, 4].map((level) => bookImage({ protection: level })?.src)
    expect(new Set(srcs).size).toBe(4)
  })
})
