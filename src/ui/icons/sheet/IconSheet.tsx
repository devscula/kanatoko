// Development page for checking the icons: run `npm run dev` and open /src/ui/icons/sheet/ (?theme=light|dark).
// Only developers see it, so the text skips i18n.
import { useEffect, useState } from 'react'
import type { ItemTypeId } from '../../../data/types.ts'
import { UI_ICON_KEYS, type IconKey } from '../iconKeys.ts'
import { ITEM_IMAGE_TABLE } from '../itemImageTable.ts'
import { ItemImage } from '../ItemImage.tsx'
import { PixelIcon } from '../PixelIcon.tsx'
import { SLOT_ICON_SIZE, SLOT_SIZES, type PixelIconSize } from '../sizes.ts'
import { Slot } from '../Slot.tsx'
import styles from './IconSheet.module.css'

type Theme = 'auto' | 'light' | 'dark'

const THEMES: readonly { readonly value: Theme; readonly label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const SPECIMEN_SIZES: readonly PixelIconSize[] = [64, 32, 16]
const ITEM_SIZES: readonly PixelIconSize[] = [16, 32, 64]
const ITEMS = Object.keys(ITEM_IMAGE_TABLE) as ItemTypeId[]

function initialTheme(): Theme {
  const value = new URLSearchParams(window.location.search).get('theme')
  return value === 'light' || value === 'dark' ? value : 'auto'
}

function Specimen({ name }: { readonly name: IconKey }) {
  return (
    <li className={styles.card}>
      <p className={styles.cardHead}>
        <code className={styles.number}>{name}</code>
      </p>
      <div className={styles.sizes}>
        {SPECIMEN_SIZES.map((size) => (
          <PixelIcon key={size} name={name} size={size} />
        ))}
      </div>
    </li>
  )
}

function ItemSpecimen({ item }: { readonly item: ItemTypeId }) {
  const { file, px } = ITEM_IMAGE_TABLE[item]
  return (
    <li className={styles.card}>
      <p className={styles.cardHead}>
        <code className={styles.number}>{item}</code>
        <code className={styles.key}>
          {file} ({px}px)
        </code>
      </p>
      {[false, true].map((enchanted) => (
        <div key={String(enchanted)} className={styles.itemRow}>
          <span className={styles.rowLabel}>{enchanted ? 'Glint' : 'Plain'}</span>
          <div className={styles.sizes}>
            {ITEM_SIZES.map((size) => (
              <ItemImage key={size} item={item} size={size} enchanted={enchanted} />
            ))}
          </div>
        </div>
      ))}
    </li>
  )
}

function SlotRow({ items, enchanted }: { readonly items: readonly ItemTypeId[]; readonly enchanted: boolean }) {
  return (
    <ul className={styles.inventory}>
      {items.map((item) => (
        <li key={item}>
          <Slot size={72} item={item} enchanted={enchanted} />
        </li>
      ))}
    </ul>
  )
}

export function IconSheet() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') delete root.dataset.theme
    else root.dataset.theme = theme
  }, [theme])

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <PixelIcon name="anvil" size={32} />
          Icon sheet
        </h1>
        <div className={styles.themes} role="group" aria-label="Theme">
          {THEMES.map(({ value, label }) => (
            <button key={value} type="button" className={styles.theme} aria-pressed={theme === value} onClick={() => setTheme(value)}>
              {label}
            </button>
          ))}
        </div>
        <p className={styles.note}>
          The 28 item types use the official Minecraft images (© Mojang Studios, sources in src/ui/icons/items/SOURCES.md), scaled
          with nearest-neighbor sampling. The glint is enchanted_glint_item.png from the game, clipped to the shape of the item, added
          on top and slowly scrolled (it stops when reduced motion is requested). The enchanted book always glints, as in the game.
          The UI icons are pixel art drawn for this tool, in the single text color.
        </p>
      </header>

      <section className={styles.section} aria-labelledby="in-slots">
        <h2 id="in-slots" className={styles.sectionTitle}>
          In slots (72px slots with a 64px image; plain on top, glint below)
        </h2>
        <div className={styles.slotRows}>
          <SlotRow items={ITEMS} enchanted={false} />
          <SlotRow items={ITEMS} enchanted />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="items">
        <h2 id="items" className={styles.sectionTitle}>
          Items (official images at 16, 32 and 64px, plain and with glint)
        </h2>
        <ul className={styles.grid}>
          {ITEMS.map((item) => (
            <ItemSpecimen key={item} item={item} />
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="ui">
        <h2 id="ui" className={styles.sectionTitle}>
          UI icons
        </h2>
        <ul className={styles.grid}>
          {UI_ICON_KEYS.map((name) => (
            <Specimen key={name} name={name} />
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="slots">
        <h2 id="slots" className={styles.sectionTitle}>
          Slots
        </h2>
        <div className={styles.tableScroll} role="region" aria-labelledby="slots" tabIndex={0}>
          <table className={styles.slotTable}>
            <thead>
              <tr>
                <th scope="col">Size</th>
                <th scope="col">Empty</th>
                <th scope="col">Placeholder</th>
                <th scope="col">Item</th>
                <th scope="col">Enchanted</th>
                <th scope="col">Combined book</th>
                <th scope="col">Two-letter label</th>
              </tr>
            </thead>
            <tbody>
              {SLOT_SIZES.map((size) => (
                <tr key={size}>
                  <th scope="row">
                    <span className={styles.number}>{size}</span>
                    <span className={styles.key}>image {SLOT_ICON_SIZE[size]}</span>
                  </th>
                  <td>
                    <Slot size={size} />
                  </td>
                  <td>
                    <Slot size={size} placeholder />
                  </td>
                  <td>
                    <Slot size={size} item="boots" />
                  </td>
                  <td>
                    <Slot size={size} item="boots" enchanted />
                  </td>
                  <td>
                    <Slot size={size} item="enchanted_book" letter="A" />
                  </td>
                  <td>
                    <Slot size={size} item="head" letter="AB" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
