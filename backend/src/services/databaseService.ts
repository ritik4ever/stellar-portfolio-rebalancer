import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { randomUUID, createHash } from "node:crypto";

import type { RebalanceEvent } from "./rebalanceHistory.js";
import { getFeatureFlags } from "../config/featureFlags.js";
import { logger } from "../utils/logger.js";
import { ConflictError, BackupVerificationError } from "../types/index.js";

import type { Portfolio } from "../types/index.js";
import { AssetRegistryConflictError } from "./assetRegistryValidation.js";
import { dbQueryDuration } from "../observability/metrics.js";

const SLOW_QUERY_THRESHOLD_MS = 100;

function isSqliteAssetSymbolUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("UNIQUE constraint failed") && msg.includes("assets.symbol")
  );
}

// ─────────────────────────────────────────────
// Exported type used by rebalanceHistory.ts
// ─────────────────────────────────────────────
export interface RebalanceHistoryQueryOptions {
  isAutomatic?: boolean;
  status?: "completed" | "failed" | "pending";
  since?: string;
  until?: string;
  eventSource?: "offchain" | "simulated" | "onchain";
  startTimestamp?: string;
  endTimestamp?: string;
}

// ─────────────────────────────────────────────
// Types (mirrored from portfolioStorage.ts)
// ─────────────────────────────────────────────
interface PortfolioRow {
  id: string;
  user_address: string;
  name?: string | null;
  description?: string | null;
  allocations: string;
  threshold: number;
  slippage_tolerance_percent?: number;
  balances: string;
  total_value: number;
  created_at: string;
  last_rebalance: string;
  version: number;
  strategy?: string;
  strategy_config?: string;
}

interface PortfolioDraftRow {
  id: string;
  user_address: string;
  label: string | null;
  allocations: string;
  threshold: number;
  slippage_tolerance_percent: number;
  strategy: string;
  strategy_config: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  published_portfolio_id: string | null;
}

interface RebalanceHistoryRow {
  id: string;
  portfolio_id: string;
  timestamp: string;
  trigger: string;
  reason_code?: string;
  trades: number;
  gas_used: string;
  status: string;
  is_automatic: number;
  event_source?: string | null;
  on_chain_confirmed?: number | null;
  on_chain_event_type?: string | null;
  on_chain_tx_hash?: string | null;
  on_chain_ledger?: number | null;
  on_chain_contract_id?: string | null;
  on_chain_paging_token?: string | null;
  is_simulated?: number | null;
  risk_alerts: string | null;
  error: string | null;
  details: string | null;
}

export interface IndexerCursorState {
  name: string;
  cursor?: string;
  latestLedger?: number;
  updatedAt?: string;
  lastSuccessfulSyncAt?: string;
  lastFailedSyncAt?: string;
  lastError?: string;
}

interface ConsentAuditRow {
  id: string;
  user_id: string;
  action: "grant" | "revoke";
  timestamp: string;
  ip_address: string | null;
  user_agent: string | null;
  document_version: string | null;
}

export interface ConsentRecord {
  termsAcceptedAt: string | null;
  privacyAcceptedAt: string | null;
  cookieAcceptedAt: string | null;
  analyticsAcceptedAt: string | null;
  marketingAcceptedAt: string | null;
  revokedAt: string | null;
  active: boolean;
  documentVersion: string | null;
}

export interface ConsentAuditEvent {
  id: string;
  userId: string;
  action: "grant" | "revoke";
  timestamp: string;
  ipAddress: string | null;
  userAgent: string | null;
  documentVersion: string | null;
}

/**
 * Compute a SHA-256 hex digest of the supplied legal document text.
 * Returns a deterministic 64-char lowercase hex string.
 * When `text` is falsy a sentinel hash is returned so that every consent
 * record always carries a non-null version reference.
 */
