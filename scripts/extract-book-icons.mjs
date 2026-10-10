#!/usr/bin/env node
// Copies the enchanted book images of the XK Redstone Display resource pack (by Xe_Kr, CC BY-NC-ND 4.0) into
// src/ui/icons/books/ and writes SOURCES.md. The license allows no derivatives, so each PNG is copied byte for byte
// and only renamed. The books to copy are listed in src/ui/icons/bookImageTable.ts. Needs Node 22.18+ to import .ts.
//
// Images are not matched by file name: for each book, the pack's items/enchanted_book.json is evaluated the way the
// game does for a book with that single enchantment, and the texture of the resulting model is taken.
//
// Usage: node scripts/extract-book-icons.mjs <pack.zip> [--check]
// pack.zip comes from the author's distribution page (BOOK_IMAGE_PACK.page). --check only verifies the committed files.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOOK_IMAGE_LEVELS, BOOK_IMAGE_PACK, bookImageFile } from '../src/ui/icons/bookImageTable.ts'
import { expectSquare, openZip, sha256 } from './lib/assets.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(root, 'src/ui/icons/books')
const SOURCES_FILE = 'SOURCES.md'
const ITEMS_DEFINITION = 'assets/minecraft/items/enchanted_book.json'
const VANILLA_MODEL = 'minecraft:item/enchanted_book'

// The hash makes the script fail when the README changes, so the translation cannot go stale.
const README_TRANSLATION = {
  sha256: 'b1da0af27767d346c98903708423f28de06b637c9a8acc98d3f30a6578f48294',
  lines: [
    'Author: Xe_Kr',
    'This work is licensed under the Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International License.',
    'License terms: https://creativecommons.org/licenses/by-nc-nd/4.0/deed.zh',
    'Reposts must credit the author and link to the original post. Reposting or publishing for commercial purposes is prohibited.',
  ],
}

const args = process.argv.slice(2)
const fail = (message) => {
  console.error(`extract-book-icons: ${message}`)
  process.exit(1)
}
const usage = 'usage: node scripts/extract-book-icons.mjs <pack.zip> [--check]'
const check = args.includes('--check')
const positional = args.filter((a) => a !== '--check')
const unknownFlags = positional.filter((a) => a.startsWith('--'))
if (unknownFlags.length > 0) fail(`unknown option ${unknownFlags.join(' ')}\n${usage}`)
if (positional.length !== 1) fail(`one pack.zip is required\n${usage}`)
const packPath = positional[0]
if (!existsSync(packPath)) fail(`not found: ${packPath}`)

// Some of the pack's files start with a BOM.
const stripBom = (text) => text.replace(/^﻿/, '')
const readJson = (pack, entry) => JSON.parse(stripBom(pack.read(entry).toString('utf8')))

// 'minecraft:item/x' -> 'item/x'
function resourcePath(id) {
  const [namespace, rest] = id.includes(':') ? id.split(':', 2) : ['minecraft', id]
  if (namespace !== 'minecraft') throw new Error(`unsupported namespace: ${id}`)
  return rest
}

// Whether one stored_enchantments predicate entry matches a book holding only (id, level).
function matchesSingle(predicate, id, level) {
  const ids = Array.isArray(predicate.enchantments) ? predicate.enchantments : [predicate.enchantments]
  if (!ids.some((e) => resourcePath(e) === id)) return false
  const levels = predicate.levels
  if (levels === undefined) return true
  if (typeof levels === 'number') return levels === level
  if (typeof levels === 'object' && levels !== null) return (levels.min ?? -Infinity) <= level && level <= (levels.max ?? Infinity)
  throw new Error(`unsupported levels: ${JSON.stringify(levels)}`)
}

function resolveModel(node, id, level) {
  if (node.type === 'minecraft:model') return node.model
  if (node.type === 'minecraft:condition' && node.property === 'minecraft:component' && node.predicate === 'stored_enchantments') {
    // The predicate holds when each entry is satisfied by some enchantment on the item.
    const holds = node.value.every((predicate) => matchesSingle(predicate, id, level))
    return resolveModel(holds ? node.on_true : node.on_false, id, level)
  }
  throw new Error(`unsupported item model definition: ${JSON.stringify(node).slice(0, 120)}`)
}

function textureOfModel(pack, modelId) {
  const entry = `assets/minecraft/models/${resourcePath(modelId)}.json`
  const model = readJson(pack, entry)
  const layers = Object.keys(model.textures ?? {})
  if (resourcePath(model.parent ?? '') !== 'item/generated' || layers.length !== 1 || layers[0] !== 'layer0') {
    throw new Error(`${entry} is not a single flat texture (parent ${model.parent}, textures ${layers.join(', ')})`)
  }
  return `assets/minecraft/textures/${resourcePath(model.textures.layer0)}.png`
}

