export type StoredShift = {
  id: string
  employeeId: string
  dateKey: string
  title: string
  start: number
  end: number
}

const DB_NAME = 'vibe-wfm-db'
const DB_VERSION = 1
const STORE_NAME = 'app_store'
const SHIFTS_KEY = 'shifts'

const isValidShift = (value: unknown): value is StoredShift => {
  if (!value || typeof value !== 'object') return false

  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.employeeId === 'string' &&
    typeof item.dateKey === 'string' &&
    typeof item.title === 'string' &&
    typeof item.start === 'number' &&
    typeof item.end === 'number'
  )
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
  })

const getFromStore = (db: IDBDatabase, key: string) =>
  new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(key)

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error(`Failed to read key: ${key}`))
  })

const putToStore = (db: IDBDatabase, key: string, value: unknown) =>
  new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.put(value, key)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(`Failed to write key: ${key}`))
  })

export const loadShiftsFromIndexedDb = async (): Promise<StoredShift[] | null> => {
  const db = await openDatabase()

  try {
    const data = await getFromStore(db, SHIFTS_KEY)

    if (!Array.isArray(data)) return null

    return data.filter(isValidShift)
  } finally {
    db.close()
  }
}

export const saveShiftsToIndexedDb = async (shifts: StoredShift[]): Promise<void> => {
  const db = await openDatabase()

  try {
    await putToStore(db, SHIFTS_KEY, shifts)
  } finally {
    db.close()
  }
}
