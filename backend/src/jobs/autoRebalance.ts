import type { Job } from "bullmq";
import { Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { runWithRequestContext } from "../utils/requestContext.js";
import { logger, logAudit } from "../utils/logger.js";
import { portfolioStorage } from "../services/portfolioStorage.js";
import { StellarService } from "../services/stellar.js";
import { ReflectorService } from "../services/reflector.js";
import { riskManagementService } from "../services/serviceContainer.js";
import { CircuitBreakers } from "../services/circuitBreakers.js";
import { getRebalanceQueue } from "../queue/queues.js";
import type { AutoRebalanceCheckJobData } from "../queue/queues.js";
import { getConnectionOptions } from "../queue/connection.js";
import {
  createWorkerRuntimeStatus,
  markWorkerFailed,
  markWorkerJobCompleted,
  markWorkerJobFailed,
  markWorkerReady,
  markWorkerStarting,
  markWorkerStopped,
  snapshotWorkerRuntimeStatus,
  handleFinalFailure,
  type WorkerRuntimeStatus,
} from "../queue/workers/workerRuntime.js";
import type { Portfolio, PricesMap } from "../types/index.js";

const DEMO_PORTFOLIO_IDS = new Set(["demo", "demo-portfolio-1"]);

export interface AutoRebalanceBackoffConfig {
  /** Base backoff interval in ms after first failure (default: 5 minutes = 300,000 ms) */
  baseBackoffMs: number;
  /** Multiplier applied exponentially for each consecutive failure (default: 2) */
  backoffMultiplier: number;
  /** Maximum backoff delay cap in ms (default: 24 hours = 86,400,000 ms) */
  maxBackoffMs: number;
  /** Minimum cooldown hours between successful rebalances (default: 1 hour) */
  minCooldownHours: number;
}

export const DEFAULT_BACKOFF_CONFIG: AutoRebalanceBackoffConfig = {
  baseBackoffMs: 5 * 60 * 1000, // 5 minutes
  backoffMultiplier: 2,
  maxBackoffMs: 24 * 60 * 60 * 1000, // 24 hours
  minCooldownHours: 1,
};

export interface PortfolioBackoffState {
  portfolioId: string;
  userId?: string;
  consecutiveFailures: number;
  lastFailureAt?: string;
  lastFailureReason?: string;
  nextAllowedAttemptAt?: string;
  lastSuccessAt?: string;
  currentBackoffMs: number;
}

export interface AutoRebalanceSummary {
  portfoliosChecked: number;
  portfoliosTriggered: number;
  portfoliosSkipped: { reason: string; count: number }[];
  errors: string[];
}

const backoffStates = new Map<string, PortfolioBackoffState>();

let worker: Worker | null = null;
const runtimeStatus = createWorkerRuntimeStatus("auto-rebalance", 1);

/**
 * Calculate exponential backoff delay based on consecutive failure count
 */
export function calculateBackoffDelay(
  consecutiveFailures: number,
  config: Partial<AutoRebalanceBackoffConfig> = {},
): number {
  if (consecutiveFailures <= 0) return 0;

  const mergedConfig = { ...DEFAULT_BACKOFF_CONFIG, ...config };
  const delay =
    mergedConfig.baseBackoffMs *
    Math.pow(mergedConfig.backoffMultiplier, consecutiveFailures - 1);

  return Math.min(delay, mergedConfig.maxBackoffMs);
}

/**
 * Record a failure for a portfolio / user and calculate the next allowed attempt time
 */
export function recordAutoRebalanceFailure(
  portfolioId: string,
  errorOrReason?: unknown,
  config: Partial<AutoRebalanceBackoffConfig> = {},
): PortfolioBackoffState {
  const now = Date.now();
  const existing = backoffStates.get(portfolioId);
  const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
  const backoffMs = calculateBackoffDelay(consecutiveFailures, config);
  const nextAllowedAttemptAt = new Date(now + backoffMs).toISOString();
  const failureReason =
    errorOrReason instanceof Error
      ? errorOrReason.message
      : typeof errorOrReason === "string"
        ? errorOrReason
        : errorOrReason
          ? String(errorOrReason)
          : "Unknown auto-rebalance failure";

  const state: PortfolioBackoffState = {
    portfolioId,
    userId: existing?.userId,
    consecutiveFailures,
    lastFailureAt: new Date(now).toISOString(),
    lastFailureReason: failureReason,
    nextAllowedAttemptAt,
    lastSuccessAt: existing?.lastSuccessAt,
    currentBackoffMs: backoffMs,
  };

  backoffStates.set(portfolioId, state);

  logger.warn("[WORKER:auto-rebalance] Applied exponential backoff to portfolio after failure", {
    portfolioId,
    consecutiveFailures,
    backoffMs,
    nextAllowedAttemptAt,
    reason: failureReason,
  });

  return state;
}

/**
 * Reset backoff state on successful rebalance
 */
export function recordAutoRebalanceSuccess(portfolioId: string): void {
  const existing = backoffStates.get(portfolioId);
  if (existing) {
    existing.consecutiveFailures = 0;
    existing.currentBackoffMs = 0;
    existing.nextAllowedAttemptAt = undefined;
    existing.lastFailureReason = undefined;
    existing.lastSuccessAt = new Date().toISOString();
  } else {
    backoffStates.set(portfolioId, {
      portfolioId,
      consecutiveFailures: 0,
      currentBackoffMs: 0,
      lastSuccessAt: new Date().toISOString(),
    });
  }

  logger.info("[WORKER:auto-rebalance] Reset backoff state for portfolio on success", {
    portfolioId,
  });
}

/**
 * Check whether a portfolio is currently blocked by backoff
 */
export function isPortfolioInBackoff(
  portfolioId: string,
  now: number = Date.now(),
): {
  inBackoff: boolean;
  remainingMs: number;
  nextAllowedAt?: string;
  consecutiveFailures: number;
} {
  const state = backoffStates.get(portfolioId);
  if (!state || state.consecutiveFailures <= 0 || !state.nextAllowedAttemptAt) {
    return { inBackoff: false, remainingMs: 0, consecutiveFailures: 0 };
  }

  const nextAttemptMs = new Date(state.nextAllowedAttemptAt).getTime();
  const remainingMs = nextAttemptMs - now;

  if (remainingMs > 0) {
    return {
      inBackoff: true,
      remainingMs,
      nextAllowedAt: state.nextAllowedAttemptAt,
      consecutiveFailures: state.consecutiveFailures,
    };
  }

  return {
    inBackoff: false,
    remainingMs: 0,
    nextAllowedAt: state.nextAllowedAttemptAt,
    consecutiveFailures: state.consecutiveFailures,
  };
}

/**
 * Retrieve backoff state for a specific portfolio
 */
export function getPortfolioBackoffState(portfolioId: string): PortfolioBackoffState | null {
  const state = backoffStates.get(portfolioId);
  return state ? { ...state } : null;
}

/**
 * Retrieve all backoff states
 */
export function getAllBackoffStates(): PortfolioBackoffState[] {
  return Array.from(backoffStates.values()).map((s) => ({ ...s }));
}

/**
 * Clear all backoff states (useful in tests / cleanup)
 */
export function resetAllBackoffStates(): void {
  backoffStates.clear();
}

export function isAutoRebalanceEnabled(p: Portfolio): boolean {
  if (p.threshold <= 0) return false;
  if (p.strategyConfig && p.strategyConfig.enabled === false) return false;
  return true;
}

export function computeDrift(
  portfolio: Portfolio,
  prices: PricesMap,
): {
  drifted: boolean;
  maxDriftPct: number;
  details: Record<string, { target: number; current: number; drift: number }>;
} {
  const totalUsdValue = Object.entries(portfolio.balances).reduce((sum, [asset, balance]) => {
    const price = prices[asset]?.price ?? 1;
    return sum + balance * price;
  }, 0);
  if (totalUsdValue <= 0) return { drifted: false, maxDriftPct: 0, details: {} };

  const details: Record<string, { target: number; current: number; drift: number }> = {};
  let maxDriftPct = 0;
  let drifted = false;

  for (const [asset, targetPct] of Object.entries(portfolio.allocations)) {
    const currentBalance = portfolio.balances[asset] ?? 0;
    const price = prices[asset]?.price ?? 1;
    const currentUsdValue = currentBalance * price;
    const currentPct = (currentUsdValue / totalUsdValue) * 100;
    const drift = Math.abs(currentPct - targetPct);

    details[asset] = { target: targetPct, current: currentPct, drift };
    if (drift > maxDriftPct) maxDriftPct = drift;
    if (drift > portfolio.threshold) drifted = true;
  }

  return { drifted, maxDriftPct, details };
}

export async function processAutoRebalanceJob(
  job: Job<AutoRebalanceCheckJobData>,
  config: Partial<AutoRebalanceBackoffConfig> = {},
): Promise<AutoRebalanceSummary> {
  const { triggeredBy, correlationId } = job.data;
  const requestId = correlationId ?? randomUUID();
  const mergedConfig = { ...DEFAULT_BACKOFF_CONFIG, ...config };

  return runWithRequestContext({ requestId }, async () => {
    logger.info("[WORKER:auto-rebalance] Starting auto-rebalance check cycle", {
      jobId: job.id,
      triggeredBy,
      correlationId,
    });

    const summary: AutoRebalanceSummary = {
      portfoliosChecked: 0,
      portfoliosTriggered: 0,
      portfoliosSkipped: [],
      errors: [],
    };

    const allPortfolios = await portfolioStorage.getAllPortfolios();
    const eligible = allPortfolios.filter(
      (p) => !DEMO_PORTFOLIO_IDS.has(p.id) && isAutoRebalanceEnabled(p),
    );

    if (eligible.length === 0) {
      logger.info("[WORKER:auto-rebalance] No eligible portfolios found", { jobId: job.id });
      return summary;
    }

    const reflector = new ReflectorService();
    const prices = await reflector.getCurrentPrices();

    const marketCheck = CircuitBreakers.checkMarketConditions(prices);
    if (!marketCheck.safe) {
      logger.warn("[WORKER:auto-rebalance] Market conditions unsafe — skipping all portfolios", {
        jobId: job.id,
        reason: marketCheck.reason,
        correlationId,
      });
      summary.portfoliosSkipped.push({ reason: "market_conditions", count: eligible.length });
      return summary;
    }

    const rebalanceQueue = getRebalanceQueue();

    if (!rebalanceQueue) {
      logger.warn("[WORKER:auto-rebalance] Rebalance queue unavailable", { jobId: job.id });
      summary.errors.push("Rebalance queue unavailable");
      return summary;
    }

    const skipCounts: Record<string, number> = {};

    for (const portfolio of eligible) {
      summary.portfoliosChecked++;

      // Check per-user / per-portfolio exponential backoff after repeated failures
      const backoffStatus = isPortfolioInBackoff(portfolio.id);
      if (backoffStatus.inBackoff) {
        skipCounts["backoff"] = (skipCounts["backoff"] ?? 0) + 1;
        logger.debug("[WORKER:auto-rebalance] Portfolio skipped — exponential backoff active", {
          portfolioId: portfolio.id,
          consecutiveFailures: backoffStatus.consecutiveFailures,
          nextAllowedAt: backoffStatus.nextAllowedAt,
          remainingSeconds: Math.ceil(backoffStatus.remainingMs / 1000),
        });
        continue;
      }

      try {
        const cooldownCheck = CircuitBreakers.checkCooldownPeriod(
          portfolio.lastRebalance,
          mergedConfig.minCooldownHours,
        );
        if (!cooldownCheck.safe) {
          skipCounts["cooldown"] = (skipCounts["cooldown"] ?? 0) + 1;
          logger.debug("[WORKER:auto-rebalance] Portfolio skipped — cooldown", {
            portfolioId: portfolio.id,
            reason: cooldownCheck.reason,
          });
          continue;
        }

        const riskCheck = riskManagementService.shouldAllowRebalance(portfolio, prices);
        if (!riskCheck.allowed) {
          skipCounts["circuit_breaker"] = (skipCounts["circuit_breaker"] ?? 0) + 1;
          logger.debug("[WORKER:auto-rebalance] Portfolio skipped — circuit breaker", {
            portfolioId: portfolio.id,
            reason: riskCheck.reason,
          });
          continue;
        }

        const drift = computeDrift(portfolio, prices);
        if (!drift.drifted) {
          skipCounts["no_drift_needed"] = (skipCounts["no_drift_needed"] ?? 0) + 1;
          logger.debug("[WORKER:auto-rebalance] Portfolio skipped — no drift", {
            portfolioId: portfolio.id,
            maxDriftPct: drift.maxDriftPct.toFixed(2),
            threshold: portfolio.threshold,
          });
          continue;
        }

        await rebalanceQueue.add(
          `rebalance-${portfolio.id}`,
          {
            portfolioId: portfolio.id,
            triggeredBy: "auto",
            correlationId: correlationId,
          },
          { removeOnComplete: true },
        );

        summary.portfoliosTriggered++;
        logger.info("[WORKER:auto-rebalance] Rebalance enqueued", {
          portfolioId: portfolio.id,
          maxDriftPct: drift.maxDriftPct.toFixed(2),
          threshold: portfolio.threshold,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`Portfolio ${portfolio.id}: ${msg}`);
        recordAutoRebalanceFailure(portfolio.id, err, mergedConfig);
        logger.error("[WORKER:auto-rebalance] Error checking portfolio", {
          portfolioId: portfolio.id,
          error: msg,
        });
      }
    }

    for (const [reason, count] of Object.entries(skipCounts)) {
      if (count > 0) summary.portfoliosSkipped.push({ reason, count });
    }

    logger.info("[WORKER:auto-rebalance] Cycle complete", {
      jobId: job.id,
      checked: summary.portfoliosChecked,
      triggered: summary.portfoliosTriggered,
      skipped: summary.portfoliosSkipped,
      errors: summary.errors.length,
    });

    if (summary.portfoliosTriggered > 0) {
      logAudit("auto_rebalance_check_triggered", {
        checked: summary.portfoliosChecked,
        triggered: summary.portfoliosTriggered,
        skipped: summary.portfoliosSkipped,
      });
    }

    return summary;
  });
}

export function startAutoRebalanceWorker(): Worker | null {
  if (worker) return worker;

  try {
    markWorkerStarting(runtimeStatus);
    worker = new Worker("auto-rebalance-check", processAutoRebalanceJob, {
      connection: getConnectionOptions(),
      concurrency: 1,
    });
  } catch (err) {
    markWorkerFailed(runtimeStatus, err);
    logger.warn(
      "[WORKER:auto-rebalance] Failed to start — Redis may be unavailable",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }

  void worker
    .waitUntilReady()
    .then(() => {
      markWorkerReady(runtimeStatus);
      logger.info("[WORKER:auto-rebalance] Worker ready");
    })
    .catch((err) => {
      markWorkerFailed(runtimeStatus, err);
      logger.error("[WORKER:auto-rebalance] Worker failed readiness check", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

  worker.on("completed", (j) => {
    markWorkerJobCompleted(runtimeStatus);
    logger.info("[WORKER:auto-rebalance] Job completed", { jobId: j.id });
  });

  worker.on("failed", (j: Job | undefined, err: Error) => {
    if (j) {
      markWorkerJobFailed(runtimeStatus, err);
    }
    logger.error("[WORKER:auto-rebalance] Job failed", {
      jobId: j?.id,
      error: err.message,
      attemptsMade: j?.attemptsMade,
    });
    if (j) {
      void handleFinalFailure(j, err);
    }
  });

  logger.info("[WORKER:auto-rebalance] Worker started");
  return worker;
}

export async function stopAutoRebalanceWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    markWorkerStopped(runtimeStatus);
    logger.info("[WORKER:auto-rebalance] Worker stopped");
  }
}

export function isAutoRebalanceWorkerRunning(): boolean {
  return worker !== null;
}

export function getAutoRebalanceWorkerStatus(): WorkerRuntimeStatus {
  return snapshotWorkerRuntimeStatus(runtimeStatus);
}

export function setAutoRebalanceSchedulerRegistered(registered: boolean): void {
  runtimeStatus.schedulerRegistered = registered;
}