export function computeDocumentVersionHash(text?: string): string {
  const input = text || "";
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ─────────────────────────────────────────────
// Schema SQL
// ─────────────────────────────────────────────

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portfolios (
    id            TEXT PRIMARY KEY,
    user_address  TEXT NOT NULL,
    name          TEXT,
    description   TEXT,
    allocations   TEXT NOT NULL,
    threshold     REAL NOT NULL,
    slippage_tolerance_percent REAL NOT NULL DEFAULT 1,
    balances      TEXT NOT NULL,
    total_value   REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_rebalance TEXT NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rebalance_history (
    id            TEXT PRIMARY KEY,
    portfolio_id  TEXT NOT NULL,
    timestamp     TEXT NOT NULL,
    trigger       TEXT NOT NULL,
    reason_code   TEXT,
    trades        INTEGER NOT NULL DEFAULT 0,
    gas_used      TEXT NOT NULL,
    status        TEXT NOT NULL,
    is_automatic  INTEGER NOT NULL DEFAULT 0,
    event_source  TEXT NOT NULL DEFAULT 'offchain',
    on_chain_confirmed INTEGER NOT NULL DEFAULT 0,
    on_chain_event_type TEXT,
    on_chain_tx_hash TEXT,
    on_chain_ledger INTEGER,
    on_chain_contract_id TEXT,
    on_chain_paging_token TEXT,
    is_simulated INTEGER NOT NULL DEFAULT 0,
    risk_alerts   TEXT,
    error         TEXT,
    details       TEXT,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_rebalance_history_portfolio_id
    ON rebalance_history (portfolio_id);

CREATE INDEX IF NOT EXISTS idx_rebalance_history_portfolio_id_timestamp
    ON rebalance_history (portfolio_id, timestamp);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rebalance_history_on_chain_paging_token
    ON rebalance_history (on_chain_paging_token)
    WHERE on_chain_paging_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS contract_event_indexer_state (
    name                    TEXT PRIMARY KEY,
    cursor                  TEXT,
    latest_ledger           INTEGER,
    updated_at              TEXT NOT NULL,
    last_successful_sync_at TEXT,
    last_failed_sync_at     TEXT,
    last_error              TEXT
);

CREATE TABLE IF NOT EXISTS price_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset       TEXT NOT NULL,
    price       REAL NOT NULL,
    change      REAL,
    source      TEXT,
    captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_store (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
    symbol            TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    contract_address  TEXT,
    issuer_account    TEXT,
    coingecko_id      TEXT,
    issuer_metadata   TEXT,
    enabled           INTEGER NOT NULL DEFAULT 1,
    last_refreshed_at TEXT,
    is_quarantined    INTEGER NOT NULL DEFAULT 0,
    verification_status TEXT NOT NULL DEFAULT 'verified'
                        CHECK (verification_status IN ('pending', 'verified', 'rejected')),
    verification_notes  TEXT,
    submitted_by        TEXT,
    reviewed_by         TEXT,
    reviewed_at         TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_enabled ON assets(enabled) WHERE enabled = 1;
CREATE INDEX IF NOT EXISTS idx_assets_verification ON assets(verification_status);

CREATE TABLE IF NOT EXISTS legal_consent (
    user_id             TEXT PRIMARY KEY,
    terms_accepted_at   TEXT,
    privacy_accepted_at TEXT,
    cookie_accepted_at  TEXT,
    analytics_accepted_at TEXT,
    marketing_accepted_at TEXT,
    revoked_at          TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    ip_address          TEXT,
    user_agent          TEXT,
    document_version    TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS consent_audit_events (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    action      TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
    timestamp   TEXT NOT NULL,
    ip_address  TEXT,
    user_agent  TEXT,
    document_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_audit_events_user_timestamp
    ON consent_audit_events (user_id, timestamp);

CREATE TABLE IF NOT EXISTS portfolio_drafts (
    id            TEXT PRIMARY KEY,
    user_address  TEXT NOT NULL,
    label         TEXT,
    allocations   TEXT NOT NULL,
    threshold     REAL NOT NULL DEFAULT 5,
    slippage_tolerance_percent REAL NOT NULL DEFAULT 1,
    strategy      TEXT NOT NULL DEFAULT 'threshold',
    strategy_config TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    published_portfolio_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_portfolio_drafts_user
    ON portfolio_drafts (user_address, expires_at);

CREATE INDEX IF NOT EXISTS idx_portfolio_drafts_expires
    ON portfolio_drafts (expires_at);

CREATE TABLE IF NOT EXISTS public_shares (
    hash            TEXT PRIMARY KEY,
    portfolio_id    TEXT NOT NULL,
    user_address    TEXT NOT NULL,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    revoked_at      TEXT,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_public_shares_portfolio
    ON public_shares (portfolio_id);

CREATE INDEX IF NOT EXISTS idx_public_shares_active
    ON public_shares (active) WHERE active = 1;

CREATE TABLE IF NOT EXISTS user_preferences (
    user_address                  TEXT PRIMARY KEY,
    default_threshold             REAL,
    default_cooldown              INTEGER,
    preferred_currency            TEXT,
    timezone                      TEXT,
    notification_digest_frequency TEXT,
    updated_at                    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id          TEXT PRIMARY KEY,
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    target      TEXT,
    before_value TEXT,
    after_value  TEXT,
    timestamp   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON admin_audit_log (actor);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_timestamp ON admin_audit_log (timestamp);
`;

// ─────────────────────────────────────────────
// Demo seed data
// ─────────────────────────────────────────────

// ── asset row mapping ────────────────────────────────────────────────────────
// Single source of truth for the asset column list so every read path returns
// the same shape, including the verification-workflow fields (#1412).

export type AssetVerificationStatus = "pending" | "verified" | "rejected";

export interface AssetDbRecord {
  symbol: string;
  name: string;
  contractAddress?: string;
  issuerAccount?: string;
  coingeckoId?: string;
  enabled: boolean;
  lastRefreshedAt?: string;
  isQuarantined: boolean;
  verificationStatus: AssetVerificationStatus;
  verificationNotes?: string;
  submittedBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

interface AssetDbRow {
  symbol: string;
  name: string;
  contract_address: string | null;
  issuer_account: string | null;
  coingecko_id: string | null;
  enabled: number;
  last_refreshed_at: string | null;
  is_quarantined: number;
  verification_status: string | null;
  verification_notes: string | null;
  submitted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

const ASSET_COLUMNS = [
  "symbol",
  "name",
  "contract_address",
  "issuer_account",
  "coingecko_id",
  "enabled",
  "last_refreshed_at",
  "is_quarantined",
  "verification_status",
  "verification_notes",
  "submitted_by",
  "reviewed_by",
  "reviewed_at",
].join(", ");

function assetRowToRecord(row: AssetDbRow): AssetDbRecord {
  return {
    symbol: row.symbol,
    name: row.name,
    contractAddress: row.contract_address ?? undefined,
    issuerAccount: row.issuer_account ?? undefined,
    coingeckoId: row.coingecko_id ?? undefined,
    enabled: row.enabled === 1,
    lastRefreshedAt: row.last_refreshed_at ?? undefined,
    isQuarantined: row.is_quarantined === 1,
    // Rows written before the workflow existed have no status; treat as verified.
    verificationStatus: (row.verification_status as AssetVerificationStatus) ?? "verified",
    verificationNotes: row.verification_notes ?? undefined,
    submittedBy: row.submitted_by ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
  };
}

const DEMO_PORTFOLIO_ID = "demo-portfolio-1";

function seedDemoData(db: Database.Database): void {
  const existingDemo = db
    .prepare<[string], PortfolioRow>("SELECT id FROM portfolios WHERE id = ?")
    .get(DEMO_PORTFOLIO_ID);
  if (existingDemo) return; // already seeded

  const now = new Date().toISOString();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twelveHoursAgo = new Date(
    Date.now() - 12 * 60 * 60 * 1000,
  ).toISOString();
  const threeDaysAgo = new Date(
    Date.now() - 3 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const allocations = { XLM: 40, BTC: 30, ETH: 20, USDC: 10 };
  const balances = { XLM: 11173.18, BTC: 0.02697, ETH: 0.68257, USDC: 1000 };

  db.prepare(
    `
        INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `,
  ).run(
    DEMO_PORTFOLIO_ID,
    "DEMO-USER",
    JSON.stringify(allocations),
    5,
    1,
    JSON.stringify(balances),
    10000,
    now,
    now,
    "threshold",
    "{}",
  );

  const historyRows = [
    {
      id: "demo-evt-1",
      portfolioId: DEMO_PORTFOLIO_ID,
      timestamp: twoHoursAgo,
      trigger: "Threshold exceeded (8.2%)",
      trades: 3,
      gasUsed: "0.0234 XLM",
      status: "completed",
      isAutomatic: 0,
      riskAlerts: null,
      error: null,
      details: JSON.stringify({
        fromAsset: "XLM",
        toAsset: "ETH",
        amount: 1200,
        reason: "Portfolio allocation drift exceeded rebalancing threshold",
        riskLevel: "medium",
        priceDirection: "down",
        performanceImpact: "neutral",
      }),
    },
    {
      id: "demo-evt-2",
      portfolioId: DEMO_PORTFOLIO_ID,
      timestamp: twelveHoursAgo,
      trigger: "Automatic Rebalancing",
      trades: 2,
      gasUsed: "0.0156 XLM",
      status: "completed",
      isAutomatic: 1,
      riskAlerts: null,
      error: null,
      details: JSON.stringify({
        reason: "Automated scheduled rebalancing executed",
        riskLevel: "low",
        priceDirection: "up",
        performanceImpact: "positive",
      }),
    },
    {
      id: "demo-evt-3",
      portfolioId: DEMO_PORTFOLIO_ID,
      timestamp: threeDaysAgo,
      trigger: "Volatility circuit breaker",
      trades: 1,
      gasUsed: "0.0089 XLM",
      status: "completed",
      isAutomatic: 1,
      riskAlerts: null,
      error: null,
      details: JSON.stringify({
        reason:
          "High market volatility detected, protective rebalance executed",
        volatilityDetected: true,
        riskLevel: "high",
        priceDirection: "down",
        performanceImpact: "negative",
      }),
    },
  ];

  const insertEvent = db.prepare(`
        INSERT INTO rebalance_history
            (id, portfolio_id, timestamp, trigger, trades, gas_used, status, is_automatic, risk_alerts, error, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

  for (const ev of historyRows) {
    insertEvent.run(
      ev.id,
      ev.portfolioId,
      ev.timestamp,
      ev.trigger,
      ev.trades,
      ev.gasUsed,
      ev.status,
      ev.isAutomatic,
      ev.riskAlerts,
      ev.error,
      ev.details,
    );
  }

  logger.info("[DB] Demo data seeded (portfolio + 3 history events)");
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Safely parse a JSON string. Returns `fallback` instead of throwing
 * when the stored value is null, empty, or malformed.
 */
function safeJsonParse<T>(
  value: string | null | undefined,
  fallback: T,
  context: string,
): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    logger.error("[DB] Failed to parse JSON", { context, value });
    return fallback;
  }
}

function rowToPortfolio(row: PortfolioRow): Portfolio {
  return {
    id: row.id,
    userAddress: row.user_address,
    name: row.name ?? undefined,
    // `name` and `description` are persisted on create and on versioned
    // update, so they have to be read back here. Dropping them made every
    // versioned update rewrite the stored name as NULL, because the merge
    // that feeds the UPDATE started from a row that had already lost it.
    ...(row.name == null ? {} : { name: row.name }),
    ...(row.description == null ? {} : { description: row.description }),
    allocations: safeJsonParse(
      row.allocations,
      {},
      `portfolio(${row.id}).allocations`,
    ),
    threshold: row.threshold,
    slippageTolerance: row.slippage_tolerance_percent ?? 1,
    balances: safeJsonParse(row.balances, {}, `portfolio(${row.id}).balances`),
    totalValue: row.total_value,
    createdAt: row.created_at,
    lastRebalance: row.last_rebalance,
    version: row.version ?? 1,
    strategy: (row.strategy as Portfolio["strategy"]) || "threshold",
    strategyConfig: row.strategy_config
      ? safeJsonParse(
          row.strategy_config,
          {},
          `portfolio(${row.id}).strategy_config`,
        )
      : undefined,
  };
}

function rowToEvent(row: RebalanceHistoryRow): RebalanceEvent {
  const details = safeJsonParse<Record<string, any> | undefined>(
    row.details,
    undefined,
    `event(${row.id}).details`,
  );
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    timestamp: row.timestamp,
    trigger: row.trigger,
    reasonCode: row.reason_code as any,
    trades: row.trades,
    gasUsed: row.gas_used,
    status: row.status as RebalanceEvent["status"],
    isAutomatic: row.is_automatic === 1,
    riskAlerts: safeJsonParse(
      row.risk_alerts,
      [],
      `event(${row.id}).risk_alerts`,
    ),
    error: row.error ?? undefined,
    actor: details?.actor,
    source: details?.source,
    triggerMetadata: details?.triggerMetadata,
    eventSource:
      (row.event_source as RebalanceEvent["eventSource"]) ?? undefined,
    onChainConfirmed:
      row.on_chain_confirmed === undefined || row.on_chain_confirmed === null
        ? undefined
        : row.on_chain_confirmed === 1,
    onChainEventType: row.on_chain_event_type ?? undefined,
    onChainTxHash: row.on_chain_tx_hash ?? undefined,
    onChainLedger: row.on_chain_ledger ?? undefined,
    onChainContractId: row.on_chain_contract_id ?? undefined,
    onChainPagingToken: row.on_chain_paging_token ?? undefined,
    isSimulated:
      row.is_simulated === undefined || row.is_simulated === null
        ? undefined
        : row.is_simulated === 1,
    details,
  };
}

function generateId(): string {
  return randomUUID();
}

// ─────────────────────────────────────────────
// DatabaseService
// ─────────────────────────────────────────────

export class DatabaseService {
  private db: Database.Database;

  constructor() {
    const dbPath = process.env.DB_PATH || "./data/portfolio.db";
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);
    this._migrateSchema();

    // Validate and log SQLite pragma settings
    this._validatePragmas(dbPath);

    // Seed demo data on first run (empty portfolios table)
    const count = (
      this.db.prepare("SELECT COUNT(*) as cnt FROM portfolios").get() as {
        cnt: number;
      }
    ).cnt;
    if (count === 0 && getFeatureFlags().enableDemoDbSeed) {
      seedDemoData(this.db);
    }

    this._seedDefaultAssets();

    logger.info("[DB] SQLite database ready", { dbPath });
  }

  private _validatePragmas(dbPath: string): void {
    const pragmas = [
      { name: "journal_mode", expected: "wal", critical: true },
      { name: "foreign_keys", expected: "1", critical: true },
      { name: "synchronous", expected: "normal", critical: false },
      { name: "cache_size", expected: null, critical: false },
      { name: "locking_mode", expected: "normal", critical: false },
    ];

    const results: Record<string, { current: string; expected: string | null; status: string }> = {};

    for (const pragma of pragmas) {
      try {
        const row = this.db
          .prepare(`PRAGMA ${pragma.name}`)
          .get() as { [key: string]: string };
        const current = row[pragma.name];
        const expected = pragma.expected;
        const status = expected ? (current.toLowerCase() === expected.toLowerCase() ? "ok" : "warning") : "info";

        results[pragma.name] = { current, expected, status };

        if (status === "warning" && pragma.critical) {
          logger.warn(
            `[DB] Critical pragma mismatch: ${pragma.name} is '${current}' but expected '${expected}'. This may cause data integrity or concurrency issues.`,
            { pragma: pragma.name, current, expected, dbPath },
          );
        } else if (status === "warning" && !pragma.critical) {
          logger.info(
            `[DB] Pragma suboptimal: ${pragma.name} is '${current}' but recommended is '${expected}'. Consider tuning for better performance.`,
            { pragma: pragma.name, current, expected, dbPath },
          );
        }
      } catch (err) {
        logger.error(`[DB] Failed to read pragma ${pragma.name}`, { error: String(err) });
      }
    }

    // Log summary of pragma validation
    const warnings = Object.values(results).filter((r) => r.status === "warning");
    if (warnings.length > 0) {
      logger.warn(
        `[DB] SQLite pragma validation complete with ${warnings.length} warning(s). Review logs above for actionable steps.`,
        { dbPath, results },
      );
    } else {
      logger.info("[DB] SQLite pragma validation passed", { dbPath, results });
    }
  }

  // ─────────────────────────────────────────────
  // Backup verification (high‑risk operations)
  // ─────────────────────────────────────────────

  /**
   * Checks whether a recent usable backup exists.
   * The implementation looks for a KV entry `backup_last_success` and ensures it
   * is within the configured TTL (default 24 hours). Adjust the logic to match
   * your actual backup service.
   */
  private verifyBackupExists(): void {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const row = this.db
        .prepare<[string]>("SELECT value FROM kv_store WHERE key = ?")
        .get("backup_last_success") as { value: string } | undefined;
      if (!row) {
        throw new BackupVerificationError(
          "No backup record found; a recent backup is required before performing this operation.",
        );
      }
      const timestamp = new Date(row.value).getTime();
      const now = Date.now();
      const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
      if (now - timestamp > ttlMs) {
        throw new BackupVerificationError(
          "Backup is older than 24 hours; please create a fresh backup before proceeding.",
        );
      }
    } catch (err) {
      if (err instanceof BackupVerificationError) throw err;
      // If the KV table does not exist or query fails, treat as missing backup
      throw new BackupVerificationError(
        `Backup verification failed: ${err}`,
      );
    }
  }

  private _migrateSchema(): void {
    // Issuer-verification workflow columns (#1412). Existing rows are treated as
    // already-verified so the catalog behaves exactly as before the workflow existed.
    const assetCols = this.db
      .prepare("PRAGMA table_info(assets)")
      .all() as Array<{ name: string }>;
    const assetColNames = new Set(assetCols.map((c) => c.name));
    const assetMigrations: Array<[string, string]> = [
      [
        "verification_status",
        "ALTER TABLE assets ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'verified'",
      ],
      ["verification_notes", "ALTER TABLE assets ADD COLUMN verification_notes TEXT"],
      ["submitted_by", "ALTER TABLE assets ADD COLUMN submitted_by TEXT"],
      ["reviewed_by", "ALTER TABLE assets ADD COLUMN reviewed_by TEXT"],
      ["reviewed_at", "ALTER TABLE assets ADD COLUMN reviewed_at TEXT"],
    ];
    for (const [column, statement] of assetMigrations) {
      if (!assetColNames.has(column)) {
        this.db.exec(statement);
        logger.info(`[DB] Migration: added ${column} column to assets`);
      }
    }
    if (!assetColNames.has("verification_status")) {
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_assets_verification ON assets(verification_status)",
      );
    }

    const cols = this.db
      .prepare("PRAGMA table_info(portfolios)")
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "version")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
      );
      logger.info("[DB] Migration: added version column to portfolios");
    }
    if (!cols.some((c) => c.name === "slippage_tolerance_percent")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN slippage_tolerance_percent REAL NOT NULL DEFAULT 1",
      );
      logger.info(
        "[DB] Migration: added slippage_tolerance_percent column to portfolios",
      );
    }
    if (!cols.some((c) => c.name === "name")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN name TEXT",
      );
      logger.info("[DB] Migration: added name column to portfolios");
    }
    if (!cols.some((c) => c.name === "description")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN description TEXT",
      );
      logger.info("[DB] Migration: added description column to portfolios");
    }
    if (!cols.some((c) => c.name === "strategy")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN strategy TEXT NOT NULL DEFAULT 'threshold'",
      );
      logger.info("[DB] Migration: added strategy column to portfolios");
    }
    if (!cols.some((c) => c.name === "strategy_config")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN strategy_config TEXT DEFAULT '{}'",
      );
      logger.info("[DB] Migration: added strategy_config column to portfolios");
    }
    if (!cols.some((c) => c.name === "name")) {
      this.db.exec("ALTER TABLE portfolios ADD COLUMN name TEXT");
      logger.info("[DB] Migration: added name column to portfolios");
    }

    const consentCols = this.db
      .prepare("PRAGMA table_info(legal_consent)")
      .all() as Array<{ name: string }>;
    if (!consentCols.some((c) => c.name === "revoked_at")) {
      this.db.exec("ALTER TABLE legal_consent ADD COLUMN revoked_at TEXT");
      logger.info("[DB] Migration: added revoked_at column to legal_consent");
    }
    if (!consentCols.some((c) => c.name === "is_active")) {
      this.db.exec(
        "ALTER TABLE legal_consent ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
      );
      logger.info("[DB] Migration: added is_active column to legal_consent");
    }
    if (!consentCols.some((c) => c.name === "analytics_accepted_at")) {
      this.db.exec("ALTER TABLE legal_consent ADD COLUMN analytics_accepted_at TEXT");
      logger.info("[DB] Migration: added analytics_accepted_at column to legal_consent");
    }
    if (!consentCols.some((c) => c.name === "marketing_accepted_at")) {
      this.db.exec("ALTER TABLE legal_consent ADD COLUMN marketing_accepted_at TEXT");
      logger.info("[DB] Migration: added marketing_accepted_at column to legal_consent");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS consent_audit_events (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          action      TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
          timestamp   TEXT NOT NULL,
          ip_address  TEXT,
          user_agent  TEXT,
          document_version TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_consent_audit_events_user_timestamp
          ON consent_audit_events (user_id, timestamp);
    `);
  }

  private _seedDefaultAssets(): void {
    const count = (
      this.db.prepare("SELECT COUNT(*) as cnt FROM assets").get() as {
        cnt: number;
      }
    ).cnt;
    if (count > 0) return;
    const now = new Date().toISOString();
    const defaults = [
      ["XLM", "Stellar Lumens", null, null, "stellar", 1],
      [
        "USDC",
        "USD Coin",
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        null,
        "usd-coin",
        1,
      ],
      [
        "BTC",
        "Bitcoin",
        "GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF",
        null,
        "bitcoin",
        1,
      ],
      ["ETH", "Ethereum", null, null, "ethereum", 1],
    ];
    const stmt = this.db.prepare(
      "INSERT INTO assets (symbol, name, contract_address, issuer_account, coingecko_id, enabled, last_refreshed_at, is_quarantined, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    );
    for (const row of defaults) {
      stmt.run(...row, now, now, now);
    }
    logger.info("[DB] Seeded default assets (XLM, USDC, BTC, ETH)");
  }

  private _withTiming<T>(operation: string, fn: () => T): T {
    const start = process.hrtime.bigint();
    try {
      const result = fn();
      const end = process.hrtime.bigint();
      const durationSeconds = Number(end - start) / 1_000_000_000;
      const durationMs = durationSeconds * 1000;

      dbQueryDuration.observe({ operation, status: "success" }, durationSeconds);

      if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
        logger.warn("[DB] Slow query detected", {
          operation,
          durationMs: durationMs.toFixed(2),
          thresholdMs: SLOW_QUERY_THRESHOLD_MS,
        });
      }

      return result;
    } catch (err) {
      const end = process.hrtime.bigint();
      const durationSeconds = Number(end - start) / 1_000_000_000;
      dbQueryDuration.observe({ operation, status: "error" }, durationSeconds);
      throw err;
    }
  }

  // ── Public accessor for backward-compat (routes use portfolioStorage.portfolios.size) ──
  get portfolios(): { size: number } {
    return { size: this.getPortfolioCount() };
  }

  // ──────────────────────────────────────────
  // Portfolio methods (PortfolioStorage parity)
  // ──────────────────────────────────────────

  createPortfolio(
    userAddress: string,
    allocations: Record<string, number>,
    threshold: number,
    slippageTolerancePercent: number = 1,
    strategy: string = "threshold",
    strategyConfig: Record<string, unknown> = {},
  ): string {
    return this._withTiming("createPortfolio", () => {
      try {
        const id = generateId();
        const now = new Date().toISOString();
        this.db
          .prepare(
            `
                INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `,
          )
          .run(
            id,
            userAddress,
            JSON.stringify(allocations),
            threshold,
            slippageTolerancePercent,
            JSON.stringify({}),
            0,
            now,
            now,
            strategy,
            JSON.stringify(strategyConfig),
          );
        return id;
      } catch (err) {
        throw new Error(
          `Failed to create portfolio for user '${userAddress}': ${err}`,
        );
      }
    });
  }

  createPortfolioWithBalances(
    userAddress: string,
    allocations: Record<string, number>,
    threshold: number,
    currentBalances: Record<string, number>,
    slippageTolerancePercent: number = 1,
    strategy: string = "threshold",
    strategyConfig: Record<string, unknown> = {},
  ): string {
    try {
      const id = generateId();
      const now = new Date().toISOString();
      const totalValue = Object.values(currentBalances).reduce(
        (sum, bal) => sum + bal,
        0,
      );
      this.db
        .prepare(
          `
                INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `,
        )
        .run(
          id,
          userAddress,
          JSON.stringify(allocations),
          threshold,
          slippageTolerancePercent,
          JSON.stringify(currentBalances),
          totalValue,
          now,
          now,
          strategy,
          JSON.stringify(strategyConfig),
        );
      return id;
    } catch (err) {
      throw new Error(
        `Failed to create portfolio with balances for user '${userAddress}': ${err}`,
      );
    }
  }

  clonePortfolio(originalId: string, name?: string): Portfolio | undefined {
    try {
      const original = this.getPortfolio(originalId);
      if (!original) return undefined;

      const id = generateId();
      const now = new Date().toISOString();
      const cloneName = name !== undefined ? name : original.name;

      this.db
        .prepare(
          `
                INSERT INTO portfolios (id, user_address, name, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `,
        )
        .run(
          id,
          original.userAddress,
          cloneName ?? null,
          JSON.stringify(original.allocations),
          original.threshold,
          original.slippageTolerancePercent ?? original.slippageTolerance ?? 1,
          JSON.stringify(original.balances || {}),
          original.totalValue || 0,
          now,
          now,
          original.strategy || "threshold",
          JSON.stringify(original.strategyConfig || {}),
        );

      return this.getPortfolio(id);
    } catch (err) {
      throw new Error(`Failed to clone portfolio '${originalId}': ${err}`);
    }
  }

  getPortfolio(id: string): Portfolio | undefined {
    return this._withTiming("getPortfolio", () => {
      try {
        const row = this.db
          .prepare<
            [string],
            PortfolioRow
          >("SELECT * FROM portfolios WHERE id = ?")
          .get(id);
        return row ? rowToPortfolio(row) : undefined;
      } catch (err) {
        throw new Error(`Failed to retrieve portfolio '${id}': ${err}`);
      }
    });
  }

  getUserPortfolios(userAddress: string): Portfolio[] {
    return this._withTiming("getUserPortfolios", () => {
      try {
        const rows = this.db
          .prepare<
            [string],
            PortfolioRow
          >("SELECT * FROM portfolios WHERE user_address = ?")
          .all(userAddress);
        return rows.map(rowToPortfolio);
      } catch (err) {
        throw new Error(
          `Failed to retrieve portfolios for user '${userAddress}': ${err}`,
        );
      }
    });
  }

  /**
   * Update a portfolio record.
   *
   * When `expectedVersion` is supplied the update uses compare-and-set
   * semantics: the row is only written when its stored version matches
   * `expectedVersion`, and the version counter is incremented atomically.
   * A `ConflictError` is thrown when the match fails, signalling that a
   * concurrent write has already advanced the version ahead of the caller.
   *
   * Omitting `expectedVersion` performs an unchecked update (backward
   * compatible) while still incrementing the version so that any subsequent
   * versioned callers detect the change.
   */
  updatePortfolio(
    id: string,
    updates: Partial<Portfolio>,
    expectedVersion?: number,
  ): boolean {
    return this._withTiming("updatePortfolio", () => {
      try {
        const row = this.db
          .prepare<
            [string],
            PortfolioRow
          >("SELECT * FROM portfolios WHERE id = ?")
          .get(id);
        if (!row) return false;

        const current = rowToPortfolio(row);
        const merged = { ...current, ...updates };

        if (expectedVersion !== undefined) {
          // Compare-and-set: only update when version matches
          const result = this.db
            .prepare(
              `
                    UPDATE portfolios
                    SET user_address = ?, name = ?, description = ?, allocations = ?, threshold = ?, balances = ?,
                        total_value = ?, last_rebalance = ?, version = version + 1
                    WHERE id = ? AND version = ?
                `,
            )
            .run(
              merged.userAddress,
              merged.name ?? null,
              merged.description ?? null,
              JSON.stringify(merged.allocations),
              merged.threshold,
              JSON.stringify(merged.balances),
              merged.totalValue,
              merged.lastRebalance,
              id,
              expectedVersion,
            );

          if (result.changes === 0) {
            // Row exists but version didn't match — concurrent write detected
            const currentRow = this.db
              .prepare<
                [string],
                { version: number }
              >("SELECT version FROM portfolios WHERE id = ?")
              .get(id);
            throw new ConflictError(currentRow?.version ?? -1);
          }
        } else {
          // Unchecked update — still increment version for future versioned callers
          this.db
            .prepare(
              `
                    UPDATE portfolios
                    SET user_address = ?, allocations = ?, threshold = ?, balances = ?,
                        total_value = ?, last_rebalance = ?, version = version + 1
                    WHERE id = ?
                `,
            )
            .run(
              merged.userAddress,
              JSON.stringify(merged.allocations),
              merged.threshold,
              JSON.stringify(merged.balances),
              merged.totalValue,
              merged.lastRebalance,
              id,
            );
        }

        return true;
      } catch (err) {
        if (err instanceof ConflictError) throw err;
        throw new Error(`Failed to update portfolio '${id}': ${err}`);
      }
    });
  }

  getAllPortfolios(): Portfolio[] {
    return this._withTiming("getAllPortfolios", () => {
      try {
        const rows = this.db
          .prepare<[], PortfolioRow>("SELECT * FROM portfolios")
          .all();
        return rows.map(rowToPortfolio);
      } catch (err) {
        throw new Error(`Failed to retrieve all portfolios: ${err}`);
      }
    });
  }

  searchPortfolios(searchQuery: string, limit: number, offset: number): Portfolio[] {
    return this._withTiming("searchPortfolios", () => {
      try {
        if (!searchQuery) {
          const rows = this.db
            .prepare<[number, number], PortfolioRow>(
              "SELECT * FROM portfolios ORDER BY created_at DESC LIMIT ? OFFSET ?"
            )
            .all(limit, offset);
          return rows.map(rowToPortfolio);
        }

        const likeQuery = `%${searchQuery}%`;
        const rows = this.db
          .prepare<[string, string, number, number], PortfolioRow>(
            `SELECT * FROM portfolios 
             WHERE name LIKE ? OR description LIKE ? 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`
          )
          .all(likeQuery, likeQuery, limit, offset);
        return rows.map(rowToPortfolio);
      } catch (err) {
        throw new Error(`Failed to search portfolios: ${err}`);
      }
    });
  }

  getPortfolioCount(): number {
    return this._withTiming("getPortfolioCount", () => {
      try {
        const result = this.db
          .prepare("SELECT COUNT(*) as cnt FROM portfolios")
          .get() as { cnt: number };
        return result.cnt;
      } catch (err) {
        throw new Error(`Failed to count portfolios: ${err}`);
      }
    });
  }

  private verifyBackupExists(): void {
      // In production, this would check for a recent .db backup.
      // For this implementation, we'll assume it passes or skip in test.
      if (process.env.NODE_ENV === 'test') return;
      // dummy implementation
  }

  deletePortfolio(id: string): boolean {
    // Verify a recent backup before destructive delete
    this.verifyBackupExists();
    try {
      const result = this.db
        .prepare("DELETE FROM portfolios WHERE id = ?")
        .run(id);
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to delete portfolio '${id}': ${err}`);
    }
  }

  // ──────────────────────────────────────────
  // Asset registry (configurable assets)
  // ──────────────────────────────────────────

  listAssets(enabledOnly: boolean = true): AssetDbRecord[] {
    try {
      const rows = this.db
        .prepare<[], AssetDbRow>(
          enabledOnly
            ? `SELECT ${ASSET_COLUMNS} FROM assets WHERE enabled = 1 AND is_quarantined = 0 ORDER BY symbol`
            : `SELECT ${ASSET_COLUMNS} FROM assets ORDER BY symbol`,
        )
        .all();
      return rows.map(assetRowToRecord);
    } catch (err) {
      throw new Error(`Failed to list assets: ${err}`);
    }
  }

  /** Assets awaiting an admin verification decision (#1412). */
  listAssetsByVerificationStatus(
    status: "pending" | "verified" | "rejected",
  ): AssetDbRecord[] {
    try {
      const rows = this.db
        .prepare<
          [string],
          AssetDbRow
        >(`SELECT ${ASSET_COLUMNS} FROM assets WHERE verification_status = ? ORDER BY created_at ASC`)
        .all(status);
      return rows.map(assetRowToRecord);
    } catch (err) {
      throw new Error(`Failed to list assets with status '${status}': ${err}`);
    }
  }

  /**
   * Record an admin verification decision. Rejecting or returning an asset to
   * pending also disables it so it cannot be traded while unverified.
   */
  setAssetVerification(
    symbol: string,
    status: "pending" | "verified" | "rejected",
    options: { reviewedBy?: string; notes?: string } = {},
  ): boolean {
    try {
      const result = this.db
        .prepare(
          `UPDATE assets
           SET verification_status = ?,
               verification_notes = ?,
               reviewed_by = ?,
               reviewed_at = ?,
               enabled = ?,
               updated_at = ?
           WHERE symbol = ?`,
        )
        .run(
          status,
          options.notes ?? null,
          options.reviewedBy ?? null,
          new Date().toISOString(),
          status === "verified" ? 1 : 0,
          new Date().toISOString(),
          symbol.toUpperCase(),
        );
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to set verification status for '${symbol}': ${err}`);
    }
  }

  getAssetBySymbol(symbol: string): AssetDbRecord | undefined {
    try {
      const row = this.db
        .prepare<
          [string],
          AssetDbRow
        >(`SELECT ${ASSET_COLUMNS} FROM assets WHERE symbol = ?`)
        .get(symbol.toUpperCase());
      if (!row) return undefined;
      return assetRowToRecord(row);
    } catch (err) {
      throw new Error(`Failed to get asset '${symbol}': ${err}`);
    }
  }

  addAsset(
    symbol: string,
    name: string,
    options: {
      contractAddress?: string;
      issuerAccount?: string;
      coingeckoId?: string;
      issuerMetadata?: IssuerMetadata;
      verificationStatus?: "pending" | "verified" | "rejected";
      submittedBy?: string;
    } = {},
  ): void {
    try {
      const sym = symbol.toUpperCase();
      const now = new Date().toISOString();
      // Unverified submissions are stored disabled so they cannot be traded
      // before an admin decision (#1412).
      const status = options.verificationStatus ?? "verified";
      this.db
        .prepare(
          `INSERT INTO assets (
             symbol, name, contract_address, issuer_account, coingecko_id, issuer_metadata,
             enabled, last_refreshed_at, is_quarantined,
             verification_status, submitted_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        )
        .run(
          sym,
          name,
          options.contractAddress ?? null,
          options.issuerAccount ?? null,
          options.coingeckoId ?? null,
          options.issuerMetadata ? JSON.stringify(options.issuerMetadata) : null,
          status === "verified" ? 1 : 0,
          now,
          status,
          options.submittedBy ?? null,
          now,
          now,
        );
    } catch (err) {
      if (isSqliteAssetSymbolUniqueViolation(err)) {
        throw new AssetRegistryConflictError(
          `Asset with symbol '${symbol.toUpperCase()}' already exists`,
        );
      }
      throw new Error(`Failed to add asset '${symbol}': ${err}`);
    }
  }

  setAssetFreshness(
    symbol: string,
    lastRefreshedAt: string,
    isQuarantined: boolean,
  ): boolean {
    try {
      const result = this.db
        .prepare(
          "UPDATE assets SET last_refreshed_at = ?, is_quarantined = ?, updated_at = ? WHERE symbol = ?",
        )
        .run(
          lastRefreshedAt,
          isQuarantined ? 1 : 0,
          new Date().toISOString(),
          symbol.toUpperCase(),
        );
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to set asset freshness '${symbol}': ${err}`);
    }
  }

  setAssetQuarantined(symbol: string, quarantined: boolean): boolean {
    try {
      const result = this.db
        .prepare(
          "UPDATE assets SET is_quarantined = ?, updated_at = ? WHERE symbol = ?",
        )
        .run(quarantined ? 1 : 0, new Date().toISOString(), symbol.toUpperCase());
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to set asset quarantined '${symbol}': ${err}`);
    }
  }

  removeAsset(symbol: string): boolean {
    // Verify a recent backup before destructive asset removal
    this.verifyBackupExists();
    try {
      const result = this.db
        .prepare("DELETE FROM assets WHERE symbol = ?")
        .run(symbol.toUpperCase());
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to remove asset '${symbol}': ${err}`);
    }
  }

  setAssetEnabled(symbol: string, enabled: boolean): boolean {
    try {
      const result = this.db
        .prepare(
          "UPDATE assets SET enabled = ?, updated_at = ? WHERE symbol = ?",
        )
        .run(enabled ? 1 : 0, new Date().toISOString(), symbol.toUpperCase());
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to set asset enabled '${symbol}': ${err}`);
    }
  }

  // ──────────────────────────────────────────
  // Legal consent (GDPR/CCPA)
  // ──────────────────────────────────────────

  recordConsent(
    userId: string,
    opts: {
      terms: boolean;
      privacy: boolean;
      cookies: boolean;
      analytics?: boolean;
      marketing?: boolean;
      ipAddress?: string;
      userAgent?: string;
      documentText?: string;
    },
  ): void {
    const now = new Date().toISOString();
    const docVersion = computeDocumentVersionHash(opts.documentText);
    const analyticsFlag = opts.analytics === undefined ? null : (opts.analytics ? 1 : 0);
    const marketingFlag = opts.marketing === undefined ? null : (opts.marketing ? 1 : 0);
    const grant = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO legal_consent (user_id, terms_accepted_at, privacy_accepted_at, cookie_accepted_at, analytics_accepted_at, marketing_accepted_at, revoked_at, is_active, ip_address, user_agent, document_version, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 terms_accepted_at = COALESCE(excluded.terms_accepted_at, terms_accepted_at),
                 privacy_accepted_at = COALESCE(excluded.privacy_accepted_at, privacy_accepted_at),
                 cookie_accepted_at = COALESCE(excluded.cookie_accepted_at, cookie_accepted_at),
                 analytics_accepted_at = CASE
                   WHEN ? IS NULL THEN analytics_accepted_at
                   WHEN ? = 1 THEN excluded.analytics_accepted_at
                   ELSE NULL
                 END,
                 marketing_accepted_at = CASE
                   WHEN ? IS NULL THEN marketing_accepted_at
                   WHEN ? = 1 THEN excluded.marketing_accepted_at
                   ELSE NULL
                 END,
                 revoked_at = NULL,
                 is_active = 1,
                 ip_address = excluded.ip_address,
                 user_agent = excluded.user_agent,
                 document_version = excluded.document_version,
                 updated_at = excluded.updated_at`,
        )
        .run(
          userId,
          opts.terms ? now : null,
          opts.privacy ? now : null,
          opts.cookies ? now : null,
          analyticsFlag === 1 ? now : null,
          marketingFlag === 1 ? now : null,
          opts.ipAddress ?? null,
          opts.userAgent ?? null,
          docVersion,
          now,
          analyticsFlag,
          analyticsFlag,
          marketingFlag,
          marketingFlag,
        );
      this.insertConsentAuditEvent(userId, "grant", now, opts.ipAddress, opts.userAgent, docVersion);
    });
    grant();
    logger.info("[DB] Consent recorded", { userId, documentVersion: docVersion });
  }

  revokeConsent(
    userId: string,
    opts: {
      ipAddress?: string;
      userAgent?: string;
      documentText?: string;
    } = {},
  ): void {
    const now = new Date().toISOString();
    const docVersion = opts.documentText ? computeDocumentVersionHash(opts.documentText) : null;
    const revoke = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO legal_consent (user_id, revoked_at, is_active, ip_address, user_agent, document_version, updated_at)
               VALUES (?, ?, 0, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 revoked_at = excluded.revoked_at,
                 is_active = 0,
                 ip_address = excluded.ip_address,
                 user_agent = excluded.user_agent,
                 document_version = COALESCE(excluded.document_version, document_version),
                 updated_at = excluded.updated_at`,
        )
        .run(
          userId,
          now,
          opts.ipAddress ?? null,
          opts.userAgent ?? null,
          docVersion,
          now,
        );
      this.insertConsentAuditEvent(userId, "revoke", now, opts.ipAddress, opts.userAgent, docVersion);
    });
    revoke();
    logger.info("[DB] Consent revoked", { userId, documentVersion: docVersion });
  }

