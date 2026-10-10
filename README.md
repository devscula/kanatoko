# Kanatoko

Kanatoko is a web app that finds the order of anvil steps that puts a set of enchantments on a Minecraft item
for the fewest experience levels. It covers Java Edition 26.3 and Bedrock Edition 26.50–26.52 and runs entirely in the browser;
your input is never sent anywhere. The interface is in Japanese and English.

Use it at [devscula.github.io/kanatoko](https://devscula.github.io/kanatoko/).

## Features

- Pick an item and the enchantments you want, or merge books into one book. Incompatible enchantments are pointed out, and one
  button selects every compatible enchantment at its max level. Renaming the item can be included as part of the plan.
- Java Edition and Bedrock Edition each use their own rules and data, including Bedrock's cost formula, multipliers and
  incompatibilities.
- Enchantments already on the item, its prior anvil uses, and books or spare items you already have are taken into account.
  What you have is used only when it lowers the cost.
- Survival keeps every step under the 40-level "Too Expensive!" limit; Creative has no limit. When a goal cannot be reached in
  Survival, the app explains why and suggests changes that make it possible.
- Optimize for the fewest total levels, the fewest XP points or the lowest final prior work penalty.
- Results as a step list or a combining tree, with a cost breakdown for each step.
- Share a plan as a link or copy it as text.
- Light and dark themes, keyboard shortcuts, and undo and redo. Your input is saved in the browser.

## Development

Requires Node.js 22.18 or later: the scripts import TypeScript files directly through Node's type stripping.

```sh
npm ci
npm run dev
```

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server. |
| `npm test` | Run the unit and integration tests (Vitest). |
| `npm run test:watch` | Run the tests in watch mode. |
| `npm run test:perf` | Run the performance tests, which are skipped by `npm test`. |
| `npm run build` | Type-check and build the site into `dist/`. |
| `npm run preview` | Serve the production build locally. |
| `npm run lint` | Lint with oxlint. |
| `npm run typecheck` | Type-check with `tsc -b`. |
| `npm run gen:data` | Regenerate `src/data/gameData.generated.ts` from the files in `data/`. |
| `npm run gen:fonts` | Regenerate `src/ui/styles/fonts.generated.css` from the Fontsource packages. |

The generators take `--check` to verify that the committed output is up to date, for example `node scripts/gen-data.mjs --check`.

### Game data

`data/enchantment-data.json` holds the enchantments and items (Java Edition from the 26.3 game data, Bedrock Edition from
minecraft.wiki) and `data/japanese-names.json` the official Japanese and English names. `npm run gen:data` checks both files,
applies the corrections in `src/data/buildGameData.ts` and writes `src/data/gameData.generated.ts`.

### Images

The item and book images are committed. To extract them again, download the inputs and run:

```sh
node scripts/extract-icons.mjs client-26.3.jar
node scripts/extract-book-icons.mjs "XK redstone display 26.3.0.zip"
```

- `client-26.3.jar` is the Java Edition 26.3 client. Find version 26.3 in Mojang's
  [version manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json), open its version JSON and download
  `downloads.client.url`. `extract-icons.mjs` also downloads three inventory renders from minecraft.wiki; pass
  `--wiki-dir <dir>` to use local copies instead.
- `XK redstone display 26.3.0.zip` is the resource pack from its
  [Modrinth page](https://modrinth.com/resourcepack/xk-redstone-display).

Both scripts record the input file names and hashes in `src/ui/icons/items/SOURCES.md` and `src/ui/icons/books/SOURCES.md`, so
keep the file names above. Add `--check` to compare with the committed files without writing.

## Credits and licenses

The source code is released under the [MIT License](LICENSE). The images and fonts are not covered by it; their terms are
listed below.

- Minecraft item textures and the enchantment glint are © Mojang Studios, taken from the Java Edition client and used under the
  [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines).
- The shield, carved pumpkin and creeper head images are inventory renders from [minecraft.wiki](https://minecraft.wiki/).
- Images of books with a single enchantment are from the resource pack
  [XK Redstone Display](https://modrinth.com/resourcepack/xk-redstone-display) by Xe_Kr, licensed under
  [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) and used unmodified. See
  [`src/ui/icons/books/SOURCES.md`](src/ui/icons/books/SOURCES.md) for details.
- Fonts: [BIZ UDPGothic](https://fonts.google.com/specimen/BIZ+UDPGothic) and
  [DotGothic16](https://fonts.google.com/specimen/DotGothic16), both under the SIL Open Font License 1.1.
- Bedrock Edition rules are based on [minecraft.wiki](https://minecraft.wiki/w/Anvil_mechanics).
- The search builds on the ideas of kkchengaf's
  [Minecraft Enchantment Order Calculator](https://github.com/kkchengaf/Minecraft-Enchantment-Order-Calculator)
  (precomputed tree shapes and the rearrangement inequality) and is implemented independently.
- The licenses of the npm packages bundled into the app are written to `third-party-licenses.md` in the build output.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
