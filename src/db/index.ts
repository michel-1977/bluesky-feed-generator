import fs from 'fs'
import path from 'path'
import SqliteDb from 'better-sqlite3'
import { Kysely, Migrator, SqliteDialect } from 'kysely'
import { DatabaseSchema } from './schema'
import { migrationProvider } from './migrations'

const DEFAULT_BACKUP_DEBOUNCE_MS = 15000

type CreateDbOptions = {
  backupLocation?: string
  backupDebounceMs?: number
}

type DatabaseExtensions = {
  scheduleBackup: () => void
  flushBackup: () => Promise<void>
}

export type Database = Kysely<DatabaseSchema> & DatabaseExtensions

export const createDb = (
  location: string,
  options: CreateDbOptions = {},
): Database => {
  restoreBackupIfNeeded(location, options.backupLocation)

  const sqlite = new SqliteDb(location, {
    timeout: 30000,
  })
  sqlite.pragma('busy_timeout = 30000')
  if (location !== ':memory:') {
    sqlite.pragma('journal_mode = DELETE')
  }

  const kysely = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: sqlite,
    }),
  })

  const backupDebounceMs = Math.max(
    1000,
    options.backupDebounceMs ?? DEFAULT_BACKUP_DEBOUNCE_MS,
  )
  let backupTimer: NodeJS.Timeout | undefined
  let backupRequested = false
  let backupChain: Promise<void> = Promise.resolve()

  const flushBackup = async () => {
    if (!options.backupLocation || location === ':memory:' || !backupRequested) {
      return backupChain
    }

    backupRequested = false
    const targetPath = options.backupLocation

    backupChain = backupChain
      .catch(() => undefined)
      .then(async () => {
        ensureParentDirectory(targetPath)
        fs.copyFileSync(location, targetPath)
      })

    return backupChain
  }

  const scheduleBackup = () => {
    if (!options.backupLocation || location === ':memory:') return

    backupRequested = true
    if (backupTimer) return

    backupTimer = setTimeout(() => {
      backupTimer = undefined
      void flushBackup().catch((err) => {
        console.error('Failed to persist sqlite backup', err)
      })
    }, backupDebounceMs)
    backupTimer.unref?.()
  }

  const originalDestroy = kysely.destroy.bind(kysely)
  const destroy = async () => {
    if (backupTimer) {
      clearTimeout(backupTimer)
      backupTimer = undefined
    }

    await flushBackup()
    await originalDestroy()
  }

  return Object.assign(kysely, {
    destroy,
    flushBackup,
    scheduleBackup,
  })
}

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

const restoreBackupIfNeeded = (location: string, backupLocation?: string) => {
  if (!backupLocation || location === ':memory:' || backupLocation === ':memory:') {
    return
  }

  ensureParentDirectory(location)
  ensureParentDirectory(backupLocation)

  if (!fs.existsSync(backupLocation)) {
    return
  }

  const backupStat = fs.statSync(backupLocation)
  if (!backupStat.isFile() || backupStat.size <= 0) {
    return
  }

  const shouldRestore =
    !fs.existsSync(location) ||
    backupStat.mtimeMs >= fs.statSync(location).mtimeMs

  if (shouldRestore) {
    fs.copyFileSync(backupLocation, location)
  }
}

const ensureParentDirectory = (filePath: string) => {
  const directory = path.dirname(filePath)
  if (directory && directory !== '.') {
    fs.mkdirSync(directory, { recursive: true })
  }
}
