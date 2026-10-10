export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Reports failures through return values instead of throwing, so the app keeps working without storage. */
export interface SafeStorage {
  /** null when the key is missing or cannot be read */
  read(key: string): string | null
  write(key: string, value: string): boolean
  remove(key: string): boolean
}

export function wrapStorage(storage: KeyValueStorage | null): SafeStorage {
  return {
    read(key) {
      if (!storage) return null
      try {
        return storage.getItem(key)
      } catch {
        return null
      }
    },
    write(key, value) {
      if (!storage) return false
      try {
        storage.setItem(key, value)
        return true
      } catch {
        return false
      }
    },
    remove(key) {
      if (!storage) return false
      try {
        storage.removeItem(key)
        return true
      } catch {
        return false
      }
    },
  }
}

/** null where merely accessing localStorage throws, as in some private browsing modes */
export function browserStorage(): KeyValueStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const ls = window.localStorage
    return {
      getItem: (key) => ls.getItem(key),
      setItem: (key, value) => ls.setItem(key, value),
      removeItem: (key) => ls.removeItem(key),
    }
  } catch {
    return null
  }
}

/** For tests. failWrites simulates storage that rejects writes. */
export function memoryStorage(initial: Record<string, string> = {}, options: { failWrites?: boolean } = {}): KeyValueStorage & {
  readonly data: Map<string, string>
} {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (options.failWrites) throw new Error('QuotaExceededError')
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

export function probeStorage(storage: SafeStorage): boolean {
  const key = 'kanatoko:probe'
  if (!storage.write(key, '1')) return false
  storage.remove(key)
  return true
}
