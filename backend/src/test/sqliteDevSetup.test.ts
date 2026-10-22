/**
 * SPR-2026-261 – clean SQLite development setup.
 *
 * A fresh checkout has no `backend/data/` directory and no prebuilt database.
 * Every SQLite consumer must therefore create its own parent directory, and an
 * unusable path must fail with a message that names the path and the next step
 * instead of the raw better-sqlite3 error.
 *
 * Covered here:
 *  1. DB_PATH resolution and blank-value fallback.
 *  2. Directory creation for the default, nested and in-memory paths.
 *  3. Clear SqliteSetupError for a parent that is a file, and for a missing
 *     directory when creation is disabled.
 *  4. Repeatable opening of a brand-new database file.
 *  5. The notification, idempotency and export-schedule stores initialise on a
 *     clean checkout path (previously they threw "unable to open database file"
 *     when DatabaseService had not run first).
 *  6. The full DatabaseService bootstraps schema + seeds from nothing, twice.
 *  7. `runSqliteDevSetupValidation` reports the documented checks.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_SQLITE_DB_PATH,
  SqliteSetupError,
  ensureSqliteDbDirectory,
  openSqliteDatabase,
  resolveSqliteDbPath,
} from "../db/sqliteBootstrap.js";
import {
  closeIdempotencyDb,
  dbStoreIdempotencyResult,
} from "../db/idempotencyDb.js";
import {
  closeNotificationDb,
  dbGetNotificationPreferences,
  dbSaveNotificationPreferences,
} from "../db/notificationDb.js";
import {
  closeExportScheduleDb,
  dbListExportSchedulesForUser,
} from "../db/exportScheduleDb.js";
import { DatabaseService } from "../services/databaseService.js";
import { runSqliteDevSetupValidation } from "../../scripts/validate-sqlite-dev-setup.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "stellar-sqlite-setup-test-"));
});

afterEach(() => {
  closeNotificationDb();
  closeIdempotencyDb();
  closeExportScheduleDb();
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.DB_PATH;
});

describe("resolveSqliteDbPath", () => {
  it("defaults to the documented path when DB_PATH is unset", () => {
    expect(resolveSqliteDbPath({})).toBe(DEFAULT_SQLITE_DB_PATH);
  });

  it("falls back to the default for blank values", () => {
    expect(resolveSqliteDbPath({ DB_PATH: "   " })).toBe(DEFAULT_SQLITE_DB_PATH);
    expect(resolveSqliteDbPath({ DB_PATH: "" })).toBe(DEFAULT_SQLITE_DB_PATH);
  });

  it("uses an explicit DB_PATH, including the in-memory sentinel", () => {
    expect(resolveSqliteDbPath({ DB_PATH: "/tmp/x.db" })).toBe("/tmp/x.db");
    expect(resolveSqliteDbPath({ DB_PATH: ":memory:" })).toBe(":memory:");
  });
});

describe("ensureSqliteDbDirectory", () => {
  it("creates missing parent directories recursively", () => {
    const dbPath = join(workDir, "nested", "data", "portfolio.db");

    expect(existsSync(join(workDir, "nested"))).toBe(false);
    ensureSqliteDbDirectory(dbPath);

    expect(existsSync(join(workDir, "nested", "data"))).toBe(true);
  });

  it("is a no-op for the in-memory database", () => {
    expect(() => ensureSqliteDbDirectory(":memory:")).not.toThrow();
  });

  it("explains the next step when the parent directory is missing and creation is disabled", () => {
    const dbPath = join(workDir, "missing", "portfolio.db");

    try {
      ensureSqliteDbDirectory(dbPath, { create: false });
      throw new Error("expected ensureSqliteDbDirectory to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SqliteSetupError);
      const setupError = error as SqliteSetupError;
      expect(setupError.message).toContain(dbPath);
      expect(setupError.hint).toMatch(/DB_PATH|Create "/);
    }
  });

  it("rejects a parent path that is a regular file", () => {
    const blocker = join(workDir, "blocker");
    writeFileSync(blocker, "not a directory");

    expect(() => ensureSqliteDbDirectory(join(blocker, "portfolio.db"))).toThrowError(
      /exists but is not a directory/,
    );
  });
});

describe("openSqliteDatabase", () => {
  it("creates the directory and database file on a clean checkout", () => {
    const dbPath = join(workDir, "data", "portfolio.db");

    const db = openSqliteDatabase(dbPath);
    try {
      db.exec("CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY)");
    } finally {
      db.close();
    }

    expect(existsSync(dbPath)).toBe(true);
  });

  it("opens an existing database repeatedly (repeatable local startup)", () => {
    const dbPath = join(workDir, "data", "portfolio.db");

    const first = openSqliteDatabase(dbPath);
    first.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY)");
    first.prepare("INSERT INTO probe (id) VALUES (1)").run();
    first.close();

    const second = openSqliteDatabase(dbPath);
    try {
      const row = second.prepare("SELECT COUNT(*) AS count FROM probe").get() as {
        count: number;
      };
      expect(row.count).toBe(1);
    } finally {
      second.close();
    }
  });

  it("reports an unusable path with the resolved path and a remediation hint", () => {
    const blocker = join(workDir, "blocker");
    writeFileSync(blocker, "not a directory");
    const dbPath = join(blocker, "portfolio.db");

    try {
      openSqliteDatabase(dbPath);
      throw new Error("expected openSqliteDatabase to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SqliteSetupError);
      const setupError = error as SqliteSetupError;
      expect(setupError.dbPath).toBe(dbPath);
      expect(setupError.message).toContain(dbPath);
      expect(setupError.hint).toMatch(/DB_PATH|Move the file/);
    }
  });
});

describe("shared SQLite consumers on a clean checkout", () => {
  it("notification, idempotency and export-schedule stores create the path themselves", () => {
    process.env.DB_PATH = join(workDir, "data", "portfolio.db");

    // No DatabaseService boot first: each store must bootstrap its own file.
    expect(
      dbGetNotificationPreferences("user-clean-checkout"),
    ).toBeUndefined();
    dbSaveNotificationPreferences({
      userId: "user-clean-checkout",
      emailEnabled: false,
      webhookEnabled: false,
      events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true },
    });

    dbStoreIdempotencyResult(
      "clean-checkout-key",
      "hash",
      "POST",
      "/api/v1/rebalance",
      200,
      { ok: true },
    );

    expect(dbListExportSchedulesForUser("user-clean-checkout")).toEqual([]);

    expect(existsSync(join(workDir, "data", "portfolio.db"))).toBe(true);
  });
});

describe("DatabaseService clean bootstrap", () => {
  it("creates schema and seeds from nothing, and is repeatable", () => {
    const dbPath = join(workDir, "data", "portfolio.db");

    process.env.DB_PATH = dbPath;
    const first = new DatabaseService();
    let firstAssetCount = 0;
    try {
      const probe = openSqliteDatabase(dbPath);
      firstAssetCount = (
        probe.prepare("SELECT COUNT(*) AS count FROM assets").get() as { count: number }
      ).count;
      probe.close();
    } finally {
      first.close();
    }

    const second = new DatabaseService();
    let secondAssetCount = 0;
    try {
      const probe = openSqliteDatabase(dbPath);
      secondAssetCount = (
        probe.prepare("SELECT COUNT(*) AS count FROM assets").get() as { count: number }
      ).count;
      probe.close();
    } finally {
      second.close();
    }

    expect(firstAssetCount).toBeGreaterThan(0);
    expect(secondAssetCount).toBe(firstAssetCount);
  });

  it("surfaces a clear setup error instead of a raw driver message", () => {
    const blocker = join(workDir, "blocker");
    writeFileSync(blocker, "not a directory");
    process.env.DB_PATH = join(blocker, "portfolio.db");

    expect(() => new DatabaseService()).toThrowError(SqliteSetupError);
  });
});

describe("runSqliteDevSetupValidation", () => {
  it("passes every documented check against a throwaway directory", async () => {
    const report = await runSqliteDevSetupValidation({
      workDir: join(workDir, "validation"),
      keep: true,
    });

    expect(report.checks.filter((item) => !item.ok)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checks.map((item) => item.name)).toEqual([
      "default DB_PATH resolution",
      "clean checkout has no prebuilt database",
      "first start creates directory, database and schema",
      "second start is repeatable and does not duplicate seed data",
      "shared SQLite consumers initialise on the clean path",
      "unusable path returns an actionable setup error",
    ]);
  });
});
