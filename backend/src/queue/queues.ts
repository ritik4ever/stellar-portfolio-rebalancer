import { Queue } from "bullmq";
import { getConnectionOptions } from "./connection.js";
import { logger } from "../utils/logger.js";

export const QUEUE_NAMES = {
    PORTFOLIO_CHECK: 'portfolio-check',
    REBALANCE: 'rebalance',
    ANALYTICS_SNAPSHOT: 'analytics-snapshot',
    IDEMPOTENCY_CLEANUP: 'idempotency-cleanup',
    PORTFOLIO_EXPORT: 'portfolio-export',
} as const

export type ScheduledJobTrigger = 'scheduler' | 'manual' | 'startup' | 'recovery'

export interface MissedScheduledJobRecovery {
    action: 'replay' | 'skip' | 'compact'
    missedRuns: number
    lastSchedulerSeenAt: string
    recoveredAt: string
    reason: string
}

export interface PortfolioCheckJobData {
    triggeredBy?: ScheduledJobTrigger
    correlationId?: string
    recovery?: MissedScheduledJobRecovery
}

export interface RebalanceJobData {
  portfolioId: string;
  triggeredBy?: "auto" | "manual" | "force";
  correlationId?: string;
}

export interface AnalyticsSnapshotJobData {
    triggeredBy?: ScheduledJobTrigger
    correlationId?: string
    recovery?: MissedScheduledJobRecovery
}

export interface IdempotencyCleanupJobData {
    triggeredBy?: ScheduledJobTrigger
    correlationId?: string
    recovery?: MissedScheduledJobRecovery
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

let portfolioCheckQueue: Queue<PortfolioCheckJobData> | null = null
let rebalanceQueue: Queue<RebalanceJobData> | null = null
let analyticsSnapshotQueue: Queue<AnalyticsSnapshotJobData> | null = null
let idempotencyCleanupQueue: Queue<IdempotencyCleanupJobData> | null = null
let portfolioExportQueue: Queue<PortfolioExportJobData, PortfolioExportResult> | null = null

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
        idempotencyCleanupQueue?.close(),
        portfolioExportQueue?.close(),
    ])
    portfolioCheckQueue = null
    rebalanceQueue = null
    analyticsSnapshotQueue = null
    idempotencyCleanupQueue = null
    portfolioExportQueue = null
    logger.info('[QUEUE] All queues closed')
}
