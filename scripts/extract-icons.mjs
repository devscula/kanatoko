#!/usr/bin/env node
// Copies the item images listed in src/ui/icons/itemImageTable.ts from client.jar (plus a few renders from
// minecraft.wiki) into src/ui/icons/items/ and writes SOURCES.md. Needs Node 22.18+ to import .ts.
//
// Usage: node scripts/extract-icons.mjs <client.jar> [--wiki-dir <dir>] [--check]
// The jar can also be given as MC_CLIENT_JAR. --wiki-dir reads <dir>/<name>.png instead of downloading the
// renders; --check only verifies the committed files. Client jars are listed in
// https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GLINT_TEXTURE, ITEM_IMAGE_TABLE, ITEM_MATERIAL } from '../src/ui/icons/itemImageTable.ts'
import { expectSquare, openZip, sha256 } from './lib/assets.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(root, 'src/ui/icons/items')
const SOURCES_FILE = 'SOURCES.md'

// The game draws these items with a 3D model, so there is no texture to copy; the wiki's inventory renders are
// 32x32, drawn at GUI scale 2.
const WIKI_RENDERS = {
  Invicon_Shield: {
    url: 'https://minecraft.wiki/images/Invicon_Shield.png',
    page: 'https://minecraft.wiki/w/File:Invicon_Shield.png',
  },
  Invicon_Carved_Pumpkin: {
    url: 'https://minecraft.wiki/images/Invicon_Carved_Pumpkin.png',
    page: 'https://minecraft.wiki/w/File:Invicon_Carved_Pumpkin.png',
  },
  Invicon_Creeper_Head: {
    url: 'https://minecraft.wiki/images/Invicon_Creeper_Head.png',
    page: 'https://minecraft.wiki/w/File:Invicon_Creeper_Head.png',
  },
}

const args = process.argv.slice(2)
const fail = (message) => {
  console.error(`extract-icons: ${message}`)
  process.exit(1)
}
const usage = 'usage: node scripts/extract-icons.mjs <client.jar> [--wiki-dir <dir>] [--check]   (or MC_CLIENT_JAR=<client.jar>)'
const check = args.includes('--check')
const wikiDirIndex = args.indexOf('--wiki-dir')
const wikiDir = wikiDirIndex >= 0 ? args[wikiDirIndex + 1] : undefined
if (wikiDirIndex >= 0 && wikiDir === undefined) fail(`--wiki-dir needs a directory\n${usage}`)
const positional = args.filter((a, i) => a !== '--check' && a !== '--wiki-dir' && !(wikiDirIndex >= 0 && i === wikiDirIndex + 1))
const unknownFlags = positional.filter((a) => a.startsWith('--'))
if (unknownFlags.length > 0) fail(`unknown option ${unknownFlags.join(' ')}\n${usage}`)
const jarPath = positional[0] ?? process.env.MC_CLIENT_JAR
if (positional.length > 1) fail(`unexpected arguments: ${positional.slice(1).join(' ')}\n${usage}`)
if (jarPath === undefined || jarPath === '') fail(`client.jar is required\n${usage}`)
if (!existsSync(jarPath)) fail(`not found: ${jarPath}`)

async function fetchRender(name) {
  const source = WIKI_RENDERS[name]
  if (source === undefined) throw new Error(`no download URL for the render ${name} (add it to WIKI_RENDERS)`)
  if (wikiDir !== undefined) return readFileSync(path.join(wikiDir, `${name}.png`))
  const response = await fetch(source.url, { headers: { 'User-Agent': 'kanatoko-extract-icons/1 (item icons for an anvil order calculator)' } })
  if (!response.ok) throw new Error(`download failed (${response.status}): ${source.url}; retry, or pass --wiki-dir with local copies`)
  return Buffer.from(await response.arrayBuffer())
}

const jarBuffer = readFileSync(jarPath)
const jar = openZip(jarBuffer)
const version = JSON.parse(jar.read('version.json').toString('utf8'))
const jarName = path.basename(jarPath)
const jarHash = sha256(jarBuffer)

