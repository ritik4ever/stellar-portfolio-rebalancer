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
const MIN_COOLDOWN_HOURS = 1;

interface AutoRebalanceSummary {
  portfoliosChecked: number;
  portfoliosTriggered: number;
  portfoliosSkipped: { reason: string; count: number }[];
  errors: string[];
}

let worker: Worker | null = null;
const runtimeStatus = createWorkerRuntimeStatus("auto-rebalance", 1);

function isAutoRebalanceEnabled(p: Portfolio): boolean {
  if (p.threshold <= 0) return false;
  if (p.strategyConfig && p.strategyConfig.enabled === false) return false;
  return true;
}

function computeDrift(
  portfolio: Portfolio,
  prices: PricesMap,
): { drifted: boolean; maxDriftPct: number; details: Record<string, { target: number; current: number; drift: number }> } {
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
): Promise<AutoRebalanceSummary> {
  const { triggeredBy, correlationId } = job.data;
  const requestId = correlationId ?? randomUUID();

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

    const stellarService = new StellarService();
    const rebalanceQueue = getRebalanceQueue();

    if (!rebalanceQueue) {
      logger.warn("[WORKER:auto-rebalance] Rebalance queue unavailable", { jobId: job.id });
      summary.errors.push("Rebalance queue unavailable");
      return summary;
    }

    const skipCounts: Record<string, number> = {};

    for (const portfolio of eligible) {
      summary.portfoliosChecked++;

      try {
        const cooldownCheck = CircuitBreakers.checkCooldownPeriod(
          portfolio.lastRebalance,
          MIN_COOLDOWN_HOURS,
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
