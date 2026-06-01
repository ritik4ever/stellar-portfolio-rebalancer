import type { Job } from "bullmq";
import { Worker } from "bullmq";
import { portfolioStorage } from "../../services/portfolioStorage.js";
import { StellarService } from "../../services/stellar.js";
import { ReflectorService } from "../../services/reflector.js";
import { CircuitBreakers } from "../../services/circuitBreakers.js";
import { rebalanceHistoryService } from "../../services/serviceContainer.js";
import { getFeatureFlags } from "../../config/featureFlags.js";
import { getRebalanceQueue } from "../queues.js";
import type { PortfolioCheckJobData } from "../queues.js";
import { getConnectionOptions } from "../connection.js";
import { logger } from "../../utils/logger.js";
import {
  createWorkerRuntimeStatus,
  markWorkerFailed,
  markWorkerJobCompleted,
  markWorkerJobFailed,
  markWorkerReady,
  markWorkerStarting,
  markWorkerStopped,
  snapshotWorkerRuntimeStatus,
  type WorkerRuntimeStatus,
} from "./workerRuntime.js";

const DEMO_PORTFOLIO_IDS = new Set(["demo", "demo-portfolio-1"]);

let worker: Worker | null = null;
const runtimeStatus = createWorkerRuntimeStatus("portfolio-check", 1);

export async function processPortfolioCheckJob(
  job: Job<PortfolioCheckJobData>,
): Promise<void> {
  const { triggeredBy, correlationId } = job.data;

  logger.info("[WORKER:portfolio-check] Running portfolio check cycle", {
    jobId: job.id,
    triggeredBy,
    correlationId,
    recovery: job.data.recovery,
  });

  const allPortfolios = await portfolioStorage.getAllPortfolios();
  const portfolios = allPortfolios.filter((p) => !DEMO_PORTFOLIO_IDS.has(p.id));

  if (portfolios.length === 0) {
    return;
  }

  const reflector = new ReflectorService();
  const prices = await reflector.getCurrentPrices();
  const market = await CircuitBreakers.checkMarketConditions(prices);
  if (!market.safe) {
    logger.warn(
      "[WORKER:portfolio-check] Skipping rebalance enqueue — market conditions unsafe",
      {
        jobId: job.id,
        reason: market.reason,
        correlationId,
      },
    );
    return;
  }

  const shadowMode = getFeatureFlags().autoRebalancerShadowMode;
  const queue = shadowMode ? null : getRebalanceQueue();
  if (!shadowMode && !queue) {
    logger.warn("[WORKER:portfolio-check] Rebalance queue unavailable", {
      jobId: job.id,
      correlationId,
    });
    return;
  }

  const stellarService = new StellarService();
  for (const p of portfolios) {
    const needed = await stellarService.checkRebalanceNeeded(p.id);
    if (!needed) continue;

    if (shadowMode) {
      await rebalanceHistoryService.recordRebalanceEvent({
        portfolioId: p.id,
        trigger: "Automatic Rebalancing (Shadow Mode)",
        trades: 0,
        gasUsed: "0 XLM",
        status: "pending",
        isAutomatic: true,
        prices,
        portfolio: p,
        actor: "system",
        source: "auto_rebalance",
        eventSource: "simulated",
        isSimulated: true,
        triggerMetadata: {
          shadowMode: true,
          skippedExecution: true,
          decision: "rebalance_needed",
          triggeredBy: triggeredBy ?? "scheduler",
          correlationId,
          jobId: job.id,
        },
      });

      logger.info("[WORKER:portfolio-check] Shadow mode recorded rebalance decision; execution skipped", {
        jobId: job.id,
        portfolioId: p.id,
        triggeredBy,
        correlationId,
      });
      continue;
    }

    await queue!.add(
      `rebalance-${p.id}`,
      { portfolioId: p.id, triggeredBy: "auto" as const, correlationId: correlationId },
      { removeOnComplete: true },
    );
  }
}

export function startPortfolioCheckWorker(): Worker | null {
  if (worker) return worker;

  try {
    markWorkerStarting(runtimeStatus);
    worker = new Worker("portfolio-check", processPortfolioCheckJob, {
      connection: getConnectionOptions(),
      concurrency: 1,
    });
  } catch (err) {
    markWorkerFailed(runtimeStatus, err);
    logger.warn("[WORKER:portfolio-check] Failed to start - Redis may be unavailable", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  void worker.waitUntilReady().then(() => {
    markWorkerReady(runtimeStatus);
    logger.info("[WORKER:portfolio-check] Worker ready");
  }).catch((err) => {
    markWorkerFailed(runtimeStatus, err);
    logger.error("[WORKER:portfolio-check] Worker failed readiness check", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  worker.on("completed", (j) => {
    markWorkerJobCompleted(runtimeStatus);
    logger.info("[WORKER:portfolio-check] Job completed", { jobId: j.id });
  });

  worker.on("failed", (j, err) => {
    markWorkerJobFailed(runtimeStatus, err);
    logger.error("[WORKER:portfolio-check] Job failed", {
      jobId: j?.id,
      error: err.message,
      attemptsMade: j?.attemptsMade,
    });
  });

  logger.info("[WORKER:portfolio-check] Worker started");
  return worker;
}

export async function stopPortfolioCheckWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    markWorkerStopped(runtimeStatus);
    logger.info("[WORKER:portfolio-check] Worker stopped");
  }
}

export function isPortfolioCheckWorkerRunning(): boolean {
  return worker !== null;
}

export function getPortfolioCheckWorkerStatus(): WorkerRuntimeStatus {
  return snapshotWorkerRuntimeStatus(runtimeStatus);
}

export function setPortfolioCheckSchedulerRegistered(registered: boolean): void {
  runtimeStatus.schedulerRegistered = registered;
}
