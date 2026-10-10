#!/usr/bin/env node
// Generates src/data/gameData.generated.ts from data/. The parsing and validation live in
// src/data/buildGameData.ts so that the tests can run them too. Needs Node 22.18+ to import .ts.
//
// Usage: node scripts/gen-data.mjs [--check]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GENERATED_MODULE_PATH,
  SOURCE_DATA_PATHS,
  generateGameDataModule,
} from '../src/data/buildGameData.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const unknown = args.filter((a) => a !== '--check')
if (unknown.length > 0) {
  console.error(`gen-data: unknown argument ${unknown.join(' ')}\nusage: node scripts/gen-data.mjs [--check]`)
  process.exit(2)
}
const check = args.includes('--check')

const readJson = (relative) => JSON.parse(readFileSync(path.join(root, relative), 'utf8'))

let source
try {
  source = generateGameDataModule({
    enchantmentData: readJson(SOURCE_DATA_PATHS.enchantmentData),
    japaneseNames: readJson(SOURCE_DATA_PATHS.japaneseNames),
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const outFile = path.join(root, GENERATED_MODULE_PATH)
const current = existsSync(outFile) ? readFileSync(outFile, 'utf8') : null

if (check) {
  if (current === source) {
    console.log(`gen-data: ${GENERATED_MODULE_PATH} is up to date`)
    process.exit(0)
  }
  console.error(
    current === null
      ? `gen-data: ${GENERATED_MODULE_PATH} is missing. Run: npm run gen:data`
      : `gen-data: ${GENERATED_MODULE_PATH} differs from the source data. Run: npm run gen:data`,
  )
  process.exit(1)
}

if (current === source) {
  console.log(`gen-data: ${GENERATED_MODULE_PATH} is already up to date`)
} else {
  writeFileSync(outFile, source)
  console.log(`gen-data: wrote ${GENERATED_MODULE_PATH}`)
}
