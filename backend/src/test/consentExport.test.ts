import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const envBackup = { ...process.env };

describe("consent export", () => {
  let testDbPath: string;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...envBackup };
    process.env.LEGAL_TERMS_VERSION = "2.1.0";
    process.env.LEGAL_PRIVACY_VERSION = "2.0.0";
    process.env.LEGAL_COOKIE_VERSION = "1.5.0";

    const testDir = join(
      tmpdir(),
      `stellar-consent-export-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "consent-export.db");
    process.env.DB_PATH = testDbPath;
  });

  afterEach(() => {
    process.env = { ...envBackup };
    if (existsSync(testDbPath)) {
      try {
        rmSync(testDbPath, { force: true });
      } catch {
        /* ignore */
      }
    }
    vi.restoreAllMocks();
  });

  it("buildConsentHistoryExport includes dates, versions, and grant/revoke history", async () => {
    const { DatabaseService } = await import("../services/databaseService.js");
    const { buildConsentHistoryExport } = await import(
      "../services/consentExportService.js"
    );

    const db = new DatabaseService();
    try {
      const userId = "GEXPORTTEST";
      db.recordConsent(userId, {
        terms: true,
        privacy: true,
        cookies: true,
        ipAddress: "127.0.0.1",
      });
      db.revokeConsent(userId, { ipAddress: "127.0.0.2" });

      const exportData = buildConsentHistoryExport(userId);

      expect(exportData.userId).toBe(userId);
      expect(exportData.exportedAt).toBeTruthy();
      expect(exportData.deployedPolicyVersions).toEqual({
        terms: "2.1.0",
        privacy: "2.0.0",
        cookies: "1.5.0",
      });
      expect(exportData.current?.termsAcceptedAt).toBeTruthy();
      expect(exportData.current?.revokedAt).toBeTruthy();
      expect(exportData.current?.policyVersions?.terms).toBe("2.1.0");
      expect(exportData.history).toHaveLength(2);
      expect(exportData.history[0].action).toBe("grant");
      expect(exportData.history[0].timestamp).toBeTruthy();
      expect(exportData.history[0].policyVersions?.privacy).toBe("2.0.0");
      expect(exportData.history[1].action).toBe("revoke");
    } finally {
      db.close();
    }
  });

  it("formatConsentHistoryCsv emits snapshot and history rows", async () => {
    const { DatabaseService } = await import("../services/databaseService.js");
    const {
      buildConsentHistoryExport,
      formatConsentHistoryCsv,
    } = await import("../services/consentExportService.js");

    const db = new DatabaseService();
    try {
      const userId = "GCSVTEST";
      db.recordConsent(userId, { terms: true, privacy: true, cookies: true });

      const csv = formatConsentHistoryCsv(buildConsentHistoryExport(userId));

      expect(csv).toContain("record_type");
      expect(csv).toContain("snapshot");
      expect(csv).toContain("history");
      expect(csv).toContain("grant");
      expect(csv).toContain("2.1.0");
    } finally {
      db.close();
    }
  });
});
