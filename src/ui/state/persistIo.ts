import { parseInputDoc, parseJson } from './parse.ts'
import type { SafeStorage } from './storage.ts'
import type { InputDoc, InputState } from './types.ts'

export const STORAGE_KEYS = {
  input: 'kanatoko:v1:input',
  session: 'kanatoko:v1:session',
  prefs: 'kanatoko:v1:prefs',
  backup: 'kanatoko:v1:backup', // previous input for Restore previous input
} as const

/** uids are dropped and recreated on read. */
export function storedInput(input: InputState): unknown {
  return {
    ...input,
    ownedBooks: input.ownedBooks.map(({ enchantments, count, anvilUsesOverride }) => ({ enchantments, count, anvilUsesOverride })),
    extraItems: input.extraItems.map(({ enchantments, anvilUsesOverride }) => ({ enchantments, anvilUsesOverride })),
  }
}

export function writeJson(storage: SafeStorage, key: string, value: unknown): boolean {
  return storage.write(key, JSON.stringify(value))
}

export function writeBackup(storage: SafeStorage, doc: InputDoc): boolean {
  return writeJson(storage, STORAGE_KEYS.backup, { input: storedInput(doc.input), session: doc.session })
}

/** IDs not in the current data are appended to dropped. */
export function readBackup(storage: SafeStorage, dropped: string[] = []): InputDoc | null {
  return parseInputDoc(parseJson(storage.read(STORAGE_KEYS.backup)), dropped)
}

export function hasBackup(storage: SafeStorage): boolean {
  return readBackup(storage) !== null
}

/** For the reset after a render error. The current input goes to the backup first so it can be restored. */
export function clearStoredInput(storage: SafeStorage, current: InputDoc | null): void {
  if (current !== null) writeBackup(storage, current)
  storage.remove(STORAGE_KEYS.input)
}