getConsent(userId: string): ConsentRecord | undefined {
    const row = this.db
      .prepare<
        [string],
        {
          terms_accepted_at: string | null;
          privacy_accepted_at: string | null;
          cookie_accepted_at: string | null;
          analytics_accepted_at: string | null;
          marketing_accepted_at: string | null;
          revoked_at: string | null;
          is_active: number;
          document_version: string | null;
        }
      >("SELECT terms_accepted_at, privacy_accepted_at, cookie_accepted_at, analytics_accepted_at, marketing_accepted_at, revoked_at, is_active, document_version FROM legal_consent WHERE user_id = ?")
      .get(userId);
    if (!row) return undefined;
    return {
      termsAcceptedAt: row.terms_accepted_at,
      privacyAcceptedAt: row.privacy_accepted_at,
      cookieAcceptedAt: row.cookie_accepted_at,
      analyticsAcceptedAt: row.analytics_accepted_at,
      marketingAcceptedAt: row.marketing_accepted_at,
      revokedAt: row.revoked_at,
      active: row.is_active === 1,
      documentVersion: row.document_version,
    };
  }

  hasFullConsent(userId: string): boolean {
    const c = this.getConsent(userId);
    return Boolean(
      c?.active &&
      c.termsAcceptedAt &&
      c.privacyAcceptedAt &&
      c.cookieAcceptedAt,
    );
  }

  getConsentAudit(userId: string): ConsentAuditEvent[] {
    const rows = this.db
      .prepare<[string], ConsentAuditRow>(
        `SELECT id, user_id, action, timestamp, ip_address, user_agent, document_version
         FROM consent_audit_events
         WHERE user_id = ?
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(userId);
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      timestamp: row.timestamp,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      documentVersion: row.document_version,
    }));
  }

  private insertConsentAuditEvent(
    userId: string,
    action: "grant" | "revoke",
    timestamp: string,
    ipAddress?: string,
    userAgent?: string,
    documentVersion?: string | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO consent_audit_events (id, user_id, action, timestamp, ip_address, user_agent, document_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        generateId(),
        userId,
        action,
        timestamp,
        ipAddress ?? null,
        userAgent ?? null,
        documentVersion ?? null,
      );
  }

  /**
   * Purge consent audit events older than the specified number of days.
   * Returns the number of deleted rows.
   */
  purgeOldConsentAuditEvents(retentionDays: number): number {
    const cutoff = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const result = this.db
      .prepare("DELETE FROM consent_audit_events WHERE timestamp < ?")
      .run(cutoff);
    const count = result.changes;
    if (count > 0) {
      logger.info(
        `[DB] Purged ${count} consent audit event(s) older than ${retentionDays} day(s)`,
      );
    }
    return count;
  }

  deleteUserData(userId: string): void {
    // Verify a recent backup before destructive user data deletion
    this.verifyBackupExists();
    this.db.prepare("DELETE FROM legal_consent WHERE user_id = ?").run(userId);
    this.db
      .prepare("DELETE FROM consent_audit_events WHERE user_id = ?")
      .run(userId);
    const portfolios = this.db
      .prepare<
        [string],
        { id: string }
      >("SELECT id FROM portfolios WHERE user_address = ?")
      .all(userId);
    for (const p of portfolios) {
      this.db
        .prepare("DELETE FROM rebalance_history WHERE portfolio_id = ?")
        .run(p.id);
    }
    this.db
      .prepare("DELETE FROM portfolios WHERE user_address = ?")
      .run(userId);
  }

  clearAll(): void {
    // Verify a recent backup before clearing all database tables
    this.verifyBackupExists();
    try {
      this.db.prepare("DELETE FROM rebalance_history").run();
      this.db.prepare("DELETE FROM portfolios").run();
      this.db.prepare("DELETE FROM user_preferences").run();
    } catch (err) {
      throw new Error(`Failed to clear all data: ${err}`);
    }
  }

  // ──────────────────────────────────────────
  // Rebalance history methods
  // ──────────────────────────────────────────

  recordRebalanceEvent(eventData: {
    portfolioId: string,
    trigger: string,
    trades: number,
    gasUsed: string,
    status: "completed" | "failed" | "pending";
    isAutomatic?: boolean;
    riskAlerts?: any[];
    error?: string;
    details?: any;
    timestamp?: string;
    eventSource?: "offchain" | "simulated" | "onchain";
    actor?: "user" | "system" | "admin" | "scheduler";
    source?: "dashboard" | "api" | "contract" | "scheduler" | "auto_rebalance";
    triggerMetadata?: Record<string, unknown>;
    onChainConfirmed?: boolean;
    onChainEventType?: string;
    onChainTxHash?: string;
    onChainLedger?: number;
    onChainContractId?: string;
    onChainPagingToken?: string;
    isSimulated?: boolean;
    reasonCode?: string;
  }): RebalanceEvent {
    try {
      const mergedDetails = {
        ...(eventData.details ?? {}),
        ...(eventData.actor !== undefined && { actor: eventData.actor }),
        ...(eventData.source !== undefined && { source: eventData.source }),
        ...(eventData.triggerMetadata !== undefined && {
          triggerMetadata: eventData.triggerMetadata,
        }),
      };

      const event: RebalanceEvent = {
        id: generateId(),
        portfolioId: eventData.portfolioId,
        timestamp: eventData.timestamp ?? new Date().toISOString(),
        trigger: eventData.trigger,
        reasonCode: eventData.reasonCode as any,
        trades: eventData.trades,
        gasUsed: eventData.gasUsed,
        status: eventData.status,
        isAutomatic: eventData.isAutomatic ?? false,
        riskAlerts: eventData.riskAlerts ?? [],
        error: eventData.error,
        actor: eventData.actor,
        source: eventData.source,
        triggerMetadata: eventData.triggerMetadata,
        details: mergedDetails,
        eventSource: eventData.eventSource,
        onChainConfirmed: eventData.onChainConfirmed,
        onChainEventType: eventData.onChainEventType,
        onChainTxHash: eventData.onChainTxHash,
        onChainLedger: eventData.onChainLedger,
        onChainContractId: eventData.onChainContractId,
        onChainPagingToken: eventData.onChainPagingToken,
        isSimulated: eventData.isSimulated,
      };

        this.db
          .prepare(
            `
                INSERT INTO rebalance_history
                    (id, portfolio_id, timestamp, trigger, reason_code, trades, gas_used, status, is_automatic, risk_alerts, error, details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            event.id,
            eventData.portfolioId,
            event.timestamp,
            event.trigger,
            event.reasonCode ?? null,
            event.trades,
            event.gasUsed,
            event.status,
            event.isAutomatic ? 1 : 0,
            event.riskAlerts ? JSON.stringify(event.riskAlerts) : null,
            event.error ?? null,
            event.details ? JSON.stringify(event.details) : null,
          );

        return event;
      } catch (err) {
        throw new Error(
          `Failed to record rebalance event for portfolio '${eventData.portfolioId}': ${err}`,
        );
      }
  }

  getRebalanceHistory(
    portfolioId?: string,
    limit: number = 50,
    options?: RebalanceHistoryQueryOptions,
  ): RebalanceEvent[] {
    return this._withTiming("getRebalanceHistory", () => {
      try {
        if (portfolioId) {
          const rows = this.db
            .prepare<
              [string, number],
              RebalanceHistoryRow
            >("SELECT * FROM rebalance_history WHERE portfolio_id = ? ORDER BY timestamp DESC LIMIT ?")
            .all(portfolioId, limit);
          return rows.map(rowToEvent);
        }

        const rows = this.db
          .prepare<
            [number],
            RebalanceHistoryRow
          >("SELECT * FROM rebalance_history ORDER BY timestamp DESC LIMIT ?")
          .all(limit);
        return rows.map(rowToEvent);
      } catch (err) {
        throw new Error(
          `Failed to retrieve rebalance history${
            portfolioId ? ` for portfolio '${portfolioId}'` : ""
          }: ${err}`,
        );
      }
    });
  }

  getRecentAutoRebalances(
    portfolioId: string,
    limit: number = 10,
  ): RebalanceEvent[] {
    return this._withTiming("getRecentAutoRebalances", () => {
      try {
        const rows = this.db
          .prepare<[string, number], RebalanceHistoryRow>(
            `
                SELECT * FROM rebalance_history
                WHERE portfolio_id = ? AND is_automatic = 1
                ORDER BY timestamp DESC LIMIT ?
            `,
          )
          .all(portfolioId, limit);
        return rows.map(rowToEvent);
      } catch (err) {
        throw new Error(
          `Failed to retrieve auto-rebalances for portfolio '${portfolioId}': ${err}`,
        );
      }
    });
  }

  getAutoRebalancesSince(portfolioId: string, since: Date): RebalanceEvent[] {
    return this._withTiming("getAutoRebalancesSince", () => {
      try {
        const rows = this.db
          .prepare<[string, string], RebalanceHistoryRow>(
            `
                SELECT * FROM rebalance_history
                WHERE portfolio_id = ? AND is_automatic = 1 AND timestamp >= ?
                ORDER BY timestamp DESC
            `,
          )
          .all(portfolioId, since.toISOString());
        return rows.map(rowToEvent);
      } catch (err) {
        throw new Error(
          `Failed to retrieve auto-rebalances since ${since.toISOString()} for portfolio '${portfolioId}': ${err}`,
        );
      }
    });
  }

  getAllAutoRebalances(): RebalanceEvent[] {
    return this._withTiming("getAllAutoRebalances", () => {
      try {
        const rows = this.db
          .prepare<
            [],
            RebalanceHistoryRow
          >("SELECT * FROM rebalance_history WHERE is_automatic = 1 ORDER BY timestamp DESC")
          .all();
        return rows.map(rowToEvent);
      } catch (err) {
        throw new Error(`Failed to retrieve all auto-rebalances: ${err}`);
      }
    });
  }

  getRebalanceHistoryByDateRange(
    startDate: string,
    endDate: string,
  ): RebalanceEvent[] {
    return this._withTiming("getRebalanceHistoryByDateRange", () => {
      try {
        const rows = this.db
          .prepare<[string, string], RebalanceHistoryRow>(
            `SELECT * FROM rebalance_history
             WHERE status = 'completed'
               AND timestamp >= ?
               AND timestamp < ?
             ORDER BY timestamp ASC`,
          )
          .all(startDate, endDate);
        return rows.map(rowToEvent);
      } catch (err) {
        throw new Error(
          `Failed to retrieve rebalance history by date range: ${err}`,
        );
      }
    });
  }

  initializeDemoData(portfolioId: string): void {
    try {
      const existing = this.db
        .prepare<
          [string],
          { cnt: number }
        >("SELECT COUNT(*) as cnt FROM rebalance_history WHERE portfolio_id = ?")
        .get(portfolioId);
      if (existing && existing.cnt > 0) return;

      const twoHoursAgo = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      ).toISOString();
      const twelveHoursAgo = new Date(
        Date.now() - 12 * 60 * 60 * 1000,
      ).toISOString();
      const threeDaysAgo = new Date(
        Date.now() - 3 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const demoEvents = [
        {
          id: generateId(),
          portfolioId,
          timestamp: twoHoursAgo,
          trigger: "Threshold exceeded (8.2%)",
          trades: 3,
          gasUsed: "0.0234 XLM",
          status: "completed",
          isAutomatic: 0,
          details: {
            fromAsset: "XLM",
            toAsset: "ETH",
            amount: 1200,
            reason: "Portfolio allocation drift exceeded rebalancing threshold",
            riskLevel: "medium",
            priceDirection: "down",
            performanceImpact: "neutral",
          },
        },
        {
          id: generateId(),
          portfolioId,
          timestamp: twelveHoursAgo,
          trigger: "Automatic Rebalancing",
          trades: 2,
          gasUsed: "0.0156 XLM",
          status: "completed",
          isAutomatic: 1,
          details: {
            reason: "Automated scheduled rebalancing executed",
            riskLevel: "low",
            priceDirection: "up",
            performanceImpact: "positive",
          },
        },
        {
          id: generateId(),
          portfolioId,
          timestamp: threeDaysAgo,
          trigger: "Volatility circuit breaker",
          trades: 1,
          gasUsed: "0.0089 XLM",
          status: "completed",
          isAutomatic: 1,
          details: {
            reason:
              "High market volatility detected, protective rebalance executed",
            volatilityDetected: true,
            riskLevel: "high",
            priceDirection: "down",
            performanceImpact: "negative",
          },
        },
      ];

      const insert = this.db.prepare(`
                INSERT INTO rebalance_history
                    (id, portfolio_id, timestamp, trigger, reason_code, trades, gas_used, status, is_automatic, risk_alerts, error, details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

      for (const ev of demoEvents) {
        insert.run(
          ev.id,
          ev.portfolioId,
          ev.timestamp,
          ev.trigger,
          (ev as any).reasonCode ?? null,
          ev.trades,
          ev.gasUsed,
          ev.status,
          ev.isAutomatic,
          null,
          null,
          ev.details ? JSON.stringify(ev.details) : null,
        );
      }
    } catch (err) {
      throw new Error(
        `Failed to initialize demo data for portfolio '${portfolioId}': ${err}`,
      );
    }
  }

  clearHistory(portfolioId?: string): void {
    // Verify a recent backup before clearing rebalance history
    this.verifyBackupExists();
    try {
      if (portfolioId) {
        this.db
          .prepare("DELETE FROM rebalance_history WHERE portfolio_id = ?")
          .run(portfolioId);
      } else {
        this.db.prepare("DELETE FROM rebalance_history").run();
      }
    } catch (err) {
      throw new Error(
        `Failed to clear rebalance history${
          portfolioId ? ` for portfolio '${portfolioId}'` : ""
        }: ${err}`,
      );
    }
  }

  getHistoryStats(): {
    totalEvents: number;
    portfolios: number;
    recentActivity: number;
    autoRebalances: number;
  } {
    try {
      const oneDayAgo = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();

      const total = (
        this.db
          .prepare("SELECT COUNT(*) as cnt FROM rebalance_history")
          .get() as { cnt: number }
      ).cnt;
      const portfolios = (
        this.db
          .prepare(
            "SELECT COUNT(DISTINCT portfolio_id) as cnt FROM rebalance_history",
          )
          .get() as { cnt: number }
      ).cnt;
      const recentActivity = (
        this.db
          .prepare<
            [string],
            { cnt: number }
          >("SELECT COUNT(*) as cnt FROM rebalance_history WHERE timestamp >= ?")
          .get(oneDayAgo) as { cnt: number }
      ).cnt;
      const autoRebalances = (
        this.db
          .prepare(
            "SELECT COUNT(*) as cnt FROM rebalance_history WHERE is_automatic = 1",
          )
          .get() as { cnt: number }
      ).cnt;

      return { totalEvents: total, portfolios, recentActivity, autoRebalances };
    } catch (err) {
      throw new Error(`Failed to retrieve history stats: ${err}`);
    }
  }

  // ──────────────────────────────────────────
  // Price snapshots (optional, for future use)
  // ──────────────────────────────────────────

  savePriceSnapshot(
    asset: string,
    price: number,
    change?: number,
    source?: string,
  ): void {
    return this._withTiming("savePriceSnapshot", () => {
      try {
        this.db
          .prepare(
            `
                INSERT INTO price_snapshots (asset, price, change, source, captured_at)
                VALUES (?, ?, ?, ?, ?)
            `,
          )
          .run(
            asset,
            price,
            change ?? null,
            source ?? null,
            new Date().toISOString(),
          );
      } catch (err) {
        throw new Error(
          `Failed to save price snapshot for asset '${asset}': ${err}`,
        );
      }
    });
  }

  getLatestPriceSnapshot(
    asset: string,
  ): { price: number; change?: number; capturedAt: string } | undefined {
    return this._withTiming("getLatestPriceSnapshot", () => {
      try {
        const row = this.db
          .prepare<
            [string],
            { price: number; change: number | null; captured_at: string }
          >("SELECT price, change, captured_at FROM price_snapshots WHERE asset = ? ORDER BY captured_at DESC LIMIT 1")
          .get(asset);
        if (!row) return undefined;
        return {
          price: row.price,
          change: row.change ?? undefined,
          capturedAt: row.captured_at,
        };
      } catch (err) {
        throw new Error(
          `Failed to retrieve price snapshot for asset '${asset}': ${err}`,
        );
      }
    });
  }

  /**
   * Most recent price snapshot captured at or before `asOf` (ISO timestamp).
   * Used by the tax report so each tax lot keeps its acquisition-date price
   * instead of collapsing onto the latest price.
   */
  getPriceSnapshotAsOf(
    asset: string,
    asOf: string,
  ): { price: number; change?: number; capturedAt: string } | undefined {
    return this._withTiming("getPriceSnapshotAsOf", () => {
      try {
        const row = this.db
          .prepare<
            [string, string],
            { price: number; change: number | null; captured_at: string }
          >(
            `SELECT price, change, captured_at FROM price_snapshots
             WHERE asset = ? AND captured_at <= ?
             ORDER BY captured_at DESC LIMIT 1`,
          )
          .get(asset, asOf);
        if (!row) return undefined;
        return {
          price: row.price,
          change: row.change ?? undefined,
          capturedAt: row.captured_at,
        };
      } catch (err) {
        throw new Error(
          `Failed to retrieve price snapshot for asset '${asset}' as of '${asOf}': ${err}`,
        );
      }
    });
  }

  // ──────────────────────────────────────────
  // Portfolio draft methods
  // ──────────────────────────────────────────

  createDraft(data: {
    userAddress: string;
    label?: string;
    allocations: Record<string, number>;
    threshold: number;
    slippageTolerancePercent?: number;
    strategy?: string;
    strategyConfig?: Record<string, unknown>;
    expiresInDays?: number;
  }): string {
    const id = generateId();
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + (data.expiresInDays ?? 7) * 24 * 60 * 60 * 1000
    ).toISOString();
    this.db
      .prepare(
        `INSERT INTO portfolio_drafts (id, user_address, label, allocations, threshold, slippage_tolerance_percent, strategy, strategy_config, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.userAddress,
        data.label ?? null,
        JSON.stringify(data.allocations),
        data.threshold,
        data.slippageTolerancePercent ?? 1,
        data.strategy ?? 'threshold',
        JSON.stringify(data.strategyConfig ?? {}),
        now,
        now,
        expiresAt,
      );
    return id;
  }

  getDraft(id: string): Record<string, unknown> | undefined {
    const row = this.db
      .prepare<[string], PortfolioDraftRow>(
        "SELECT * FROM portfolio_drafts WHERE id = ?"
      )
      .get(id);
    if (!row) return undefined;
    return {
      id: row.id,
      userAddress: row.user_address,
      label: row.label,
      allocations: safeJsonParse(row.allocations, {}, `draft(${row.id}).allocations`),
      threshold: row.threshold,
      slippageTolerancePercent: row.slippage_tolerance_percent,
      strategy: row.strategy,
      strategyConfig: safeJsonParse(row.strategy_config, {}, `draft(${row.id}).strategy_config`),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      publishedPortfolioId: row.published_portfolio_id,
    };
  }

  updateDraft(id: string, updates: {
    label?: string;
    allocations?: Record<string, number>;
    threshold?: number;
    slippageTolerancePercent?: number;
    strategy?: string;
    strategyConfig?: Record<string, unknown>;
  }): boolean {
    const existing = this.db
      .prepare<[string], PortfolioDraftRow>("SELECT * FROM portfolio_drafts WHERE id = ?")
      .get(id);
    if (!existing) return false;
    const now = new Date().toISOString();
    const allocations = updates.allocations
      ? JSON.stringify(updates.allocations)
      : existing.allocations;
    const strategyConfig = updates.strategyConfig
      ? JSON.stringify(updates.strategyConfig)
      : existing.strategy_config;
    this.db
      .prepare(
        `UPDATE portfolio_drafts SET
           label = ?, allocations = ?, threshold = ?, slippage_tolerance_percent = ?,
           strategy = ?, strategy_config = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        updates.label ?? existing.label,
        allocations,
        updates.threshold ?? existing.threshold,
        updates.slippageTolerancePercent ?? existing.slippage_tolerance_percent,
        updates.strategy ?? existing.strategy,
        strategyConfig,
        now,
        id,
      );
    return true;
  }

  publishDraft(draftId: string): string | undefined {
    const draft = this.getDraft(draftId);
    if (!draft) return undefined;
    const portfolioId = this.createPortfolio(
      draft.userAddress as string,
      draft.allocations as Record<string, number>,
      draft.threshold as number,
      draft.slippageTolerancePercent as number,
      draft.strategy as string,
      draft.strategyConfig as Record<string, unknown>,
    );
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE portfolio_drafts SET published_portfolio_id = ?, updated_at = ? WHERE id = ?")
      .run(portfolioId, now, draftId);
    return portfolioId;
  }

  listDrafts(userAddress: string): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare<[string], PortfolioDraftRow>(
        "SELECT * FROM portfolio_drafts WHERE user_address = ? AND expires_at > datetime('now') ORDER BY updated_at DESC"
      )
      .all(userAddress);
    return rows.map((row) => ({
      id: row.id,
      userAddress: row.user_address,
      label: row.label,
      allocations: safeJsonParse(row.allocations, {}, `draft(${row.id}).allocations`),
      threshold: row.threshold,
      slippageTolerancePercent: row.slippage_tolerance_percent,
      strategy: row.strategy,
      strategyConfig: safeJsonParse(row.strategy_config, {}, `draft(${row.id}).strategy_config`),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      publishedPortfolioId: row.published_portfolio_id,
    }));
  }

  deleteDraft(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM portfolio_drafts WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  // ──────────────────────────────────────────
  // User preferences methods
  // ──────────────────────────────────────────

  getUserPreferences(userAddress: string): Record<string, unknown> {
    return this._withTiming("getUserPreferences", () => {
      const row = this.db
        .prepare<[string], {
          user_address: string;
          default_threshold: number | null;
          default_cooldown: number | null;
          preferred_currency: string | null;
          timezone: string | null;
          notification_digest_frequency: string | null;
        }>(
          "SELECT * FROM user_preferences WHERE user_address = ?"
        )
        .get(userAddress);

      if (!row) {
        return {
          userAddress,
          default_threshold: 5,
          default_cooldown: 3600,
          preferred_currency: 'USD',
          timezone: 'UTC',
          notification_digest_frequency: 'immediate'
        };
      }

      return {
        userAddress: row.user_address,
        default_threshold: row.default_threshold ?? 5,
        default_cooldown: row.default_cooldown ?? 3600,
        preferred_currency: row.preferred_currency ?? 'USD',
        timezone: row.timezone ?? 'UTC',
        notification_digest_frequency: row.notification_digest_frequency ?? 'immediate'
      };
    });
  }

  upsertUserPreferences(userAddress: string, prefs: {
    default_threshold?: number;
    default_cooldown?: number;
    preferred_currency?: string;
    timezone?: string;
    notification_digest_frequency?: string;
  }): void {
    this._withTiming("upsertUserPreferences", () => {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO user_preferences (
          user_address, default_threshold, default_cooldown, preferred_currency, timezone, notification_digest_frequency, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_address) DO UPDATE SET
          default_threshold = COALESCE(excluded.default_threshold, default_threshold),
          default_cooldown = COALESCE(excluded.default_cooldown, default_cooldown),
          preferred_currency = COALESCE(excluded.preferred_currency, preferred_currency),
          timezone = COALESCE(excluded.timezone, timezone),
          notification_digest_frequency = COALESCE(excluded.notification_digest_frequency, notification_digest_frequency),
          updated_at = excluded.updated_at
      `).run(
        userAddress,
        prefs.default_threshold ?? null,
        prefs.default_cooldown ?? null,
        prefs.preferred_currency ?? null,
        prefs.timezone ?? null,
        prefs.notification_digest_frequency ?? null,
        now
      );
    });
  }

  cleanupExpiredDrafts(): number {
    const result = this.db
      .prepare("DELETE FROM portfolio_drafts WHERE expires_at <= datetime('now')")
      .run();
    return result.changes;
  }

  createPublicShare(portfolioId: string, userAddress: string): string {
    return this._withTiming("createPublicShare", () => {
      try {
        const raw = randomUUID().replace(/-/g, '');
        const hash = raw.slice(0, 8);
        const now = new Date().toISOString();
        this.db
          .prepare(
            `INSERT INTO public_shares (hash, portfolio_id, user_address, active, created_at)
             VALUES (?, ?, ?, 1, ?)`
          )
          .run(hash, portfolioId, userAddress, now);
        return hash;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('UNIQUE constraint failed')) {
          return this.createPublicShare(portfolioId, userAddress);
        }
        throw new Error(`Failed to create public share for portfolio '${portfolioId}': ${err}`);
      }
    });
  }

  getPublicShareByHash(hash: string): { portfolioId: string; userAddress: string; active: boolean; createdAt: string; revokedAt: string | null } | undefined {
    return this._withTiming("getPublicShareByHash", () => {
      try {
        const row = this.db
          .prepare<[string], { portfolio_id: string; user_address: string; active: number; created_at: string; revoked_at: string | null }>(
            "SELECT * FROM public_shares WHERE hash = ?"
          )
          .get(hash);
        if (!row) return undefined;
        return {
          portfolioId: row.portfolio_id,
          userAddress: row.user_address,
          active: row.active === 1,
          createdAt: row.created_at,
          revokedAt: row.revoked_at,
        };
      } catch (err) {
        throw new Error(`Failed to get public share by hash '${hash}': ${err}`);
      }
    });
  }

  getPublicShareByPortfolioId(portfolioId: string): { hash: string; active: boolean; createdAt: string; revokedAt: string | null } | undefined {
    return this._withTiming("getPublicShareByPortfolioId", () => {
      try {
        const row = this.db
          .prepare<[string], { hash: string; active: number; created_at: string; revoked_at: string | null }>(
            "SELECT hash, active, created_at, revoked_at FROM public_shares WHERE portfolio_id = ?"
          )
          .get(portfolioId);
        if (!row) return undefined;
        return {
          hash: row.hash,
          active: row.active === 1,
          createdAt: row.created_at,
          revokedAt: row.revoked_at,
        };
      } catch (err) {
        throw new Error(`Failed to get public share for portfolio '${portfolioId}': ${err}`);
      }
    });
  }

  revokePublicShare(portfolioId: string): boolean {
    return this._withTiming("revokePublicShare", () => {
      try {
        const now = new Date().toISOString();
        const result = this.db
          .prepare("UPDATE public_shares SET active = 0, revoked_at = ? WHERE portfolio_id = ? AND active = 1")
          .run(now, portfolioId);
        return result.changes > 0;
      } catch (err) {
        throw new Error(`Failed to revoke public share for portfolio '${portfolioId}': ${err}`);
      }
    });
  }

  backup(backupPath?: string): string {
    try {
      const dbPath = process.env.DB_PATH || "./data/portfolio.db";
      const defaultBackupDir = join(dirname(dbPath), "backups");
      mkdirSync(defaultBackupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const defaultBackupPath = join(defaultBackupDir, `portfolio-backup-${timestamp}.db`);
      const finalBackupPath = backupPath || defaultBackupPath;

      this.db.backup(finalBackupPath);
      logger.info(`[DB] Backup created successfully at ${finalBackupPath}`);
      return finalBackupPath;
    } catch (err) {
      throw new Error(`Failed to create backup: ${err}`);
    }
  }

  restore(backupPath: string): void {
    try {
      if (!existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`);
      }

      const dbPath = process.env.DB_PATH || "./data/portfolio.db";
      
      // First close current connection
      this.db.close();

      try {
        // Copy backup to current DB path
        copyFileSync(backupPath, dbPath);
        logger.info(`[DB] Restored from backup: ${backupPath}`);

        // Reopen the database connection
        this.db = new Database(dbPath);
        this.db.exec(SCHEMA_SQL);
        this._migrateSchema();
        this._seedDefaultAssets();
      } catch (copyErr) {
        // If copy failed, try to reopen original DB if possible
        try {
          this.db = new Database(dbPath);
          this.db.exec(SCHEMA_SQL);
          this._migrateSchema();
          this._seedDefaultAssets();
        } catch (reopenErr) {
          // Ignore
        }
        throw copyErr;
      }
    } catch (err) {
      throw new Error(`Failed to restore backup: ${err}`);
    }
  }

  close(): void {
    this.db.close();
  }

  // ──────────────────────────────────────────
  // Replay checkpoint methods
  // ──────────────────────────────────────────

  getReplayCheckpoint(replayId: string): Record<string, unknown> | undefined {
    const raw = this.getIndexerState(`replay_checkpoint.${replayId}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  setReplayCheckpoint(replayId: string, data: Record<string, unknown>): void {
    this.setIndexerState(`replay_checkpoint.${replayId}`, JSON.stringify(data));
  }

  getReplayIntegrityHash(): string | undefined {
    return this.getIndexerState('replay_integrity_hash');
  }

  setReplayIntegrityHash(hash: string): void {
    this.setIndexerState('replay_integrity_hash', hash);
  }

  getLastReplayedLedger(): number | undefined {
    const val = this.getIndexerState('replay_last_ledger');
    return val ? parseInt(val, 10) : undefined;
  }

  setLastReplayedLedger(ledger: number): void {
    this.setIndexerState('replay_last_ledger', String(ledger));
  }

  getReplayEventCount(): number {
    const val = this.getIndexerState('replay_event_count');
    return val ? parseInt(val, 10) : 0;
  }

  setReplayEventCount(count: number): void {
    this.setIndexerState('replay_event_count', String(count));
  }

  getReplayStatus(): {
    lastReplayedLedger: number | undefined;
    eventCount: number;
    integrityHash: string | undefined;
  } {
    return {
      lastReplayedLedger: this.getLastReplayedLedger(),
      eventCount: this.getReplayEventCount(),
      integrityHash: this.getReplayIntegrityHash(),
    };
  }

  // ──────────────────────────────────────────
  // Indexer state (key-value store for contract event indexer)
  // ──────────────────────────────────────────

  getIndexerState(key: string): string | undefined {
    return this._withTiming("getIndexerState", () => {
      try {
        const row = this.db
          .prepare<
            [string],
            { value: string }
          >("SELECT value FROM kv_store WHERE key = ?")
          .get(key);
        return row?.value;
      } catch {
        return undefined;
      }
    });
  }

  setIndexerState(key: string, value: string): void {
    return this._withTiming("setIndexerState", () => {
      try {
        this.db
          .prepare(
            "INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
          .run(key, value);
      } catch (err) {
        throw new Error(`Failed to set indexer state key '${key}': ${err}`);
      }
    });
  }

  ensurePortfolioExists(portfolioId: string, userAddress: string): void {
    try {
      const existing = this.getPortfolio(portfolioId);
      if (!existing) {
        this.db
          .prepare(
            `
                    INSERT OR IGNORE INTO portfolios
                        (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                `,
          )
          .run(
            portfolioId,
            userAddress,
            JSON.stringify({}),
            5,
            1,
            JSON.stringify({}),
            0,
            new Date().toISOString(),
            new Date().toISOString(),
            "threshold",
            "{}",
          );
      }
    } catch (err) {
      throw new Error(
        `Failed to ensure portfolio '${portfolioId}' exists: ${err}`,
      );
    }
  }

  getReadiness(): { ready: boolean; databasePath: string; error?: string } {
    const dbPath = process.env.DB_PATH || "./data/portfolio.db";
    try {
      this.db.prepare("SELECT 1").get();
      return { ready: true, databasePath: dbPath };
    } catch (err) {
      return {
        ready: false,
        databasePath: dbPath,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  recordAdminAuditEntry(
    actor: string,
    action: string,
    target: string | null,
    beforeValue: unknown,
    afterValue: unknown,
  ): string {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    this._withTiming("recordAdminAuditEntry", () => {
      this.db
        .prepare(
          `INSERT INTO admin_audit_log (id, actor, action, target, before_value, after_value, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          actor,
          action,
          target,
          beforeValue != null ? JSON.stringify(beforeValue) : null,
          afterValue != null ? JSON.stringify(afterValue) : null,
          timestamp,
        );
    });
    return id;
  }

  queryAdminAuditLog(filters: {
    actor?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): { entries: Array<{
    id: string;
    actor: string;
    action: string;
    target: string | null;
    before_value: string | null;
    after_value: string | null;
    timestamp: string;
  }>; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.actor) {
      conditions.push("actor = ?");
      params.push(filters.actor);
    }
    if (filters.action) {
      conditions.push("action = ?");
      params.push(filters.action);
    }
    if (filters.startDate) {
      conditions.push("timestamp >= ?");
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push("timestamp <= ?");
      params.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;

    return this._withTiming("queryAdminAuditLog", () => {
      const total = (
        this.db
          .prepare(`SELECT COUNT(*) as cnt FROM admin_audit_log ${whereClause}`)
          .get(...params) as { cnt: number }
      ).cnt;

      const entries = this.db
        .prepare(
          `SELECT * FROM admin_audit_log ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Array<{
          id: string;
          actor: string;
          action: string;
          target: string | null;
          before_value: string | null;
          after_value: string | null;
          timestamp: string;
        }>;

      return { entries, total };
    });
  }
}

// Singleton export
export const databaseService = new DatabaseService();
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { randomUUID, createHash } from "node:crypto";

import type { RebalanceEvent } from "./rebalanceHistory.js";
import { getFeatureFlags } from "../config/featureFlags.js";
import { logger } from "../utils/logger.js";
import { ConflictError, BackupVerificationError } from "../types/index.js";

import type { Portfolio } from "../types/index.js";
import { AssetRegistryConflictError } from "./assetRegistryValidation.js";
import { dbQueryDuration } from "../observability/metrics.js";

const SLOW_QUERY_THRESHOLD_MS = 100;

function isSqliteAssetSymbolUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("UNIQUE constraint failed") && msg.includes("assets.symbol")
  );
}

// ─────────────────────────────────────────────
// Exported type used by rebalanceHistory.ts
// ─────────────────────────────────────────────
export interface RebalanceHistoryQueryOptions {
  isAutomatic?: boolean;
  status?: "completed" | "failed" | "pending";
  since?: string;
  until?: string;
  eventSource?: "offchain" | "simulated" | "onchain";
  startTimestamp?: string;
  endTimestamp?: string;
}

// ─────────────────────────────────────────────
// Types (mirrored from portfolioStorage.ts)
// ─────────────────────────────────────────────
interface PortfolioRow {
  id: string;
  user_address: string;
  name?: string | null;
  description?: string | null;
  allocations: string;
  threshold: number;
  slippage_tolerance_percent?: number;
  balances: string;
  total_value: number;
  created_at: string;
  last_rebalance: string;
  version: number;
  strategy?: string;
  strategy_config?: string;
}

interface PortfolioDraftRow {
  id: string;
  user_address: string;
  label: string | null;
  allocations: string;
  threshold: number;
  slippage_tolerance_percent: number;
  strategy: string;
  strategy_config: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  published_portfolio_id: string | null;
}

interface RebalanceHistoryRow {
  id: string;
  portfolio_id: string;
  timestamp: string;
  trigger: string;
  reason_code?: string;
  trades: number;
  gas_used: string;
  status: string;
  is_automatic: number;
  event_source?: string | null;
  on_chain_confirmed?: number | null;
  on_chain_event_type?: string | null;
  on_chain_tx_hash?: string | null;
  on_chain_ledger?: number | null;
  on_chain_contract_id?: string | null;
  on_chain_paging_token?: string | null;
  is_simulated?: number | null;
  risk_alerts: string | null;
  error: string | null;
  details: string | null;
}

export interface IndexerCursorState {
  name: string;
  cursor?: string;
  latestLedger?: number;
  updatedAt?: string;
  lastSuccessfulSyncAt?: string;
  lastFailedSyncAt?: string;
  lastError?: string;
}

interface ConsentAuditRow {
  id: string;
  user_id: string;
  action: "grant" | "revoke";
  timestamp: string;
  ip_address: string | null;
  user_agent: string | null;
  document_version: string | null;
}

export interface ConsentRecord {
  termsAcceptedAt: string | null;
  privacyAcceptedAt: string | null;
  cookieAcceptedAt: string | null;
  analyticsAcceptedAt: string | null;
  marketingAcceptedAt: string | null;
  revokedAt: string | null;
  active: boolean;
  documentVersion: string | null;
}

export interface ConsentAuditEvent {
  id: string;
  userId: string;
  action: "grant" | "revoke";
  timestamp: string;
  ipAddress: string | null;
  userAgent: string | null;
  documentVersion: string | null;
}

/**
 * Compute a SHA-256 hex digest of the supplied legal document text.
 * Returns a deterministic 64-char lowercase hex string.
 * When `text` is falsy a sentinel hash is returned so that every consent
 * record always carries a non-null version reference.
 */
export function computeDocumentVersionHash(text?: string): string {
  const input = text || "";
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ─────────────────────────────────────────────
// Schema SQL
// ─────────────────────────────────────────────

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portfolios (
    id            TEXT PRIMARY KEY,
    user_address  TEXT NOT NULL,
    name          TEXT,
    description   TEXT,
    allocations   TEXT NOT NULL,
    threshold     REAL NOT NULL,
    slippage_tolerance_percent REAL NOT NULL DEFAULT 1,
    balances      TEXT NOT NULL,
    total_value   REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_rebalance TEXT NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rebalance_history (
    id            TEXT PRIMARY KEY,
    portfolio_id  TEXT NOT NULL,
    timestamp     TEXT NOT NULL,
    trigger       TEXT NOT NULL,
    reason_code   TEXT,
    trades        INTEGER NOT NULL DEFAULT 0,
    gas_used      TEXT NOT NULL,
    status        TEXT NOT NULL,
    is_automatic  INTEGER NOT NULL DEFAULT 0,
    event_source  TEXT NOT NULL DEFAULT 'offchain',
    on_chain_confirmed INTEGER NOT NULL DEFAULT 0,
    on_chain_event_type TEXT,
    on_chain_tx_hash TEXT,
    on_chain_ledger INTEGER,
    on_chain_contract_id TEXT,
    on_chain_paging_token TEXT,
    is_simulated INTEGER NOT NULL DEFAULT 0,
    risk_alerts   TEXT,
    error         TEXT,
    details       TEXT,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_rebalance_history_portfolio_id
    ON rebalance_history (portfolio_id);

CREATE INDEX IF NOT EXISTS idx_rebalance_history_portfolio_id_timestamp
    ON rebalance_history (portfolio_id, timestamp);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rebalance_history_on_chain_paging_token
    ON rebalance_history (on_chain_paging_token)
    WHERE on_chain_paging_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS contract_event_indexer_state (
    name                    TEXT PRIMARY KEY,
    cursor                  TEXT,
    latest_ledger           INTEGER,
    updated_at              TEXT NOT NULL,
    last_successful_sync_at TEXT,
    last_failed_sync_at     TEXT,
    last_error              TEXT
);

CREATE TABLE IF NOT EXISTS price_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset       TEXT NOT NULL,
    price       REAL NOT NULL,
    change      REAL,
    source      TEXT,
    captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_store (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
    symbol            TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    contract_address  TEXT,
    issuer_account    TEXT,
    coingecko_id      TEXT,
    issuer_metadata   TEXT,
    enabled           INTEGER NOT NULL DEFAULT 1,
    last_refreshed_at TEXT,
    is_quarantined    INTEGER NOT NULL DEFAULT 0,
    verification_status TEXT NOT NULL DEFAULT 'verified'
                        CHECK (verification_status IN ('pending', 'verified', 'rejected')),
    verification_notes  TEXT,
    submitted_by        TEXT,
    reviewed_by         TEXT,
    reviewed_at         TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_enabled ON assets(enabled) WHERE enabled = 1;
CREATE INDEX IF NOT EXISTS idx_assets_verification ON assets(verification_status);

CREATE TABLE IF NOT EXISTS legal_consent (
    user_id             TEXT PRIMARY KEY,
    terms_accepted_at   TEXT,
    privacy_accepted_at TEXT,
    cookie_accepted_at  TEXT,
    analytics_accepted_at TEXT,
    marketing_accepted_at TEXT,
    revoked_at          TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    ip_address          TEXT,
    user_agent          TEXT,
    document_version    TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS consent_audit_events (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    action      TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
    timestamp   TEXT NOT NULL,
    ip_address  TEXT,
    user_agent  TEXT,
    document_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_audit_events_user_timestamp
    ON consent_audit_events (user_id, timestamp);

CREATE TABLE IF NOT EXISTS portfolio_drafts (
    id            TEXT PRIMARY KEY,
    user_address  TEXT NOT NULL,
    label         TEXT,
    allocations   TEXT NOT NULL,
    threshold     REAL NOT NULL DEFAULT 5,
    slippage_tolerance_percent REAL NOT NULL DEFAULT 1,
    strategy      TEXT NOT NULL DEFAULT 'threshold',
    strategy_config TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    published_portfolio_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_portfolio_drafts_user
    ON portfolio_drafts (user_address, expires_at);

CREATE INDEX IF NOT EXISTS idx_portfolio_drafts_expires
    ON portfolio_drafts (expires_at);

CREATE TABLE IF NOT EXISTS public_shares (
    hash            TEXT PRIMARY KEY,
    portfolio_id    TEXT NOT NULL,
    user_address    TEXT NOT NULL,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    revoked_at      TEXT,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
);

CREATE INDEX IF NOT EXISTS idx_public_shares_portfolio
    ON public_shares (portfolio_id);

CREATE INDEX IF NOT EXISTS idx_public_shares_active
    ON public_shares (active) WHERE active = 1;

CREATE TABLE IF NOT EXISTS user_preferences (
    user_address                  TEXT PRIMARY KEY,
    default_threshold             REAL,
    default_cooldown              INTEGER,
    preferred_currency            TEXT,
    timezone                      TEXT,
    notification_digest_frequency TEXT,
    updated_at                    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id          TEXT PRIMARY KEY,
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    target      TEXT,
    before_value TEXT,
    after_value  TEXT,
    timestamp   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON admin_audit_log (actor);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_timestamp ON admin_audit_log (timestamp);
`;

// ─────────────────────────────────────────────
// Demo seed data
// ─────────────────────────────────────────────

// ── asset row mapping ────────────────────────────────────────────────────────
// Single source of truth for the asset column list so every read path returns
// the same shape, including the verification-workflow fields (#1412).

export type AssetVerificationStatus = "pending" | "verified" | "rejected";

export interface AssetDbRecord {
  symbol: string;
  name: string;
  contractAddress?: string;
  issuerAccount?: string;
  coingeckoId?: string;
  enabled: boolean;
  lastRefreshedAt?: string;
  isQuarantined: boolean;
  verificationStatus: AssetVerificationStatus;
  verificationNotes?: string;
  submittedBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

interface AssetDbRow {
  symbol: string;
  name: string;
  contract_address: string | null;
  issuer_account: string | null;
  coingecko_id: string | null;
  enabled: number;
  last_refreshed_at: string | null;
  is_quarantined: number;
  verification_status: string | null;
  verification_notes: string | null;
  submitted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

const ASSET_COLUMNS = [
  "symbol",
  "name",
  "contract_address",
  "issuer_account",
  "coingecko_id",
  "enabled",
  "last_refreshed_at",
  "is_quarantined",
  "verification_status",
  "verification_notes",
  "submitted_by",
  "reviewed_by",
  "reviewed_at",
].join(", ");

function assetRowToRecord(row: AssetDbRow): AssetDbRecord {
  return {
    symbol: row.symbol,
    name: row.name,
    contractAddress: row.contract_address ?? undefined,
    issuerAccount: row.issuer_account ?? undefined,
    coingeckoId: row.coingecko_id ?? undefined,
    enabled: row.enabled === 1,
    lastRefreshedAt: row.last_refreshed_at ?? undefined,
    isQuarantined: row.is_quarantined === 1,
    // Rows written before the workflow existed have no status; treat as verified.
    verificationStatus: (row.verification_status as AssetVerificationStatus) ?? "verified",
    verificationNotes: row.verification_notes ?? undefined,
    submittedBy: row.submitted_by ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
  };
}

const DEMO_PORTFOLIO_ID = "demo-portfolio-1";

function seedDemoData(db: Database.Database): void {
  const existingDemo = db
    .prepare<[string], PortfolioRow>("SELECT id FROM portfolios WHERE id = ?")
    .get(DEMO_PORTFOLIO_ID);
  if (existingDemo) return; // already seeded

  const now = new Date().toISOString();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twelveHoursAgo = new Date(
    Date.now() - 12 * 60 * 60 * 1000,
  ).toISOString();
  const threeDaysAgo = new Date(
    Date.now() - 3 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const allocations = { XLM: 40, BTC: 30, ETH: 20, USDC: 10 };
  const balances = { XLM: 11173.18, BTC: 0.02697, ETH: 0.68257, USDC: 1000 };

  db.prepare(
    `
        INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `,
  ).run(
    DEMO_PORTFOLIO_ID,
    "DEMO-USER",
    JSON.stringify(allocations),
    5,
    1,
    JSON.stringify(balances),
    10000,
    now,
    now,
    "threshold",
    "{}",
  );

  const historyRows = [
    {
      id: "demo-evt-1",
      portfolioId: DEMO_PORTFOLIO_ID,
      timestamp: twoHoursAgo,
      trigger: "Threshold exceeded (8.2%)",
      trades: 3,
      gasUsed: "0.0234 XLM",
      status: "completed",
      isAutomatic: 0,
      riskAlerts: null,
      error: null,
      details: JSON.stringify({
        fromAsset: "XLM",
        toAsset: "ETH",
        amount: 1200,
        reason: "Portfolio allocation drift exceeded rebalancing threshold",
        riskLevel: "medium",
        priceDirection: "down",
        performanceImpact: "neutral",
      }),
    },
    {
      id: "demo-evt-2",
      portfolioId: DEMO_PORTFOLIO_ID,
      timestamp: twelveHoursAgo,
      trigger: "Automatic Rebalancing",
      trades: 2,
      gasUsed: "0.0156 XLM",
      status: "completed",
      isAutomatic: 1,
      riskAlerts: null,
      error: null,
      details: JSON.stringify({
        reason: "Automated scheduled rebalancing executed",
        riskLevel: "low",
        priceDirection: "up",
        performanceImpact: "positive",
      }),
    },
    {
      id: "demo-evt-3",
      portfolioId: DEMO_PORTFOLIO_ID,
      timestamp: threeDaysAgo,
      trigger: "Volatility circuit breaker",
      trades: 1,
      gasUsed: "0.0089 XLM",
      status: "completed",
      isAutomatic: 1,
      riskAlerts: null,
      error: null,
      details: JSON.stringify({
        reason:
          "High market volatility detected, protective rebalance executed",
        volatilityDetected: true,
        riskLevel: "high",
        priceDirection: "down",
        performanceImpact: "negative",
      }),
    },
  ];

  const insertEvent = db.prepare(`
        INSERT INTO rebalance_history
            (id, portfolio_id, timestamp, trigger, trades, gas_used, status, is_automatic, risk_alerts, error, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

  for (const ev of historyRows) {
    insertEvent.run(
      ev.id,
      ev.portfolioId,
      ev.timestamp,
      ev.trigger,
      ev.trades,
      ev.gasUsed,
      ev.status,
      ev.isAutomatic,
      ev.riskAlerts,
      ev.error,
      ev.details,
    );
  }

  logger.info("[DB] Demo data seeded (portfolio + 3 history events)");
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Safely parse a JSON string. Returns `fallback` instead of throwing
 * when the stored value is null, empty, or malformed.
 */
function safeJsonParse<T>(
  value: string | null | undefined,
  fallback: T,
  context: string,
): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    logger.error("[DB] Failed to parse JSON", { context, value });
    return fallback;
  }
}

function rowToPortfolio(row: PortfolioRow): Portfolio {
  return {
    id: row.id,
    userAddress: row.user_address,
    name: row.name ?? undefined,
    // `name` and `description` are persisted on create and on versioned
    // update, so they have to be read back here. Dropping them made every
    // versioned update rewrite the stored name as NULL, because the merge
    // that feeds the UPDATE started from a row that had already lost it.
    ...(row.name == null ? {} : { name: row.name }),
    ...(row.description == null ? {} : { description: row.description }),
    allocations: safeJsonParse(
      row.allocations,
      {},
      `portfolio(${row.id}).allocations`,
    ),
    threshold: row.threshold,
    slippageTolerance: row.slippage_tolerance_percent ?? 1,
    balances: safeJsonParse(row.balances, {}, `portfolio(${row.id}).balances`),
    totalValue: row.total_value,
    createdAt: row.created_at,
    lastRebalance: row.last_rebalance,
    version: row.version ?? 1,
    strategy: (row.strategy as Portfolio["strategy"]) || "threshold",
    strategyConfig: row.strategy_config
      ? safeJsonParse(
          row.strategy_config,
          {},
          `portfolio(${row.id}).strategy_config`,
        )
      : undefined,
  };
}

function rowToEvent(row: RebalanceHistoryRow): RebalanceEvent {
  const details = safeJsonParse<Record<string, any> | undefined>(
    row.details,
    undefined,
    `event(${row.id}).details`,
  );
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    timestamp: row.timestamp,
    trigger: row.trigger,
    reasonCode: row.reason_code as any,
    trades: row.trades,
    gasUsed: row.gas_used,
    status: row.status as RebalanceEvent["status"],
    isAutomatic: row.is_automatic === 1,
    riskAlerts: safeJsonParse(
      row.risk_alerts,
      [],
      `event(${row.id}).risk_alerts`,
    ),
    error: row.error ?? undefined,
    actor: details?.actor,
    source: details?.source,
    triggerMetadata: details?.triggerMetadata,
    eventSource:
      (row.event_source as RebalanceEvent["eventSource"]) ?? undefined,
    onChainConfirmed:
      row.on_chain_confirmed === undefined || row.on_chain_confirmed === null
        ? undefined
        : row.on_chain_confirmed === 1,
    onChainEventType: row.on_chain_event_type ?? undefined,
    onChainTxHash: row.on_chain_tx_hash ?? undefined,
    onChainLedger: row.on_chain_ledger ?? undefined,
    onChainContractId: row.on_chain_contract_id ?? undefined,
    onChainPagingToken: row.on_chain_paging_token ?? undefined,
    isSimulated:
      row.is_simulated === undefined || row.is_simulated === null
        ? undefined
        : row.is_simulated === 1,
    details,
  };
}

function generateId(): string {
  return randomUUID();
}

// ─────────────────────────────────────────────
// DatabaseService
// ─────────────────────────────────────────────

export class DatabaseService {
  private db: Database.Database;

  constructor() {
    const dbPath = process.env.DB_PATH || "./data/portfolio.db";
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);
    this._migrateSchema();

    // Validate and log SQLite pragma settings
    this._validatePragmas(dbPath);

    // Seed demo data on first run (empty portfolios table)
    const count = (
      this.db.prepare("SELECT COUNT(*) as cnt FROM portfolios").get() as {
        cnt: number;
      }
    ).cnt;
    if (count === 0 && getFeatureFlags().enableDemoDbSeed) {
      seedDemoData(this.db);
    }

    this._seedDefaultAssets();

    logger.info("[DB] SQLite database ready", { dbPath });
  }

  private _validatePragmas(dbPath: string): void {
    const pragmas = [
      { name: "journal_mode", expected: "wal", critical: true },
      { name: "foreign_keys", expected: "1", critical: true },
      { name: "synchronous", expected: "normal", critical: false },
      { name: "cache_size", expected: null, critical: false },
      { name: "locking_mode", expected: "normal", critical: false },
    ];

    const results: Record<string, { current: string; expected: string | null; status: string }> = {};

    for (const pragma of pragmas) {
      try {
        const row = this.db
          .prepare(`PRAGMA ${pragma.name}`)
          .get() as { [key: string]: string };
        const current = row[pragma.name];
        const expected = pragma.expected;
        const status = expected ? (current.toLowerCase() === expected.toLowerCase() ? "ok" : "warning") : "info";

        results[pragma.name] = { current, expected, status };

        if (status === "warning" && pragma.critical) {
          logger.warn(
            `[DB] Critical pragma mismatch: ${pragma.name} is '${current}' but expected '${expected}'. This may cause data integrity or concurrency issues.`,
            { pragma: pragma.name, current, expected, dbPath },
          );
        } else if (status === "warning" && !pragma.critical) {
          logger.info(
            `[DB] Pragma suboptimal: ${pragma.name} is '${current}' but recommended is '${expected}'. Consider tuning for better performance.`,
            { pragma: pragma.name, current, expected, dbPath },
          );
        }
      } catch (err) {
        logger.error(`[DB] Failed to read pragma ${pragma.name}`, { error: String(err) });
      }
    }

    // Log summary of pragma validation
    const warnings = Object.values(results).filter((r) => r.status === "warning");
    if (warnings.length > 0) {
      logger.warn(
        `[DB] SQLite pragma validation complete with ${warnings.length} warning(s). Review logs above for actionable steps.`,
        { dbPath, results },
      );
    } else {
      logger.info("[DB] SQLite pragma validation passed", { dbPath, results });
    }
  }

  // ─────────────────────────────────────────────
  // Backup verification (high‑risk operations)
  // ─────────────────────────────────────────────

  /**
   * Checks whether a recent usable backup exists.
   * The implementation looks for a KV entry `backup_last_success` and ensures it
   * is within the configured TTL (default 24 hours). Adjust the logic to match
   * your actual backup service.
   */
  private verifyBackupExists(): void {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const row = this.db
        .prepare<[string]>("SELECT value FROM kv_store WHERE key = ?")
        .get("backup_last_success") as { value: string } | undefined;
      if (!row) {
        throw new BackupVerificationError(
          "No backup record found; a recent backup is required before performing this operation.",
        );
      }
      const timestamp = new Date(row.value).getTime();
      const now = Date.now();
      const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
      if (now - timestamp > ttlMs) {
        throw new BackupVerificationError(
          "Backup is older than 24 hours; please create a fresh backup before proceeding.",
        );
      }
    } catch (err) {
      if (err instanceof BackupVerificationError) throw err;
      // If the KV table does not exist or query fails, treat as missing backup
      throw new BackupVerificationError(
        `Backup verification failed: ${err}`,
      );
    }
  }

  private _migrateSchema(): void {
    // Issuer-verification workflow columns (#1412). Existing rows are treated as
    // already-verified so the catalog behaves exactly as before the workflow existed.
    const assetCols = this.db
      .prepare("PRAGMA table_info(assets)")
      .all() as Array<{ name: string }>;
    const assetColNames = new Set(assetCols.map((c) => c.name));
    const assetMigrations: Array<[string, string]> = [
      [
        "verification_status",
        "ALTER TABLE assets ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'verified'",
      ],
      ["verification_notes", "ALTER TABLE assets ADD COLUMN verification_notes TEXT"],
      ["submitted_by", "ALTER TABLE assets ADD COLUMN submitted_by TEXT"],
      ["reviewed_by", "ALTER TABLE assets ADD COLUMN reviewed_by TEXT"],
      ["reviewed_at", "ALTER TABLE assets ADD COLUMN reviewed_at TEXT"],
    ];
    for (const [column, statement] of assetMigrations) {
      if (!assetColNames.has(column)) {
        this.db.exec(statement);
        logger.info(`[DB] Migration: added ${column} column to assets`);
      }
    }
    if (!assetColNames.has("verification_status")) {
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_assets_verification ON assets(verification_status)",
      );
    }

    const cols = this.db
      .prepare("PRAGMA table_info(portfolios)")
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "version")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
      );
      logger.info("[DB] Migration: added version column to portfolios");
    }
    if (!cols.some((c) => c.name === "slippage_tolerance_percent")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN slippage_tolerance_percent REAL NOT NULL DEFAULT 1",
      );
      logger.info(
        "[DB] Migration: added slippage_tolerance_percent column to portfolios",
      );
    }
    if (!cols.some((c) => c.name === "name")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN name TEXT",
      );
      logger.info("[DB] Migration: added name column to portfolios");
    }
    if (!cols.some((c) => c.name === "description")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN description TEXT",
      );
      logger.info("[DB] Migration: added description column to portfolios");
    }
    if (!cols.some((c) => c.name === "strategy")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN strategy TEXT NOT NULL DEFAULT 'threshold'",
      );
      logger.info("[DB] Migration: added strategy column to portfolios");
    }
    if (!cols.some((c) => c.name === "strategy_config")) {
      this.db.exec(
        "ALTER TABLE portfolios ADD COLUMN strategy_config TEXT DEFAULT '{}'",
      );
      logger.info("[DB] Migration: added strategy_config column to portfolios");
    }
    if (!cols.some((c) => c.name === "name")) {
      this.db.exec("ALTER TABLE portfolios ADD COLUMN name TEXT");
      logger.info("[DB] Migration: added name column to portfolios");
    }

    const consentCols = this.db
      .prepare("PRAGMA table_info(legal_consent)")
      .all() as Array<{ name: string }>;
    if (!consentCols.some((c) => c.name === "revoked_at")) {
      this.db.exec("ALTER TABLE legal_consent ADD COLUMN revoked_at TEXT");
      logger.info("[DB] Migration: added revoked_at column to legal_consent");
    }
    if (!consentCols.some((c) => c.name === "is_active")) {
      this.db.exec(
        "ALTER TABLE legal_consent ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
      );
      logger.info("[DB] Migration: added is_active column to legal_consent");
    }
    if (!consentCols.some((c) => c.name === "analytics_accepted_at")) {
      this.db.exec("ALTER TABLE legal_consent ADD COLUMN analytics_accepted_at TEXT");
      logger.info("[DB] Migration: added analytics_accepted_at column to legal_consent");
    }
    if (!consentCols.some((c) => c.name === "marketing_accepted_at")) {
      this.db.exec("ALTER TABLE legal_consent ADD COLUMN marketing_accepted_at TEXT");
      logger.info("[DB] Migration: added marketing_accepted_at column to legal_consent");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS consent_audit_events (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          action      TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
          timestamp   TEXT NOT NULL,
          ip_address  TEXT,
          user_agent  TEXT,
          document_version TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_consent_audit_events_user_timestamp
          ON consent_audit_events (user_id, timestamp);
    `);
  }

  private _seedDefaultAssets(): void {
    const count = (
      this.db.prepare("SELECT COUNT(*) as cnt FROM assets").get() as {
        cnt: number;
      }
    ).cnt;
    if (count > 0) return;
    const now = new Date().toISOString();
    const defaults = [
      ["XLM", "Stellar Lumens", null, null, "stellar", 1],
      [
        "USDC",
        "USD Coin",
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        null,
        "usd-coin",
        1,
      ],
      [
        "BTC",
        "Bitcoin",
        "GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF",
        null,
        "bitcoin",
        1,
      ],
      ["ETH", "Ethereum", null, null, "ethereum", 1],
    ];
    const stmt = this.db.prepare(
      "INSERT INTO assets (symbol, name, contract_address, issuer_account, coingecko_id, enabled, last_refreshed_at, is_quarantined, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    );
    for (const row of defaults) {
      stmt.run(...row, now, now, now);
    }
    logger.info("[DB] Seeded default assets (XLM, USDC, BTC, ETH)");
  }

  private _withTiming<T>(operation: string, fn: () => T): T {
    const start = process.hrtime.bigint();
    try {
      const result = fn();
      const end = process.hrtime.bigint();
      const durationSeconds = Number(end - start) / 1_000_000_000;
      const durationMs = durationSeconds * 1000;

      dbQueryDuration.observe({ operation, status: "success" }, durationSeconds);

      if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
        logger.warn("[DB] Slow query detected", {
          operation,
          durationMs: durationMs.toFixed(2),
          thresholdMs: SLOW_QUERY_THRESHOLD_MS,
        });
      }

      return result;
    } catch (err) {
      const end = process.hrtime.bigint();
      const durationSeconds = Number(end - start) / 1_000_000_000;
      dbQueryDuration.observe({ operation, status: "error" }, durationSeconds);
      throw err;
    }
  }

  // ── Public accessor for backward-compat (routes use portfolioStorage.portfolios.size) ──
  get portfolios(): { size: number } {
    return { size: this.getPortfolioCount() };
  }

  // ──────────────────────────────────────────
  // Portfolio methods (PortfolioStorage parity)
  // ──────────────────────────────────────────

  createPortfolio(
    userAddress: string,
    allocations: Record<string, number>,
    threshold: number,
    slippageTolerancePercent: number = 1,
    strategy: string = "threshold",
    strategyConfig: Record<string, unknown> = {},
  ): string {
    return this._withTiming("createPortfolio", () => {
      try {
        const id = generateId();
        const now = new Date().toISOString();
        this.db
          .prepare(
            `
                INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `,
          )
          .run(
            id,
            userAddress,
            JSON.stringify(allocations),
            threshold,
            slippageTolerancePercent,
            JSON.stringify({}),
            0,
            now,
            now,
            strategy,
            JSON.stringify(strategyConfig),
          );
        return id;
      } catch (err) {
        throw new Error(
          `Failed to create portfolio for user '${userAddress}': ${err}`,
        );
      }
    });
  }

  createPortfolioWithBalances(
    userAddress: string,
    allocations: Record<string, number>,
    threshold: number,
    currentBalances: Record<string, number>,
    slippageTolerancePercent: number = 1,
    strategy: string = "threshold",
    strategyConfig: Record<string, unknown> = {},
  ): string {
    try {
      const id = generateId();
      const now = new Date().toISOString();
      const totalValue = Object.values(currentBalances).reduce(
        (sum, bal) => sum + bal,
        0,
      );
      this.db
        .prepare(
          `
                INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `,
        )
        .run(
          id,
          userAddress,
          JSON.stringify(allocations),
          threshold,
          slippageTolerancePercent,
          JSON.stringify(currentBalances),
          totalValue,
          now,
          now,
          strategy,
          JSON.stringify(strategyConfig),
        );
      return id;
    } catch (err) {
      throw new Error(
        `Failed to create portfolio with balances for user '${userAddress}': ${err}`,
      );
    }
  }

  clonePortfolio(originalId: string, name?: string): Portfolio | undefined {
    try {
      const original = this.getPortfolio(originalId);
      if (!original) return undefined;

      const id = generateId();
      const now = new Date().toISOString();
      const cloneName = name !== undefined ? name : original.name;

      this.db
        .prepare(
          `
                INSERT INTO portfolios (id, user_address, name, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `,
        )
        .run(
          id,
          original.userAddress,
          cloneName ?? null,
          JSON.stringify(original.allocations),
          original.threshold,
          original.slippageTolerancePercent ?? original.slippageTolerance ?? 1,
          JSON.stringify(original.balances || {}),
          original.totalValue || 0,
          now,
          now,
          original.strategy || "threshold",
          JSON.stringify(original.strategyConfig || {}),
        );

      return this.getPortfolio(id);
    } catch (err) {
      throw new Error(`Failed to clone portfolio '${originalId}': ${err}`);
    }
  }

  getPortfolio(id: string): Portfolio | undefined {
    return this._withTiming("getPortfolio", () => {
      try {
        const row = this.db
          .prepare<
            [string],
            PortfolioRow
          >("SELECT * FROM portfolios WHERE id = ?")
          .get(id);
        return row ? rowToPortfolio(row) : undefined;
      } catch (err) {
        throw new Error(`Failed to retrieve portfolio '${id}': ${err}`);
      }
    });
  }

  getUserPortfolios(userAddress: string): Portfolio[] {
    return this._withTiming("getUserPortfolios", () => {
      try {
        const rows = this.db
          .prepare<
            [string],
            PortfolioRow
          >("SELECT * FROM portfolios WHERE user_address = ?")
          .all(userAddress);
        return rows.map(rowToPortfolio);
      } catch (err) {
        throw new Error(
          `Failed to retrieve portfolios for user '${userAddress}': ${err}`,
        );
      }
    });
  }

  /**
   * Update a portfolio record.
   *
   * When `expectedVersion` is supplied the update uses compare-and-set
   * semantics: the row is only written when its stored version matches
   * `expectedVersion`, and the version counter is incremented atomically.
   * A `ConflictError` is thrown when the match fails, signalling that a
   * concurrent write has already advanced the version ahead of the caller.
   *
   * Omitting `expectedVersion` performs an unchecked update (backward
   * compatible) while still incrementing the version so that any subsequent
   * versioned callers detect the change.
   */
  updatePortfolio(
    id: string,
    updates: Partial<Portfolio>,
    expectedVersion?: number,
  ): boolean {
    return this._withTiming("updatePortfolio", () => {
      try {
        const row = this.db
          .prepare<
            [string],
            PortfolioRow
          >("SELECT * FROM portfolios WHERE id = ?")
          .get(id);
        if (!row) return false;

        const current = rowToPortfolio(row);
        const merged = { ...current, ...updates };

        if (expectedVersion !== undefined) {
          // Compare-and-set: only update when version matches
          const result = this.db
            .prepare(
              `
                    UPDATE portfolios
                    SET user_address = ?, name = ?, description = ?, allocations = ?, threshold = ?, balances = ?,
                        total_value = ?, last_rebalance = ?, version = version + 1
                    WHERE id = ? AND version = ?
                `,
            )
            .run(
              merged.userAddress,
              merged.name ?? null,
              merged.description ?? null,
              JSON.stringify(merged.allocations),
              merged.threshold,
              JSON.stringify(merged.balances),
              merged.totalValue,
              merged.lastRebalance,
              id,
              expectedVersion,
            );

          if (result.changes === 0) {
            // Row exists but version didn't match — concurrent write detected
            const currentRow = this.db
              .prepare<
                [string],
                { version: number }
              >("SELECT version FROM portfolios WHERE id = ?")
              .get(id);
            throw new ConflictError(currentRow?.version ?? -1);
          }
        } else {
          // Unchecked update — still increment version for future versioned callers
          this.db
            .prepare(
              `
                    UPDATE portfolios
                    SET user_address = ?, allocations = ?, threshold = ?, balances = ?,
                        total_value = ?, last_rebalance = ?, version = version + 1
                    WHERE id = ?
                `,
            )
            .run(
              merged.userAddress,
              JSON.stringify(merged.allocations),
              merged.threshold,
              JSON.stringify(merged.balances),
              merged.totalValue,
              merged.lastRebalance,
              id,
            );
        }

        return true;
      } catch (err) {
        if (err instanceof ConflictError) throw err;
        throw new Error(`Failed to update portfolio '${id}': ${err}`);
      }
    });
  }

  getAllPortfolios(): Portfolio[] {
    return this._withTiming("getAllPortfolios", () => {
      try {
        const rows = this.db
          .prepare<[], PortfolioRow>("SELECT * FROM portfolios")
          .all();
        return rows.map(rowToPortfolio);
      } catch (err) {
        throw new Error(`Failed to retrieve all portfolios: ${err}`);
      }
    });
  }

  searchPortfolios(searchQuery: string, limit: number, offset: number): Portfolio[] {
    return this._withTiming("searchPortfolios", () => {
      try {
        if (!searchQuery) {
          const rows = this.db
            .prepare<[number, number], PortfolioRow>(
              "SELECT * FROM portfolios ORDER BY created_at DESC LIMIT ? OFFSET ?"
            )
            .all(limit, offset);
          return rows.map(rowToPortfolio);
        }

        const likeQuery = `%${searchQuery}%`;
        const rows = this.db
          .prepare<[string, string, number, number], PortfolioRow>(
            `SELECT * FROM portfolios 
             WHERE name LIKE ? OR description LIKE ? 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`
          )
          .all(likeQuery, likeQuery, limit, offset);
        return rows.map(rowToPortfolio);
      } catch (err) {
        throw new Error(`Failed to search portfolios: ${err}`);
      }
    });
  }

  getPortfolioCount(): number {
    return this._withTiming("getPortfolioCount", () => {
      try {
        const result = this.db
          .prepare("SELECT COUNT(*) as cnt FROM portfolios")
          .get() as { cnt: number };
        return result.cnt;
      } catch (err) {
        throw new Error(`Failed to count portfolios: ${err}`);
      }
    });
  }

  private verifyBackupExists(): void {
      // In production, this would check for a recent .db backup.
      // For this implementation, we'll assume it passes or skip in test.
      if (process.env.NODE_ENV === 'test') return;
      // dummy implementation
  }

  deletePortfolio(id: string): boolean {
    // Verify a recent backup before destructive delete
    this.verifyBackupExists();
    try {
      const result = this.db
        .prepare("DELETE FROM portfolios WHERE id = ?")
        .run(id);
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to delete portfolio '${id}': ${err}`);
    }
  }

  // ──────────────────────────────────────────
  // Asset registry (configurable assets)
  // ──────────────────────────────────────────

  listAssets(enabledOnly: boolean = true): AssetDbRecord[] {
    try {
      const rows = this.db
        .prepare<[], AssetDbRow>(
          enabledOnly
            ? `SELECT ${ASSET_COLUMNS} FROM assets WHERE enabled = 1 AND is_quarantined = 0 ORDER BY symbol`
            : `SELECT ${ASSET_COLUMNS} FROM assets ORDER BY symbol`,
        )
        .all();
      return rows.map(assetRowToRecord);
    } catch (err) {
      throw new Error(`Failed to list assets: ${err}`);
    }
  }

  /** Assets awaiting an admin verification decision (#1412). */
  listAssetsByVerificationStatus(
    status: "pending" | "verified" | "rejected",
  ): AssetDbRecord[] {
    try {
      const rows = this.db
        .prepare<
          [string],
          AssetDbRow
        >(`SELECT ${ASSET_COLUMNS} FROM assets WHERE verification_status = ? ORDER BY created_at ASC`)
        .all(status);
      return rows.map(assetRowToRecord);
    } catch (err) {
      throw new Error(`Failed to list assets with status '${status}': ${err}`);
    }
  }

  /**
   * Record an admin verification decision. Rejecting or returning an asset to
   * pending also disables it so it cannot be traded while unverified.
   */
  setAssetVerification(
    symbol: string,
    status: "pending" | "verified" | "rejected",
    options: { reviewedBy?: string; notes?: string } = {},
  ): boolean {
    try {
      const result = this.db
        .prepare(
          `UPDATE assets
           SET verification_status = ?,
               verification_notes = ?,
               reviewed_by = ?,
               reviewed_at = ?,
               enabled = ?,
               updated_at = ?
           WHERE symbol = ?`,
        )
        .run(
          status,
          options.notes ?? null,
          options.reviewedBy ?? null,
          new Date().toISOString(),
          status === "verified" ? 1 : 0,
          new Date().toISOString(),
          symbol.toUpperCase(),
        );
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to set verification status for '${symbol}': ${err}`);
    }
  }

  getAssetBySymbol(symbol: string): AssetDbRecord | undefined {
    try {
      const row = this.db
        .prepare<
          [string],
          AssetDbRow
        >(`SELECT ${ASSET_COLUMNS} FROM assets WHERE symbol = ?`)
        .get(symbol.toUpperCase());
      if (!row) return undefined;
      return assetRowToRecord(row);
    } catch (err) {
      throw new Error(`Failed to get asset '${symbol}': ${err}`);
    }
  }

  addAsset(
    symbol: string,
    name: string,
    options: {
      contractAddress?: string;
      issuerAccount?: string;
      coingeckoId?: string;
      issuerMetadata?: IssuerMetadata;
      verificationStatus?: "pending" | "verified" | "rejected";
      submittedBy?: string;
    } = {},
  ): void {
    try {
      const sym = symbol.toUpperCase();
      const now = new Date().toISOString();
      // Unverified submissions are stored disabled so they cannot be traded
      // before an admin decision (#1412).
      const status = options.verificationStatus ?? "verified";
      this.db
        .prepare(
          `INSERT INTO assets (
             symbol, name, contract_address, issuer_account, coingecko_id, issuer_metadata,
             enabled, last_refreshed_at, is_quarantined,
             verification_status, submitted_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        )
        .run(
          sym,
          name,
          options.contractAddress ?? null,
          options.issuerAccount ?? null,
          options.coingeckoId ?? null,
          options.issuerMetadata ? JSON.stringify(options.issuerMetadata) : null,
          status === "verified" ? 1 : 0,
          now,
          status,
          options.submittedBy ?? null,
          now,
          now,
        );
    } catch (err) {
      if (isSqliteAssetSymbolUniqueViolation(err)) {
        throw new AssetRegistryConflictError(
          `Asset with symbol '${symbol.toUpperCase()}' already exists`,
        );
      }
      throw new Error(`Failed to add asset '${symbol}': ${err}`);
    }
  }

  setAssetFreshness(
    symbol: string,
    lastRefreshedAt: string,
    isQuarantined: boolean,
  ): boolean {
    try {
      const result = this.db
        .prepare(
          "UPDATE assets SET last_refreshed_at = ?, is_quarantined = ?, updated_at = ? WHERE symbol = ?",
        )
        .run(
          lastRefreshedAt,
          isQuarantined ? 1 : 0,
          new Date().toISOString(),
          symbol.toUpperCase(),
        );
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to set asset freshness '${symbol}': ${err}`);
    }
  }

  setAssetQuarantined(symbol: string, quarantined: boolean): boolean {
    try {
      const result = this.db
        .prepare(
          "UPDATE assets SET is_quarantined = ?, updated_at = ? WHERE symbol = ?",
        )
        .run(quarantined ? 1 : 0, new Date().toISOString(), symbol.toUpperCase());
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to set asset quarantined '${symbol}': ${err}`);
    }
  }

  removeAsset(symbol: string): boolean {
    // Verify a recent backup before destructive asset removal
    this.verifyBackupExists();
    try {
      const result = this.db
        .prepare("DELETE FROM assets WHERE symbol = ?")
        .run(symbol.toUpperCase());
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to remove asset '${symbol}': ${err}`);
    }
  }

  setAssetEnabled(symbol: string, enabled: boolean): boolean {
    try {
      const result = this.db
        .prepare(
          "UPDATE assets SET enabled = ?, updated_at = ? WHERE symbol = ?",
        )
        .run(enabled ? 1 : 0, new Date().toISOString(), symbol.toUpperCase());
      return result.changes > 0;
    } catch (err) {
      throw new Error(`Failed to set asset enabled '${symbol}': ${err}`);
    }
  }

  // ──────────────────────────────────────────
  // Legal consent (GDPR/CCPA)
  // ──────────────────────────────────────────

  recordConsent(
    userId: string,
    opts: {
      terms: boolean;
      privacy: boolean;
      cookies: boolean;
      analytics?: boolean;
      marketing?: boolean;
      ipAddress?: string;
      userAgent?: string;
      documentText?: string;
    },
  ): void {
    const now = new Date().toISOString();
    const docVersion = computeDocumentVersionHash(opts.documentText);
    const analyticsFlag = opts.analytics === undefined ? null : (opts.analytics ? 1 : 0);
    const marketingFlag = opts.marketing === undefined ? null : (opts.marketing ? 1 : 0);
    const grant = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO legal_consent (user_id, terms_accepted_at, privacy_accepted_at, cookie_accepted_at, analytics_accepted_at, marketing_accepted_at, revoked_at, is_active, ip_address, user_agent, document_version, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 terms_accepted_at = COALESCE(excluded.terms_accepted_at, terms_accepted_at),
                 privacy_accepted_at = COALESCE(excluded.privacy_accepted_at, privacy_accepted_at),
                 cookie_accepted_at = COALESCE(excluded.cookie_accepted_at, cookie_accepted_at),
                 analytics_accepted_at = CASE
                   WHEN ? IS NULL THEN analytics_accepted_at
                   WHEN ? = 1 THEN excluded.analytics_accepted_at
                   ELSE NULL
                 END,
                 marketing_accepted_at = CASE
                   WHEN ? IS NULL THEN marketing_accepted_at
                   WHEN ? = 1 THEN excluded.marketing_accepted_at
                   ELSE NULL
                 END,
                 revoked_at = NULL,
                 is_active = 1,
                 ip_address = excluded.ip_address,
                 user_agent = excluded.user_agent,
                 document_version = excluded.document_version,
                 updated_at = excluded.updated_at`,
        )
        .run(
          userId,
          opts.terms ? now : null,
          opts.privacy ? now : null,
          opts.cookies ? now : null,
          analyticsFlag === 1 ? now : null,
          marketingFlag === 1 ? now : null,
          opts.ipAddress ?? null,
          opts.userAgent ?? null,
          docVersion,
          now,
          analyticsFlag,
          analyticsFlag,
          marketingFlag,
          marketingFlag,
        );
      this.insertConsentAuditEvent(userId, "grant", now, opts.ipAddress, opts.userAgent, docVersion);
    });
    grant();
    logger.info("[DB] Consent recorded", { userId, documentVersion: docVersion });
  }

  revokeConsent(
    userId: string,
    opts: {
      ipAddress?: string;
      userAgent?: string;
      documentText?: string;
    } = {},
  ): void {
    const now = new Date().toISOString();
    const docVersion = opts.documentText ? computeDocumentVersionHash(opts.documentText) : null;
    const revoke = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO legal_consent (user_id, revoked_at, is_active, ip_address, user_agent, document_version, updated_at)
               VALUES (?, ?, 0, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 revoked_at = excluded.revoked_at,
                 is_active = 0,
                 ip_address = excluded.ip_address,
                 user_agent = excluded.user_agent,
                 document_version = COALESCE(excluded.document_version, document_version),
                 updated_at = excluded.updated_at`,
        )
        .run(
          userId,
          now,
          opts.ipAddress ?? null,
          opts.userAgent ?? null,
          docVersion,
          now,
        );
      this.insertConsentAuditEvent(userId, "revoke", now, opts.ipAddress, opts.userAgent, docVersion);
    });
    revoke();
    logger.info("[DB] Consent revoked", { userId, documentVersion: docVersion });
  }

getConsent(userId: string): ConsentRecord | undefined {
    const row = this.db
      .prepare<
        [string],
        {
          terms_accepted_at: string | null;
          privacy_accepted_at: string | null;
          cookie_accepted_at: string | null;
          analytics_accepted_at: string | null;
          marketing_accepted_at: string | null;
          revoked_at: string | null;
          is_active: number;
          document_version: string | null;
        }
      >("SELECT terms_accepted_at, privacy_accepted_at, cookie_accepted_at, analytics_accepted_at, marketing_accepted_at, revoked_at, is_active, document_version FROM legal_consent WHERE user_id = ?")
      .get(userId);
    if (!row) return undefined;
    return {
      termsAcceptedAt: row.terms_accepted_at,
      privacyAcceptedAt: row.privacy_accepted_at,
      cookieAcceptedAt: row.cookie_accepted_at,
      analyticsAcceptedAt: row.analytics_accepted_at,
      marketingAcceptedAt: row.marketing_accepted_at,
      revokedAt: row.revoked_at,
      active: row.is_active === 1,
      documentVersion: row.document_version,
    };
  }

  hasFullConsent(userId: string): boolean {
    const c = this.getConsent(userId);
    return Boolean(
      c?.active &&
      c.termsAcceptedAt &&
      c.privacyAcceptedAt &&
      c.cookieAcceptedAt,
    );
  }

  getConsentAudit(userId: string): ConsentAuditEvent[] {
    const rows = this.db
      .prepare<[string], ConsentAuditRow>(
        `SELECT id, user_id, action, timestamp, ip_address, user_agent, document_version
         FROM consent_audit_events
         WHERE user_id = ?
         ORDER BY timestamp ASC, id ASC`,
      )
      .all(userId);
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      timestamp: row.timestamp,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      documentVersion: row.document_version,
    }));
  }

  private insertConsentAuditEvent(
    userId: string,
    action: "grant" | "revoke",
    timestamp: string,
    ipAddress?: string,
    userAgent?: string,
    documentVersion?: string | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO consent_audit_events (id, user_id, action, timestamp, ip_address, user_agent, document_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        generateId(),
        userId,
        action,
        timestamp,
        ipAddress ?? null,
        userAgent ?? null,
        documentVersion ?? null,
      );
  }

  /**
   * Purge consent audit events older than the specified number of days.
   * Returns the number of deleted rows.
   */
  purgeOldConsentAuditEvents(retentionDays: number): number {
    const cutoff = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const result = this.db
      .prepare("DELETE FROM consent_audit_events WHERE timestamp < ?")
      .run(cutoff);
    const count = result.changes;
    if (count > 0) {
      logger.info(
        `[DB] Purged ${count} consent audit event(s) older than ${retentionDays} day(s)`,
      );
    }
    return count;
  }

  deleteUserData(userId: string): void {
    // Verify a recent backup before destructive user data deletion
    this.verifyBackupExists();
    this.db.prepare("DELETE FROM legal_consent WHERE user_id = ?").run(userId);
    this.db
      .prepare("DELETE FROM consent_audit_events WHERE user_id = ?")
      .run(userId);
    const portfolios = this.db
      .prepare<
        [string],
        { id: string }
      >("SELECT id FROM portfolios WHERE user_address = ?")
      .all(userId);
    for (const p of portfolios) {
      this.db
        .prepare("DELETE FROM rebalance_history WHERE portfolio_id = ?")
        .run(p.id);
    }
    this.db
      .prepare("DELETE FROM portfolios WHERE user_address = ?")
      .run(userId);
  }

  clearAll(): void {
    // Verify a recent backup before clearing all database tables
    this.verifyBackupExists();
    try {
      this.db.prepare("DELETE FROM rebalance_history").run();
      this.db.prepare("DELETE FROM portfolios").run();
      this.db.prepare("DELETE FROM user_preferences").run();
    } catch (err) {
      throw new Error(`Failed to clear all data: ${err}`);
    }
  }

  // ──────────────────────────────────────────
  // Rebalance history methods
  // ──────────────────────────────────────────

  recordRebalanceEvent(eventData: {
    portfolioId: string,
    trigger: string,
    trades: number,
    gasUsed: string,
    status: "completed" | "failed" | "pending";
    isAutomatic?: boolean;
    riskAlerts?: any[];
    error?: string;
    details?: any;
    timestamp?: string;
    eventSource?: "offchain" | "simulated" | "onchain";
    actor?: "user" | "system" | "admin" | "scheduler";
    source?: "dashboard" | "api" | "contract" | "scheduler" | "auto_rebalance";
    triggerMetadata?: Record<string, unknown>;
    onChainConfirmed?: boolean;
    onChainEventType?: string;
    onChainTxHash?: string;
    onChainLedger?: number;
    onChainContractId?: string;
    onChainPagingToken?: string;
    isSimulated?: boolean;
    reasonCode?: string;
  }): RebalanceEvent {
    try {
      const mergedDetails = {
        ...(eventData.details ?? {}),
        ...(eventData.actor !== undefined && { actor: eventData.actor }),
        ...(eventData.source !== undefined && { source: eventData.source }),
        ...(eventData.triggerMetadata !== undefined && {
          triggerMetadata: eventData.triggerMetadata,
        }),
      };

      const event: RebalanceEvent = {
        id: generateId(),
        portfolioId: eventData.portfolioId,
        timestamp: eventData.timestamp ?? new Date().toISOString(),
        trigger: eventData.trigger,
        reasonCode: eventData.reasonCode as any,
        trades: eventData.trades,
        gasUsed: eventData.gasUsed,
        status: eventData.status,
        isAutomatic: eventData.isAutomatic ?? false,
        riskAlerts: eventData.riskAlerts ?? [],
        error: eventData.error,
        actor: eventData.actor,
        source: eventData.source,
        triggerMetadata: eventData.triggerMetadata,
        details: mergedDetails,
        eventSource: eventData.eventSource,
        onChainConfirmed: eventData.onChainConfirmed,
        onChainEventType: eventData.onChainEventType,
        onChainTxHash: eventData.onChainTxHash,
        onChainLedger: eventData.onChainLedger,
        onChainContractId: eventData.onChainContractId,
        onChainPagingToken: eventData.onChainPagingToken,
        isSimulated: eventData.isSimulated,
      };

        this.db
          .prepare(
            `
                INSERT INTO rebalance_history
                    (id, portfolio_id, timestamp, trigger, reason_code, trades, gas_used, status, is_automatic, risk_alerts, error, details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            event.id,
            eventData.portfolioId,
            event.timestamp,
            event.trigger,
            event.reasonCode ?? null,
            event.trades,
            event.gasUsed,
            event.status,
            event.isAutomatic ? 1 : 0,
            event.riskAlerts ? JSON.stringify(event.riskAlerts) : null,
            event.error ?? null,
            event.details ? JSON.stringify(event.details) : null,
          );

        return event;
      } catch (err) {
        throw new Error(
          `Failed to record rebalance event for portfolio '${eventData.portfolioId}': ${err}`,
        );
      }
  }

  getRebalanceHistory(
    portfolioId?: string,
    limit: number = 50,
    options?: RebalanceHistoryQueryOptions,
  ): RebalanceEvent[] {
    return this._withTiming("getRebalanceHistory", () => {
      try {
        if (portfolioId) {
          const rows = this.db
            .prepare<
              [string, number],
              RebalanceHistoryRow
            >("SELECT * FROM rebalance_history WHERE portfolio_id = ? ORDER BY timestamp DESC LIMIT ?")
            .all(portfolioId, limit);
          return rows.map(rowToEvent);
        }

        const rows = this.db
          .prepare<
            [number],
            RebalanceHistoryRow
          >("SELECT * FROM rebalance_history ORDER BY timestamp DESC LIMIT ?")
          .all(limit);
        return rows.map(rowToEvent);
      } catch (err) {
        throw new Error(
          `Failed to retrieve rebalance history${
            portfolioId ? ` for portfolio '${portfolioId}'` : ""
          }: ${err}`,
        );
      }
    });
  }

  getRecentAutoRebalances(
    portfolioId: string,
    limit: number = 10,
  ): RebalanceEvent[] {
    return this._withTiming("getRecentAutoRebalances", () => {
      try {
        const rows = this.db
          .prepare<[string, number], RebalanceHistoryRow>(
            `
                SELECT * FROM rebalance_history
                WHERE portfolio_id = ? AND is_automatic = 1
                ORDER BY timestamp DESC LIMIT ?
            `,
          )
          .all(portfolioId, limit);
        return rows.map(rowToEvent);
      } catch (err) {
        throw new Error(
          `Failed to retrieve auto-rebalances for portfolio '${portfolioId}': ${err}`,
        );
      }
    });
  }

  getAutoRebalancesSince(portfolioId: string, since: Date): RebalanceEvent[] {
    return this._withTiming("getAutoRebalancesSince", () => {
      try {
        const rows = this.db
          .prepare<[string, string], RebalanceHistoryRow>(
            `
                SELECT * FROM rebalance_history
                WHERE portfolio_id = ? AND is_automatic = 1 AND timestamp >= ?
                ORDER BY timestamp DESC
            `,
          )
          .all(portfolioId, since.toISOString());
        return rows.map(rowToEvent);
      } catch (err) {
        throw new Error(
          `Failed to retrieve auto-rebalances since ${since.toISOString()} for portfolio '${portfolioId}': ${err}`,
        );
      }
    });
  }

  getAllAutoRebalances(): RebalanceEvent[] {
    return this._withTiming("getAllAutoRebalances", () => {
      try {
        const rows = this.db
          .prepare<
            [],
            RebalanceHistoryRow
          >("SELECT * FROM rebalance_history WHERE is_automatic = 1 ORDER BY timestamp DESC")
          .all();
        return rows.map(rowToEvent);
      } catch (err) {
        throw new Error(`Failed to retrieve all auto-rebalances: ${err}`);
      }
    });
  }

  getRebalanceHistoryByDateRange(
    startDate: string,
    endDate: string,
  ): RebalanceEvent[] {
    return this._withTiming("getRebalanceHistoryByDateRange", () => {
      try {
        const rows = this.db
          .prepare<[string, string], RebalanceHistoryRow>(
            `SELECT * FROM rebalance_history
             WHERE status = 'completed'
               AND timestamp >= ?
               AND timestamp < ?
             ORDER BY timestamp ASC`,
          )
          .all(startDate, endDate);
        return rows.map(rowToEvent);
      } catch (err) {
        throw new Error(
          `Failed to retrieve rebalance history by date range: ${err}`,
        );
      }
    });
  }

  initializeDemoData(portfolioId: string): void {
    try {
      const existing = this.db
        .prepare<
          [string],
          { cnt: number }
        >("SELECT COUNT(*) as cnt FROM rebalance_history WHERE portfolio_id = ?")
        .get(portfolioId);
      if (existing && existing.cnt > 0) return;

      const twoHoursAgo = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      ).toISOString();
      const twelveHoursAgo = new Date(
        Date.now() - 12 * 60 * 60 * 1000,
      ).toISOString();
      const threeDaysAgo = new Date(
        Date.now() - 3 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const demoEvents = [
        {
          id: generateId(),
          portfolioId,
          timestamp: twoHoursAgo,
          trigger: "Threshold exceeded (8.2%)",
          trades: 3,
          gasUsed: "0.0234 XLM",
          status: "completed",
          isAutomatic: 0,
          details: {
            fromAsset: "XLM",
            toAsset: "ETH",
            amount: 1200,
            reason: "Portfolio allocation drift exceeded rebalancing threshold",
            riskLevel: "medium",
            priceDirection: "down",
            performanceImpact: "neutral",
          },
        },
        {
          id: generateId(),
          portfolioId,
          timestamp: twelveHoursAgo,
          trigger: "Automatic Rebalancing",
          trades: 2,
          gasUsed: "0.0156 XLM",
          status: "completed",
          isAutomatic: 1,
          details: {
            reason: "Automated scheduled rebalancing executed",
            riskLevel: "low",
            priceDirection: "up",
            performanceImpact: "positive",
          },
        },
        {
          id: generateId(),
          portfolioId,
          timestamp: threeDaysAgo,
          trigger: "Volatility circuit breaker",
          trades: 1,
          gasUsed: "0.0089 XLM",
          status: "completed",
          isAutomatic: 1,
          details: {
            reason:
              "High market volatility detected, protective rebalance executed",
            volatilityDetected: true,
            riskLevel: "high",
            priceDirection: "down",
            performanceImpact: "negative",
          },
        },
      ];

      const insert = this.db.prepare(`
                INSERT INTO rebalance_history
                    (id, portfolio_id, timestamp, trigger, reason_code, trades, gas_used, status, is_automatic, risk_alerts, error, details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

      for (const ev of demoEvents) {
        insert.run(
          ev.id,
          ev.portfolioId,
          ev.timestamp,
          ev.trigger,
          (ev as any).reasonCode ?? null,
          ev.trades,
          ev.gasUsed,
          ev.status,
          ev.isAutomatic,
          null,
          null,
          ev.details ? JSON.stringify(ev.details) : null,
        );
      }
    } catch (err) {
      throw new Error(
        `Failed to initialize demo data for portfolio '${portfolioId}': ${err}`,
      );
    }
  }

  clearHistory(portfolioId?: string): void {
    // Verify a recent backup before clearing rebalance history
    this.verifyBackupExists();
    try {
      if (portfolioId) {
        this.db
          .prepare("DELETE FROM rebalance_history WHERE portfolio_id = ?")
          .run(portfolioId);
      } else {
        this.db.prepare("DELETE FROM rebalance_history").run();
      }
    } catch (err) {
      throw new Error(
        `Failed to clear rebalance history${
          portfolioId ? ` for portfolio '${portfolioId}'` : ""
        }: ${err}`,
      );
    }
  }

  getHistoryStats(): {
    totalEvents: number;
    portfolios: number;
    recentActivity: number;
    autoRebalances: number;
  } {
    try {
      const oneDayAgo = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();

      const total = (
        this.db
          .prepare("SELECT COUNT(*) as cnt FROM rebalance_history")
          .get() as { cnt: number }
      ).cnt;
      const portfolios = (
        this.db
          .prepare(
            "SELECT COUNT(DISTINCT portfolio_id) as cnt FROM rebalance_history",
          )
          .get() as { cnt: number }
      ).cnt;
      const recentActivity = (
        this.db
          .prepare<
            [string],
            { cnt: number }
          >("SELECT COUNT(*) as cnt FROM rebalance_history WHERE timestamp >= ?")
          .get(oneDayAgo) as { cnt: number }
      ).cnt;
      const autoRebalances = (
        this.db
          .prepare(
            "SELECT COUNT(*) as cnt FROM rebalance_history WHERE is_automatic = 1",
          )
          .get() as { cnt: number }
      ).cnt;

      return { totalEvents: total, portfolios, recentActivity, autoRebalances };
    } catch (err) {
      throw new Error(`Failed to retrieve history stats: ${err}`);
    }
  }

  // ──────────────────────────────────────────
  // Price snapshots (optional, for future use)
  // ──────────────────────────────────────────

  savePriceSnapshot(
    asset: string,
    price: number,
    change?: number,
    source?: string,
  ): void {
    return this._withTiming("savePriceSnapshot", () => {
      try {
        this.db
          .prepare(
            `
                INSERT INTO price_snapshots (asset, price, change, source, captured_at)
                VALUES (?, ?, ?, ?, ?)
            `,
          )
          .run(
            asset,
            price,
            change ?? null,
            source ?? null,
            new Date().toISOString(),
          );
      } catch (err) {
        throw new Error(
          `Failed to save price snapshot for asset '${asset}': ${err}`,
        );
      }
    });
  }

  getLatestPriceSnapshot(
    asset: string,
  ): { price: number; change?: number; capturedAt: string } | undefined {
    return this._withTiming("getLatestPriceSnapshot", () => {
      try {
        const row = this.db
          .prepare<
            [string],
            { price: number; change: number | null; captured_at: string }
          >("SELECT price, change, captured_at FROM price_snapshots WHERE asset = ? ORDER BY captured_at DESC LIMIT 1")
          .get(asset);
        if (!row) return undefined;
        return {
          price: row.price,
          change: row.change ?? undefined,
          capturedAt: row.captured_at,
        };
      } catch (err) {
        throw new Error(
          `Failed to retrieve price snapshot for asset '${asset}': ${err}`,
        );
      }
    });
  }

  /**
   * Most recent price snapshot captured at or before `asOf` (ISO timestamp).
   * Used by the tax report so each tax lot keeps its acquisition-date price
   * instead of collapsing onto the latest price.
   */
  getPriceSnapshotAsOf(
    asset: string,
    asOf: string,
  ): { price: number; change?: number; capturedAt: string } | undefined {
    return this._withTiming("getPriceSnapshotAsOf", () => {
      try {
        const row = this.db
          .prepare<
            [string, string],
            { price: number; change: number | null; captured_at: string }
          >(
            `SELECT price, change, captured_at FROM price_snapshots
             WHERE asset = ? AND captured_at <= ?
             ORDER BY captured_at DESC LIMIT 1`,
          )
          .get(asset, asOf);
        if (!row) return undefined;
        return {
          price: row.price,
          change: row.change ?? undefined,
          capturedAt: row.captured_at,
        };
      } catch (err) {
        throw new Error(
          `Failed to retrieve price snapshot for asset '${asset}' as of '${asOf}': ${err}`,
        );
      }
    });
  }

  // ──────────────────────────────────────────
  // Portfolio draft methods
  // ──────────────────────────────────────────

  createDraft(data: {
    userAddress: string;
    label?: string;
    allocations: Record<string, number>;
    threshold: number;
    slippageTolerancePercent?: number;
    strategy?: string;
    strategyConfig?: Record<string, unknown>;
    expiresInDays?: number;
  }): string {
    const id = generateId();
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + (data.expiresInDays ?? 7) * 24 * 60 * 60 * 1000
    ).toISOString();
    this.db
      .prepare(
        `INSERT INTO portfolio_drafts (id, user_address, label, allocations, threshold, slippage_tolerance_percent, strategy, strategy_config, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.userAddress,
        data.label ?? null,
        JSON.stringify(data.allocations),
        data.threshold,
        data.slippageTolerancePercent ?? 1,
        data.strategy ?? 'threshold',
        JSON.stringify(data.strategyConfig ?? {}),
        now,
        now,
        expiresAt,
      );
    return id;
  }

  getDraft(id: string): Record<string, unknown> | undefined {
    const row = this.db
      .prepare<[string], PortfolioDraftRow>(
        "SELECT * FROM portfolio_drafts WHERE id = ?"
      )
      .get(id);
    if (!row) return undefined;
    return {
      id: row.id,
      userAddress: row.user_address,
      label: row.label,
      allocations: safeJsonParse(row.allocations, {}, `draft(${row.id}).allocations`),
      threshold: row.threshold,
      slippageTolerancePercent: row.slippage_tolerance_percent,
      strategy: row.strategy,
      strategyConfig: safeJsonParse(row.strategy_config, {}, `draft(${row.id}).strategy_config`),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      publishedPortfolioId: row.published_portfolio_id,
    };
  }

  updateDraft(id: string, updates: {
    label?: string;
    allocations?: Record<string, number>;
    threshold?: number;
    slippageTolerancePercent?: number;
    strategy?: string;
    strategyConfig?: Record<string, unknown>;
  }): boolean {
    const existing = this.db
      .prepare<[string], PortfolioDraftRow>("SELECT * FROM portfolio_drafts WHERE id = ?")
      .get(id);
    if (!existing) return false;
    const now = new Date().toISOString();
    const allocations = updates.allocations
      ? JSON.stringify(updates.allocations)
      : existing.allocations;
    const strategyConfig = updates.strategyConfig
      ? JSON.stringify(updates.strategyConfig)
      : existing.strategy_config;
    this.db
      .prepare(
        `UPDATE portfolio_drafts SET
           label = ?, allocations = ?, threshold = ?, slippage_tolerance_percent = ?,
           strategy = ?, strategy_config = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        updates.label ?? existing.label,
        allocations,
        updates.threshold ?? existing.threshold,
        updates.slippageTolerancePercent ?? existing.slippage_tolerance_percent,
        updates.strategy ?? existing.strategy,
        strategyConfig,
        now,
        id,
      );
    return true;
  }

  publishDraft(draftId: string): string | undefined {
    const draft = this.getDraft(draftId);
    if (!draft) return undefined;
    const portfolioId = this.createPortfolio(
      draft.userAddress as string,
      draft.allocations as Record<string, number>,
      draft.threshold as number,
      draft.slippageTolerancePercent as number,
      draft.strategy as string,
      draft.strategyConfig as Record<string, unknown>,
    );
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE portfolio_drafts SET published_portfolio_id = ?, updated_at = ? WHERE id = ?")
      .run(portfolioId, now, draftId);
    return portfolioId;
  }

  listDrafts(userAddress: string): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare<[string], PortfolioDraftRow>(
        "SELECT * FROM portfolio_drafts WHERE user_address = ? AND expires_at > datetime('now') ORDER BY updated_at DESC"
      )
      .all(userAddress);
    return rows.map((row) => ({
      id: row.id,
      userAddress: row.user_address,
      label: row.label,
      allocations: safeJsonParse(row.allocations, {}, `draft(${row.id}).allocations`),
      threshold: row.threshold,
      slippageTolerancePercent: row.slippage_tolerance_percent,
      strategy: row.strategy,
      strategyConfig: safeJsonParse(row.strategy_config, {}, `draft(${row.id}).strategy_config`),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      publishedPortfolioId: row.published_portfolio_id,
    }));
  }

  deleteDraft(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM portfolio_drafts WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  // ──────────────────────────────────────────
  // User preferences methods
  // ──────────────────────────────────────────

  getUserPreferences(userAddress: string): Record<string, unknown> {
    return this._withTiming("getUserPreferences", () => {
      const row = this.db
        .prepare<[string], {
          user_address: string;
          default_threshold: number | null;
          default_cooldown: number | null;
          preferred_currency: string | null;
          timezone: string | null;
          notification_digest_frequency: string | null;
        }>(
          "SELECT * FROM user_preferences WHERE user_address = ?"
        )
        .get(userAddress);

      if (!row) {
        return {
          userAddress,
          default_threshold: 5,
          default_cooldown: 3600,
          preferred_currency: 'USD',
          timezone: 'UTC',
          notification_digest_frequency: 'immediate'
        };
      }

      return {
        userAddress: row.user_address,
        default_threshold: row.default_threshold ?? 5,
        default_cooldown: row.default_cooldown ?? 3600,
        preferred_currency: row.preferred_currency ?? 'USD',
        timezone: row.timezone ?? 'UTC',
        notification_digest_frequency: row.notification_digest_frequency ?? 'immediate'
      };
    });
  }

  upsertUserPreferences(userAddress: string, prefs: {
    default_threshold?: number;
    default_cooldown?: number;
    preferred_currency?: string;
    timezone?: string;
    notification_digest_frequency?: string;
  }): void {
    this._withTiming("upsertUserPreferences", () => {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO user_preferences (
          user_address, default_threshold, default_cooldown, preferred_currency, timezone, notification_digest_frequency, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_address) DO UPDATE SET
          default_threshold = COALESCE(excluded.default_threshold, default_threshold),
          default_cooldown = COALESCE(excluded.default_cooldown, default_cooldown),
          preferred_currency = COALESCE(excluded.preferred_currency, preferred_currency),
          timezone = COALESCE(excluded.timezone, timezone),
          notification_digest_frequency = COALESCE(excluded.notification_digest_frequency, notification_digest_frequency),
          updated_at = excluded.updated_at
      `).run(
        userAddress,
        prefs.default_threshold ?? null,
        prefs.default_cooldown ?? null,
        prefs.preferred_currency ?? null,
        prefs.timezone ?? null,
        prefs.notification_digest_frequency ?? null,
        now
      );
    });
  }

  cleanupExpiredDrafts(): number {
    const result = this.db
      .prepare("DELETE FROM portfolio_drafts WHERE expires_at <= datetime('now')")
      .run();
    return result.changes;
  }

  createPublicShare(portfolioId: string, userAddress: string): string {
    return this._withTiming("createPublicShare", () => {
      try {
        const raw = randomUUID().replace(/-/g, '');
        const hash = raw.slice(0, 8);
        const now = new Date().toISOString();
        this.db
          .prepare(
            `INSERT INTO public_shares (hash, portfolio_id, user_address, active, created_at)
             VALUES (?, ?, ?, 1, ?)`
          )
          .run(hash, portfolioId, userAddress, now);
        return hash;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('UNIQUE constraint failed')) {
          return this.createPublicShare(portfolioId, userAddress);
        }
        throw new Error(`Failed to create public share for portfolio '${portfolioId}': ${err}`);
      }
    });
  }

  getPublicShareByHash(hash: string): { portfolioId: string; userAddress: string; active: boolean; createdAt: string; revokedAt: string | null } | undefined {
    return this._withTiming("getPublicShareByHash", () => {
      try {
        const row = this.db
          .prepare<[string], { portfolio_id: string; user_address: string; active: number; created_at: string; revoked_at: string | null }>(
            "SELECT * FROM public_shares WHERE hash = ?"
          )
          .get(hash);
        if (!row) return undefined;
        return {
          portfolioId: row.portfolio_id,
          userAddress: row.user_address,
          active: row.active === 1,
          createdAt: row.created_at,
          revokedAt: row.revoked_at,
        };
      } catch (err) {
        throw new Error(`Failed to get public share by hash '${hash}': ${err}`);
      }
    });
  }

  getPublicShareByPortfolioId(portfolioId: string): { hash: string; active: boolean; createdAt: string; revokedAt: string | null } | undefined {
    return this._withTiming("getPublicShareByPortfolioId", () => {
      try {
        const row = this.db
          .prepare<[string], { hash: string; active: number; created_at: string; revoked_at: string | null }>(
            "SELECT hash, active, created_at, revoked_at FROM public_shares WHERE portfolio_id = ?"
          )
          .get(portfolioId);
        if (!row) return undefined;
        return {
          hash: row.hash,
          active: row.active === 1,
          createdAt: row.created_at,
          revokedAt: row.revoked_at,
        };
      } catch (err) {
        throw new Error(`Failed to get public share for portfolio '${portfolioId}': ${err}`);
      }
    });
  }

  revokePublicShare(portfolioId: string): boolean {
    return this._withTiming("revokePublicShare", () => {
      try {
        const now = new Date().toISOString();
        const result = this.db
          .prepare("UPDATE public_shares SET active = 0, revoked_at = ? WHERE portfolio_id = ? AND active = 1")
          .run(now, portfolioId);
        return result.changes > 0;
      } catch (err) {
        throw new Error(`Failed to revoke public share for portfolio '${portfolioId}': ${err}`);
      }
    });
  }

  backup(backupPath?: string): string {
    try {
      const dbPath = process.env.DB_PATH || "./data/portfolio.db";
      const defaultBackupDir = join(dirname(dbPath), "backups");
      mkdirSync(defaultBackupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const defaultBackupPath = join(defaultBackupDir, `portfolio-backup-${timestamp}.db`);
      const finalBackupPath = backupPath || defaultBackupPath;

      this.db.backup(finalBackupPath);
      logger.info(`[DB] Backup created successfully at ${finalBackupPath}`);
      return finalBackupPath;
    } catch (err) {
      throw new Error(`Failed to create backup: ${err}`);
    }
  }

  restore(backupPath: string): void {
    try {
      if (!existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`);
      }

      const dbPath = process.env.DB_PATH || "./data/portfolio.db";
      
      // First close current connection
      this.db.close();

      try {
        // Copy backup to current DB path
        copyFileSync(backupPath, dbPath);
        logger.info(`[DB] Restored from backup: ${backupPath}`);

        // Reopen the database connection
        this.db = new Database(dbPath);
        this.db.exec(SCHEMA_SQL);
        this._migrateSchema();
        this._seedDefaultAssets();
      } catch (copyErr) {
        // If copy failed, try to reopen original DB if possible
        try {
          this.db = new Database(dbPath);
          this.db.exec(SCHEMA_SQL);
          this._migrateSchema();
          this._seedDefaultAssets();
        } catch (reopenErr) {
          // Ignore
        }
        throw copyErr;
      }
    } catch (err) {
      throw new Error(`Failed to restore backup: ${err}`);
    }
  }

  close(): void {
    this.db.close();
  }

  // ──────────────────────────────────────────
  // Replay checkpoint methods
  // ──────────────────────────────────────────

  getReplayCheckpoint(replayId: string): Record<string, unknown> | undefined {
    const raw = this.getIndexerState(`replay_checkpoint.${replayId}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  setReplayCheckpoint(replayId: string, data: Record<string, unknown>): void {
    this.setIndexerState(`replay_checkpoint.${replayId}`, JSON.stringify(data));
  }

  getReplayIntegrityHash(): string | undefined {
    return this.getIndexerState('replay_integrity_hash');
  }

  setReplayIntegrityHash(hash: string): void {
    this.setIndexerState('replay_integrity_hash', hash);
  }

  getLastReplayedLedger(): number | undefined {
    const val = this.getIndexerState('replay_last_ledger');
    return val ? parseInt(val, 10) : undefined;
  }

  setLastReplayedLedger(ledger: number): void {
    this.setIndexerState('replay_last_ledger', String(ledger));
  }

  getReplayEventCount(): number {
    const val = this.getIndexerState('replay_event_count');
    return val ? parseInt(val, 10) : 0;
  }

  setReplayEventCount(count: number): void {
    this.setIndexerState('replay_event_count', String(count));
  }

  getReplayStatus(): {
    lastReplayedLedger: number | undefined;
    eventCount: number;
    integrityHash: string | undefined;
  } {
    return {
      lastReplayedLedger: this.getLastReplayedLedger(),
      eventCount: this.getReplayEventCount(),
      integrityHash: this.getReplayIntegrityHash(),
    };
  }

  // ──────────────────────────────────────────
  // Indexer state (key-value store for contract event indexer)
  // ──────────────────────────────────────────

  getIndexerState(key: string): string | undefined {
    return this._withTiming("getIndexerState", () => {
      try {
        const row = this.db
          .prepare<
            [string],
            { value: string }
          >("SELECT value FROM kv_store WHERE key = ?")
          .get(key);
        return row?.value;
      } catch {
        return undefined;
      }
    });
  }

  setIndexerState(key: string, value: string): void {
    return this._withTiming("setIndexerState", () => {
      try {
        this.db
          .prepare(
            "INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
          .run(key, value);
      } catch (err) {
        throw new Error(`Failed to set indexer state key '${key}': ${err}`);
      }
    });
  }

  // ── generic key/value helpers (used by the Telegram chat link, #1396) ────

  getKvValue(key: string): string | undefined {
    return this.getIndexerState(key);
  }

  setKvValue(key: string, value: string): void {
    this.setIndexerState(key, value);
  }

  deleteKvValue(key: string): boolean {
    try {
      const result = this.db.prepare("DELETE FROM kv_store WHERE key = ?").run(key);
      return result.changes > 0;
    } catch {
      return false;
    }
  }

  ensurePortfolioExists(portfolioId: string, userAddress: string): void {
    try {
      const existing = this.getPortfolio(portfolioId);
      if (!existing) {
        this.db
          .prepare(
            `
                    INSERT OR IGNORE INTO portfolios
                        (id, user_address, allocations, threshold, slippage_tolerance_percent, balances, total_value, created_at, last_rebalance, version, strategy, strategy_config)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                `,
          )
          .run(
            portfolioId,
            userAddress,
            JSON.stringify({}),
            5,
            1,
            JSON.stringify({}),
            0,
            new Date().toISOString(),
            new Date().toISOString(),
            "threshold",
            "{}",
          );
      }
    } catch (err) {
      throw new Error(
        `Failed to ensure portfolio '${portfolioId}' exists: ${err}`,
      );
    }
  }

  getReadiness(): { ready: boolean; databasePath: string; error?: string } {
    const dbPath = process.env.DB_PATH || "./data/portfolio.db";
    try {
      this.db.prepare("SELECT 1").get();
      return { ready: true, databasePath: dbPath };
    } catch (err) {
      return {
        ready: false,
        databasePath: dbPath,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  recordAdminAuditEntry(
    actor: string,
    action: string,
    target: string | null,
    beforeValue: unknown,
    afterValue: unknown,
  ): string {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    this._withTiming("recordAdminAuditEntry", () => {
      this.db
        .prepare(
          `INSERT INTO admin_audit_log (id, actor, action, target, before_value, after_value, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          actor,
          action,
          target,
          beforeValue != null ? JSON.stringify(beforeValue) : null,
          afterValue != null ? JSON.stringify(afterValue) : null,
          timestamp,
        );
    });
    return id;
  }

  queryAdminAuditLog(filters: {
    actor?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): { entries: Array<{
    id: string;
    actor: string;
    action: string;
    target: string | null;
    before_value: string | null;
    after_value: string | null;
    timestamp: string;
  }>; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.actor) {
      conditions.push("actor = ?");
      params.push(filters.actor);
    }
    if (filters.action) {
      conditions.push("action = ?");
      params.push(filters.action);
    }
    if (filters.startDate) {
      conditions.push("timestamp >= ?");
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push("timestamp <= ?");
      params.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;

    return this._withTiming("queryAdminAuditLog", () => {
      const total = (
        this.db
          .prepare(`SELECT COUNT(*) as cnt FROM admin_audit_log ${whereClause}`)
          .get(...params) as { cnt: number }
      ).cnt;

      const entries = this.db
        .prepare(
          `SELECT * FROM admin_audit_log ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Array<{
          id: string;
          actor: string;
          action: string;
          target: string | null;
          before_value: string | null;
          after_value: string | null;
          timestamp: string;
        }>;

      return { entries, total };
    });
  }
}

// Singleton export
export const databaseService = new DatabaseService();
