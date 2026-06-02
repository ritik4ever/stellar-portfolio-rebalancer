import { Queue } from "bullmq";
import { getConnectionOptions } from "./connection.js";
import { logger } from "../utils/logger.js";

export const QUEUE_NAMES = {
  PORTFOLIO_CHECK: "portfolio-check",
  REBALANCE: "rebalance",
  ANALYTICS_SNAPSHOT: "analytics-snapshot",
  ANALYTICS_COMPACTION: "analytics-compaction",
  IDEMPOTENCY_CLEANUP: "idempotency-cleanup",
} as const;

export interface PortfolioCheckJobData {
  triggeredBy?: "scheduler" | "manual" | "startup";
  correlationId?: string;
}

export interface RebalanceJobData {
  portfolioId: string;
  triggeredBy?: "auto" | "manual" | "force";
  correlationId?: string;
}

export interface AnalyticsSnapshotJobData {
  triggeredBy?: "scheduler" | "manual" | "startup";
  correlationId?: string;
}

export interface AnalyticsCompactionJobData {
  triggeredBy?: "scheduler" | "manual";
  correlationId?: string;
  cutoffDays?: number;
  recentDays?: number;
}

export interface IdempotencyCleanupJobData {
    triggeredBy?: 'scheduler' | 'manual' | 'startup'
    correlationId?: string
}

export interface PortfolioExportJobData {
    portfolioId: string
    format: 'json' | 'csv' | 'pdf'
    userId?: string
}

export interface PortfolioExportResult {
    contentType: string
    filename: string
    bodyBase64?: string
    bodyString?: string
}

// ─── Singleton Queues ─────────────────────────────────────────────────────────

let portfolioCheckQueue: Queue<PortfolioCheckJobData> | null = null;
let rebalanceQueue: Queue<RebalanceJobData> | null = null;
let analyticsSnapshotQueue: Queue<AnalyticsSnapshotJobData> | null = null;
let analyticsCompactionQueue: Queue<AnalyticsCompactionJobData> | null = null;
let idempotencyCleanupQueue: Queue<IdempotencyCleanupJobData> | null = null;

function getDefaultJobOptions() {
  return {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
    attempts: 5,
    backoff: {
      type: "exponential" as const,
      delay: 5000, // 5s → 10s → 20s → 40s → 80s
    },
  };
}

export function getPortfolioCheckQueue(): Queue<PortfolioCheckJobData> | null {
  try {
    if (!portfolioCheckQueue) {
      portfolioCheckQueue = new Queue(QUEUE_NAMES.PORTFOLIO_CHECK, {
        connection: getConnectionOptions(),
        defaultJobOptions: getDefaultJobOptions(),
      });
      logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.PORTFOLIO_CHECK}`);
    }
    return portfolioCheckQueue;
  } catch {
    return null;
  }
}

export function getRebalanceQueue(): Queue<RebalanceJobData> | null {
  try {
    if (!rebalanceQueue) {
      rebalanceQueue = new Queue(QUEUE_NAMES.REBALANCE, {
        connection: getConnectionOptions(),
        defaultJobOptions: getDefaultJobOptions(),
      });
      logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.REBALANCE}`);
    }
    return rebalanceQueue;
  } catch {
    return null;
  }
}

export function getAnalyticsSnapshotQueue(): Queue<AnalyticsSnapshotJobData> | null {
  try {
    if (!analyticsSnapshotQueue) {
      analyticsSnapshotQueue = new Queue(QUEUE_NAMES.ANALYTICS_SNAPSHOT, {
        connection: getConnectionOptions(),
        defaultJobOptions: getDefaultJobOptions(),
      });
      logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.ANALYTICS_SNAPSHOT}`);
    }
    return analyticsSnapshotQueue;
  } catch {
    return null;
  }
}

export function getAnalyticsCompactionQueue(): Queue<AnalyticsCompactionJobData> | null {
  try {
    if (!analyticsCompactionQueue) {
      analyticsCompactionQueue = new Queue(QUEUE_NAMES.ANALYTICS_COMPACTION, {
        connection: getConnectionOptions(),
        defaultJobOptions: getDefaultJobOptions(),
      });
      logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.ANALYTICS_COMPACTION}`);
    }
    return analyticsCompactionQueue;
  } catch {
    return null;
  }
}

export function getIdempotencyCleanupQueue(): Queue<IdempotencyCleanupJobData> | null {
  try {
    if (!idempotencyCleanupQueue) {
      idempotencyCleanupQueue = new Queue(QUEUE_NAMES.IDEMPOTENCY_CLEANUP, {
        connection: getConnectionOptions(),
        defaultJobOptions: getDefaultJobOptions(),
      });
      logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.IDEMPOTENCY_CLEANUP}`);
    }
    return idempotencyCleanupQueue;
  } catch {
    return null;
  }
}

export function getPortfolioExportQueue(): Queue<PortfolioExportJobData, PortfolioExportResult> | null {
    try {
        if (!portfolioExportQueue) {
            portfolioExportQueue = new Queue<PortfolioExportJobData, PortfolioExportResult>(QUEUE_NAMES.PORTFOLIO_EXPORT, {
                connection: getConnectionOptions(),
                defaultJobOptions: getDefaultJobOptions(),
            })
            logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.PORTFOLIO_EXPORT}`)
        }
        return portfolioExportQueue
    } catch {
        return null
    }
}

// ─── Graceful Close ───────────────────────────────────────────────────────────

export async function closeAllQueues(): Promise<void> {
  await Promise.all([
    portfolioCheckQueue?.close(),
    rebalanceQueue?.close(),
    analyticsSnapshotQueue?.close(),
    analyticsCompactionQueue?.close(),
    idempotencyCleanupQueue?.close(),
  ]);
  portfolioCheckQueue = null;
  rebalanceQueue = null;
  analyticsSnapshotQueue = null;
  analyticsCompactionQueue = null;
  idempotencyCleanupQueue = null;
  logger.info("[QUEUE] All queues closed");
}