const outputs = new Map()
const add = (file, data, px, item, source) => {
  const known = outputs.get(file)
  if (known !== undefined) {
    known.items.push(item)
    return
  }
  outputs.set(file, { data, px, items: [item], source })
}

try {
  for (const [item, def] of Object.entries(ITEM_IMAGE_TABLE)) {
    if (def.source.kind === 'texture') {
      const entry = `assets/minecraft/textures/${def.source.path}.png`
      const data = jar.read(entry)
      expectSquare(data, def.px, entry)
      add(def.file, data, def.px, item, `client.jar \`${entry}\``)
    } else {
      const data = await fetchRender(def.source.name)
      expectSquare(data, def.px, `${def.source.name}.png`)
      const { url, page } = WIKI_RENDERS[def.source.name]
      add(def.file, data, def.px, item, `minecraft.wiki [${def.source.name}.png](${page}) (${url})`)
    }
  }
  const glintEntry = `assets/minecraft/textures/${GLINT_TEXTURE.path}.png`
  const glint = jar.read(glintEntry)
  expectSquare(glint, GLINT_TEXTURE.px, glintEntry)
  const glintMeta = JSON.parse(jar.read(`${glintEntry}.mcmeta`).toString('utf8'))
  if (glintMeta?.texture?.blur !== true) console.warn(`extract-icons: ${glintEntry}.mcmeta no longer says "blur": true; check the glint CSS (image-rendering)`)
  add(GLINT_TEXTURE.file, glint, GLINT_TEXTURE.px, '(enchantment glint)', `client.jar \`${glintEntry}\``)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

const rows = [...outputs].map(
  ([file, { data, px, items, source }]) => `| \`${file}\` | ${items.join(', ')} | ${px}×${px} | ${source} | \`${sha256(data).slice(0, 16)}\` |`,
)
const sources = `# Item image sources

The PNG files in this folder are official Minecraft assets (© Mojang Studios). This tool is not an official Minecraft product and is not approved by or associated with Mojang or Microsoft.

- Generated by \`node scripts/extract-icons.mjs <client.jar>\`; do not edit by hand. The images to use are listed in \`src/ui/icons/itemImageTable.ts\`.
- client.jar: Java Edition ${version.id} (\`${jarName}\`, SHA-256 \`${jarHash}\`), the game client from Mojang's download servers.
- Material shown for armor and tools: \`${ITEM_MATERIAL}\`.
- The 16×16 images are the game's item textures. The 32×32 images are for items the game draws with a 3D model (shield, carved pumpkin, mob head): inventory renders from minecraft.wiki, drawn at GUI scale 2.
- \`enchanted_glint_item.png\` is the enchantment glint texture. The game scales it smoothly because its .mcmeta sets \`"blur": true\`.
- Both editions use the same images; Bedrock Edition looks nearly the same.

| File | Item type | Size | Source | SHA-256 (first 16 hex digits) |
|---|---|---|---|---|
${rows.join('\n')}
`

const expected = new Map([...[...outputs].map(([file, { data }]) => [file, data]), [SOURCES_FILE, Buffer.from(sources, 'utf8')]])
const present = existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []
const stale = present.filter((file) => (file.endsWith('.png') || file === SOURCES_FILE) && !expected.has(file))

if (check) {
  const differ = [...expected].filter(([file, data]) => !existsSync(path.join(OUT_DIR, file)) || !readFileSync(path.join(OUT_DIR, file)).equals(data)).map(([file]) => file)
  if (differ.length > 0 || stale.length > 0) {
    fail(`out of date: ${[...differ, ...stale.map((f) => `${f} (stale)`)].join(', ')}; run node scripts/extract-icons.mjs <client.jar>`)
  }
  console.log(`extract-icons: ${expected.size} files are up to date`)
} else {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const file of stale) rmSync(path.join(OUT_DIR, file))
  for (const [file, data] of expected) writeFileSync(path.join(OUT_DIR, file), data)
  console.log(`extract-icons: wrote ${expected.size} files to ${path.relative(root, OUT_DIR)}${stale.length > 0 ? ` (removed ${stale.join(', ')})` : ''}`)
}
