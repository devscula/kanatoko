import { itemsInEdition } from '../../data/gameData.ts'
import { GAME_DATA } from '../../data/gameData.generated.ts'
import type { Edition, ItemTypeId } from '../../data/types.ts'
import { GLINT_TEXTURE, ITEM_IMAGE_TABLE, ITEM_MATERIAL } from './itemImageTable.ts'
import { ITEM_IMAGES, itemImage } from './itemImages.ts'
import itemImagesSource from './itemImages.ts?raw'
import sources from './items/SOURCES.md?raw'

const EDITIONS: readonly Edition[] = ['java', 'bedrock']

const PNGS = import.meta.glob<string>('./items/*.png', { eager: true, query: '?inline', import: 'default' })
const FILES = Object.keys(import.meta.glob('./items/*')).map((key) => key.slice('./items/'.length))

const hasFile = (file: string): boolean => PNGS[`./items/${file}`] !== undefined

function pngSize(file: string): { readonly width: number; readonly height: number } {
  const dataUrl = PNGS[`./items/${file}`]
  expect(dataUrl, file).toMatch(/^data:image\/png;base64,/)
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('IHDR')
  const view = new DataView(bytes.buffer)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe.each(EDITIONS)('%s: every item has an official image', (edition) => {
  it.each(itemsInEdition(edition).map((item) => item.id))('%s', (id: ItemTypeId) => {
    const def = ITEM_IMAGE_TABLE[id]
    expect(def).toBeDefined()
    expect(hasFile(def.file), `${def.file} (run scripts/extract-icons.mjs)`).toBe(true)
    expect([16, 32]).toContain(def.px)
    expect(pngSize(def.file)).toEqual({ width: def.px, height: def.px })
    // The URL Vite resolves: /src/... in tests, a data URL or hashed file in builds
    expect(itemImage(id).src).toMatch(new RegExp(`${def.file.replace('.', '\\.')}$`))
    expect(itemImage(id).px).toBe(def.px)
  })
})

describe('item image table', () => {
  it('covers exactly the item types of the game data', () => {
    expect(Object.keys(ITEM_IMAGE_TABLE).sort()).toEqual(GAME_DATA.items.map((i) => i.id).sort())
    expect(Object.keys(ITEM_IMAGES).sort()).toEqual(Object.keys(ITEM_IMAGE_TABLE).sort())
  })

  it('gives each item type its own image', () => {
    const files = Object.values(ITEM_IMAGE_TABLE).map((d) => d.file)
    expect(new Set(files).size).toBe(files.length)
  })

  it('uses the representative material for armor and tools', () => {
    for (const id of ['helmet', 'chestplate', 'leggings', 'boots', 'sword', 'spear', 'axe', 'pickaxe', 'shovel', 'hoe'] as const) {
      expect(ITEM_IMAGE_TABLE[id].file).toBe(`${ITEM_MATERIAL}_${id}.png`)
    }
  })

  it('draws the 3D items (shield, carved pumpkin, head) from 32px renders and everything else from 16px textures', () => {
    const renders = Object.entries(ITEM_IMAGE_TABLE)
      .filter(([, d]) => d.source.kind === 'render')
      .map(([id]) => id)
    expect(renders.sort()).toEqual(['carved_pumpkin', 'head', 'shield'])
    for (const def of Object.values(ITEM_IMAGE_TABLE)) expect(def.px).toBe(def.source.kind === 'render' ? 32 : 16)
  })

  it('makes only the enchanted book always glint (as in the game)', () => {
    const foil = Object.entries(ITEM_IMAGES)
      .filter(([, image]) => image.foil)
      .map(([id]) => id)
    expect(foil).toEqual(['enchanted_book'])
  })

  it('keeps no stray files: the folder holds the table images, the glint texture and SOURCES.md', () => {
    const expected = [...Object.values(ITEM_IMAGE_TABLE).map((d) => d.file), GLINT_TEXTURE.file, 'SOURCES.md']
    expect([...FILES].sort()).toEqual(expected.sort())
  })

  it('records the source of every file in SOURCES.md', () => {
    for (const file of [...Object.values(ITEM_IMAGE_TABLE).map((d) => d.file), GLINT_TEXTURE.file]) {
      expect(sources).toContain(`| \`${file}\` |`)
    }
    expect(sources).toContain('© Mojang Studios')
  })

  it('has the 128x128 glint texture, kept out of the item images because ItemImage.module.css loads it', () => {
    expect(pngSize(GLINT_TEXTURE.file)).toEqual({ width: GLINT_TEXTURE.px, height: GLINT_TEXTURE.px })
    // The import.meta.glob exclusion spells out the file name, so it has to match the table
    expect(itemImagesSource).toContain(`'!./items/${GLINT_TEXTURE.file}'`)
    expect(Object.values(ITEM_IMAGES).some((image) => image.src.endsWith(GLINT_TEXTURE.file))).toBe(false)
  })
})