const packBuffer = readFileSync(packPath)
const pack = openZip(packBuffer)
const packName = path.basename(packPath)
const readme = (() => {
  try {
    return pack.read('README.txt')
  } catch {
    return null
  }
})()
if (readme !== null && sha256(readme) !== README_TRANSLATION.sha256) {
  fail(`the pack's README.txt has changed (SHA-256 ${sha256(readme)}); update README_TRANSLATION in this script`)
}

const outputs = new Map()
try {
  const definition = readJson(pack, ITEMS_DEFINITION)
  for (const { id, level } of BOOK_IMAGE_LEVELS) {
    const modelId = resolveModel(definition.model, id, level)
    if (resourcePath(modelId) === resourcePath(VANILLA_MODEL)) throw new Error(`the pack has no book image for ${id} ${level}`)
    const entry = textureOfModel(pack, modelId)
    const data = pack.read(entry)
    expectSquare(data, 16, entry)
    let animated = true
    try {
      pack.read(`${entry}.mcmeta`)
    } catch {
      animated = false
    }
    if (animated) throw new Error(`${entry} has an .mcmeta (animated textures are not supported)`)
    outputs.set(bookImageFile(id, level), { data, id, level, entry })
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

const rows = [...outputs].map(([file, { data, id, level, entry }]) => `| \`${file}\` | ${id} | ${level} | \`${entry}\` | \`${sha256(data).slice(0, 16)}\` |`)
// Separate paragraphs, or rendered Markdown would run the lines together.
const blockquote = (lines) => lines.map((line) => `> ${line}`).join('\n>\n')
const readmeSection = readme === null
  ? '(The pack has no README.txt.)'
  : `${blockquote(stripBom(readme.toString('utf8')).trim().split(/\r?\n/))}\n\nEnglish translation:\n\n${blockquote(README_TRANSLATION.lines)}`
const sources = `# Enchanted book image sources

The PNG files in this folder are images from the resource pack "${BOOK_IMAGE_PACK.title}" by ${BOOK_IMAGE_PACK.author}, licensed under ${BOOK_IMAGE_PACK.license} (Attribution-NonCommercial-NoDerivatives 4.0 International, ${BOOK_IMAGE_PACK.licenseUrl}). Parts of the book drawing have the same pixels as the Minecraft book image (\`item/enchanted_book.png\`, © Mojang Studios).

- Distribution page: ${BOOK_IMAGE_PACK.page}
- Pack: \`${packName}\` (SHA-256 \`${sha256(packBuffer)}\`)
- Generated by \`node scripts/extract-book-icons.mjs <pack.zip>\`; do not edit by hand. The images are chosen by \`src/ui/icons/bookImageTable.ts\` and the pack's \`${ITEMS_DEFINITION}\`.
- Each image is the file from the pack, unmodified. Only the file name is changed to this tool's enchantment ID and level (\`<id>_<level>.png\`).
- The app uses these images for books with a single enchantment. Books with several enchantments and books that stand for no particular enchantment (such as the add-book button) use the official book image (\`../items/enchanted_book.png\`).

## Terms of use

1. Non-commercial use only (no ads or paid features).
2. Credit the author, the distribution page and the license (in the "About this tool" dialog, opened from the page footer).
3. Do not modify the images (no cropping, recoloring or drawing over them). They are shown at integer scale with sharp pixels.

**Glint overlay**: The app draws the enchantment glint (\`../items/enchanted_glint_item.png\`) over these images, clipped to their shape, as the game does for enchanted books. Whether that counts as modification under the license was not confirmed with the author; on 2026-10-06 the decision was made to publish with the glint.

## The pack's README.txt

${readmeSection}

## Files

| File | Enchantment | Level | Path in the pack | SHA-256 (first 16 hex digits) |
|---|---|---|---|---|
${rows.join('\n')}
`

const expected = new Map([...[...outputs].map(([file, { data }]) => [file, data]), [SOURCES_FILE, Buffer.from(sources, 'utf8')]])
const present = existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []
const stale = present.filter((file) => (file.endsWith('.png') || file === SOURCES_FILE) && !expected.has(file))

if (check) {
  const differ = [...expected].filter(([file, data]) => !existsSync(path.join(OUT_DIR, file)) || !readFileSync(path.join(OUT_DIR, file)).equals(data)).map(([file]) => file)
  if (differ.length > 0 || stale.length > 0) {
    fail(`out of date: ${[...differ, ...stale.map((f) => `${f} (stale)`)].join(', ')}; run node scripts/extract-book-icons.mjs <pack.zip>`)
  }
  console.log(`extract-book-icons: ${expected.size} files are up to date`)
} else {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const file of stale) rmSync(path.join(OUT_DIR, file))
  for (const [file, data] of expected) writeFileSync(path.join(OUT_DIR, file), data)
  console.log(`extract-book-icons: wrote ${expected.size} files to ${path.relative(root, OUT_DIR)}${stale.length > 0 ? ` (removed ${stale.join(', ')})` : ''}`)
}
