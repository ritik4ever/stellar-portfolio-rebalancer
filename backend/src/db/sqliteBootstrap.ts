/**
 * Shared SQLite bootstrap (SPR-2026-261).
 *
 * The backend keeps several independent SQLite connections (the main
 * DatabaseService, notification logs, idempotency keys and export schedules).
 * Each used to open `DB_PATH || './data/portfolio.db'` directly, so on a clean
 * checkout only `DatabaseService` created the parent directory: the other
 * consumers failed with the raw `unable to open database file` message, which
 * does not tell a contributor whether the path, its parent directory, the
 * permissions or the native binding is the problem.
 *
 * Every SQLite consumer now goes through `openSqliteDatabase`, which:
 *  - resolves the documented path (`DB_PATH` or `./data/portfolio.db`),
 *  - creates the parent directory on first use,
 *  - translates low-level errors into a `SqliteSetupError` carrying the
 *    resolved path, a remediation hint and the original cause.
 *
 * Runtime artifacts stay local: the directory is gitignored, and no prebuilt
 * database is required for a fresh checkout to boot.
 */
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Documented default used everywhere SQLite is configured. */
export const DEFAULT_SQLITE_DB_PATH = './data/portfolio.db'

/** SQLite's in-memory sentinel; it has no parent directory to create. */
const IN_MEMORY_PATH = ':memory:'

export interface SqliteSetupErrorOptions {
  dbPath: string
  hint: string
  cause?: unknown
}

/**
 * A SQLite database cannot be opened for a reason the contributor can fix.
 * `message` always names the resolved path; `hint` is the concrete next step.
 */
export class SqliteSetupError extends Error {
  readonly dbPath: string
  readonly hint: string

  constructor(message: string, options: SqliteSetupErrorOptions) {
    super(`${message} ${options.hint}`)
    this.name = 'SqliteSetupError'
    this.dbPath = options.dbPath
    this.hint = options.hint
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

/**
 * Resolve the SQLite path from the environment, matching the documented
 * precedence (`DB_PATH`, then `./data/portfolio.db`). Blank values fall back to
 * the default so `DB_PATH=` in an example env file cannot create a database
 * named after the current working directory.
 */
export function resolveSqliteDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DB_PATH?.trim()
  return configured && configured.length > 0 ? configured : DEFAULT_SQLITE_DB_PATH
}

/**
 * Create the parent directory of the SQLite database if it does not exist.
 *
 * Fails with an actionable `SqliteSetupError` when the parent exists but is a
 * file, or when the directory cannot be created (permissions, read-only mount,
 * container volume owned by another user).
 */
export function ensureSqliteDbDirectory(
  dbPath: string = resolveSqliteDbPath(),
  options: { create?: boolean } = {},
): void {
  if (dbPath === IN_MEMORY_PATH) return

  const resolvedPath = resolve(dbPath)
  const directory = dirname(resolvedPath)
  const create = options.create ?? true

  if (existsSync(directory)) {
    if (!statSync(directory).isDirectory()) {
      throw new SqliteSetupError(
        `Cannot use SQLite database "${resolvedPath}": its parent "${directory}" exists but is not a directory.`,
        {
          dbPath: resolvedPath,
          hint: `Move the file at "${directory}" aside or set DB_PATH to a writable path (for example ${DEFAULT_SQLITE_DB_PATH}).`,
        },
      )
    }
    return
  }

  if (!create) {
    throw new SqliteSetupError(
      `Cannot use SQLite database "${resolvedPath}": its parent directory "${directory}" does not exist.`,
      {
        dbPath: resolvedPath,
        hint: `Create "${directory}" or point DB_PATH at an existing writable directory (for example ${DEFAULT_SQLITE_DB_PATH}).`,
      },
    )
  }

  try {
    mkdirSync(directory, { recursive: true })
  } catch (error) {
    throw new SqliteSetupError(
      `Cannot create "${directory}" for SQLite database "${resolvedPath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        dbPath: resolvedPath,
        hint: `Set DB_PATH to a writable location (for example ${DEFAULT_SQLITE_DB_PATH}) and make sure the current user can write to it.`,
        cause: error,
      },
    )
  }
}

function translateOpenError(
  error: unknown,
  dbPath: string,
): SqliteSetupError {
  const message = error instanceof Error ? error.message : String(error)
  const resolvedPath = dbPath === IN_MEMORY_PATH ? dbPath : resolve(dbPath)

  if (/Could not locate the bindings file|was compiled against a different Node\.js version|invalid ELF header|not a valid Win32 application/i.test(message)) {
    return new SqliteSetupError(
      `Cannot load the SQLite driver for "${resolvedPath}": ${message}`,
      {
        dbPath: resolvedPath,
        hint:
          'The native better-sqlite3 binding is missing or built for another Node version. ' +
          'Run "npm rebuild better-sqlite3" in backend/ (the CI install command is "npm ci --ignore-scripts && npm rebuild better-sqlite3"), then retry.',
        cause: error,
      },
    )
  }

  if (/file is not a database|database disk image is malformed|database corruption|malformed database/i.test(message)) {
    return new SqliteSetupError(
      `Cannot open SQLite database "${resolvedPath}": the file is not a usable database (${message}).`,
      {
        dbPath: resolvedPath,
        hint:
          `This is local state, not repository content. Stop the backend, move the file aside (with its -wal/-shm companions), ` +
          'or restore it from a backup; the next start recreates the schema automatically.',
        cause: error,
      },
    )
  }

  if (/unable to open database file|directory does not exist|SQLITE_CANTOPEN/i.test(message)) {
    const directory = dirname(resolvedPath)
    return new SqliteSetupError(
      `Cannot open SQLite database "${resolvedPath}": the file or its directory "${directory}" is not writable.`,
      {
        dbPath: resolvedPath,
        hint:
          'Check that the directory exists, is writable by the current user and is not a read-only mount; ' +
          `or set DB_PATH to a writable path (for example ${DEFAULT_SQLITE_DB_PATH}).`,
        cause: error,
      },
    )
  }

  return new SqliteSetupError(
    `Cannot open SQLite database "${resolvedPath}": ${message}`,
    {
      dbPath: resolvedPath,
      hint: 'Verify DB_PATH points at a writable location on a local disk, then retry.',
      cause: error,
    },
  )
}

/**
 * Open the configured (or supplied) SQLite database, creating its parent
 * directory on first use. Prefer this over `new Database(...)` so every SQLite
 * consumer behaves the same way on a clean checkout and reports the same
 * actionable error when it cannot.
 */
export function openSqliteDatabase(
  dbPath: string = resolveSqliteDbPath(),
  options?: Database.Options,
): Database.Database {
  ensureSqliteDbDirectory(dbPath)

  try {
    return options ? new Database(dbPath, options) : new Database(dbPath)
  } catch (error) {
    throw translateOpenError(error, dbPath)
  }
}
