import { Queue } from "bullmq";
import { getConnectionOptions } from "./connection.js";
import { logger } from "../utils/logger.js";

export const QUEUE_NAMES = {
  PORTFOLIO_CHECK: "portfolio-check",
  REBALANCE: "rebalance",
  ANALYTICS_SNAPSHOT: "analytics-snapshot",
  ANALYTICS_COMPACTION: "analytics-compaction",
  IDEMPOTENCY_CLEANUP: "idempotency-cleanup",
  PORTFOLIO_EXPORT: "portfolio-export",
  DLQ: "dead-letter-queue",
  PRICE_HISTORY_SNAPSHOT: "price-history-snapshot",
  PRICE_HISTORY_PRUNE: "price-history-prune",
  USER_ALERTS: "user-alerts",
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

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

export interface DLQJobData {
  originalQueue: string;
  originalJobId: string;
  attempts: number;
  error: string;
  stack: string;
  failedAt: string;
  payload: any;
}

export interface PriceHistoryJobData {
    triggeredBy?: 'scheduler' | 'startup'
}

export interface UserAlertsJobData {
    triggeredBy?: 'scheduler' | 'manual' | 'startup'
    correlationId?: string
}

// ─── Singleton Queues ─────────────────────────────────────────────────────────

let portfolioCheckQueue: Queue<PortfolioCheckJobData> | null = null;
let rebalanceQueue: Queue<RebalanceJobData> | null = null;
let analyticsSnapshotQueue: Queue<AnalyticsSnapshotJobData> | null = null;
let analyticsCompactionQueue: Queue<AnalyticsCompactionJobData> | null = null;
let idempotencyCleanupQueue: Queue<IdempotencyCleanupJobData> | null = null;
let portfolioExportQueue: Queue<PortfolioExportJobData, PortfolioExportResult> | null = null;
let priceHistorySnapshotQueue: Queue<PriceHistoryJobData> | null = null;
let priceHistoryPruneQueue: Queue<PriceHistoryJobData> | null = null;
let userAlertsQueue: Queue<UserAlertsJobData> | null = null;
let dlqQueue: Queue<DLQJobData> | null = null;

function getDefaultJobOptions() {
  return {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
    attempts: 3,
    backoff: {
      type: "exponential" as const,
      delay: 5000,
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

export function getDLQQueue(): Queue<DLQJobData> | null {
  try {
    if (!dlqQueue) {
      dlqQueue = new Queue(QUEUE_NAMES.DLQ, {
        connection: getConnectionOptions(),
        defaultJobOptions: {
          ...getDefaultJobOptions(),
          attempts: 1,
        },
      });
      logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.DLQ}`);
    }
    return dlqQueue;
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

export function getPriceHistorySnapshotQueue(): Queue<PriceHistoryJobData> | null {
    try {
        if (!priceHistorySnapshotQueue) {
            priceHistorySnapshotQueue = new Queue(QUEUE_NAMES.PRICE_HISTORY_SNAPSHOT, {
                connection: getConnectionOptions(),
                defaultJobOptions: getDefaultJobOptions(),
            })
        }
        return priceHistorySnapshotQueue
    } catch {
        return null
    }
}

export function getPriceHistoryPruneQueue(): Queue<PriceHistoryJobData> | null {
    try {
        if (!priceHistoryPruneQueue) {
            priceHistoryPruneQueue = new Queue(QUEUE_NAMES.PRICE_HISTORY_PRUNE, {
                connection: getConnectionOptions(),
                defaultJobOptions: getDefaultJobOptions(),
            })
        }
        return priceHistoryPruneQueue
    } catch {
        return null
    }
}

export function getUserAlertsQueue(): Queue<UserAlertsJobData> | null {
    try {
        if (!userAlertsQueue) {
            userAlertsQueue = new Queue(QUEUE_NAMES.USER_ALERTS, {
                connection: getConnectionOptions(),
                defaultJobOptions: getDefaultJobOptions(),
            })
            logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.USER_ALERTS}`)
        }
        return userAlertsQueue
    } catch {
        return null
    }
}

export function getQueueByName(name: string): Queue<any, any> | null {
  const queueMap: Record<string, () => any> = {
    [QUEUE_NAMES.PORTFOLIO_CHECK]: getPortfolioCheckQueue,
    [QUEUE_NAMES.REBALANCE]: getRebalanceQueue,
    [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: getAnalyticsSnapshotQueue,
    [QUEUE_NAMES.IDEMPOTENCY_CLEANUP]: getIdempotencyCleanupQueue,
    [QUEUE_NAMES.PORTFOLIO_EXPORT]: getPortfolioExportQueue,
    [QUEUE_NAMES.DLQ]: getDLQQueue,
    [QUEUE_NAMES.PRICE_HISTORY_SNAPSHOT]: getPriceHistorySnapshotQueue,
    [QUEUE_NAMES.PRICE_HISTORY_PRUNE]: getPriceHistoryPruneQueue,
    [QUEUE_NAMES.USER_ALERTS]: getUserAlertsQueue,
  };

  const getter = queueMap[name];
  return getter ? getter() : null;
}

// ─── Graceful Close ───────────────────────────────────────────────────────────

export async function closeAllQueues(): Promise<void> {
  await Promise.all([
    portfolioCheckQueue?.close(),
    rebalanceQueue?.close(),
    analyticsSnapshotQueue?.close(),
    analyticsCompactionQueue?.close(),
    idempotencyCleanupQueue?.close(),
    portfolioExportQueue?.close(),
    dlqQueue?.close(),
    priceHistorySnapshotQueue?.close(),
    priceHistoryPruneQueue?.close(),
    userAlertsQueue?.close(),
  ]);
  portfolioCheckQueue = null;
  rebalanceQueue = null;
  analyticsSnapshotQueue = null;
  analyticsCompactionQueue = null;
  idempotencyCleanupQueue = null;
  portfolioExportQueue = null;
  dlqQueue = null;
  priceHistorySnapshotQueue = null;
  priceHistoryPruneQueue = null;
  userAlertsQueue = null;
  logger.info("[QUEUE] All queues closed");
}