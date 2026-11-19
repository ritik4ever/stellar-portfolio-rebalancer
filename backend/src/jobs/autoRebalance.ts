import type { Job } from "bullmq";
import { Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { runWithRequestContext } from "../utils/requestContext.js";
import { logger, logAudit } from "../utils/logger.js";
import { portfolioStorage } from "../services/portfolioStorage.js";
import { ReflectorService } from "../services/reflector.js";
import { StellarService } from "../services/stellar.js";
import { buildRebalancePlan } from "../services/rebalancePlan.js";
import {
  rebalanceHistoryService,
  riskManagementService,
} from "../services/serviceContainer.js";
import { notificationService } from "../services/notificationService.js";
import { CircuitBreakers } from "../services/circuitBreakers.js";
import {
  computeDcaSchedule,
  crossCheckRebalanceDecision,
  shouldRebalanceByStrategy,
} from "../services/rebalancingStrategyService.js";
import { getFeatureFlags } from "../config/featureFlags.js";
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
  portfoliosSimulated: number;
  portfoliosSkipped: { reason: string; count: number }[];
  errors: string[];
}

let worker: Worker | null = null;
const runtimeStatus = createWorkerRuntimeStatus("auto-rebalance", 1);

/** Return whether scheduled auto-rebalance checks are enabled for a portfolio. */
function isAutoRebalanceEnabled(p: Portfolio): boolean {
  if (p.threshold <= 0) return false;
  if (p.strategyConfig && p.strategyConfig.enabled === false) return false;
  return true;
}

export type AutoRebalanceDryRunSource = "portfolio" | "environment" | "disabled";

export function resolveAutoRebalanceDryRun(
  portfolio: Portfolio,
  env: NodeJS.ProcessEnv = process.env,
): { enabled: boolean; source: AutoRebalanceDryRunSource } {
  const portfolioSetting = portfolio.strategyConfig?.dryRun;
  if (typeof portfolioSetting === "boolean") {
    return { enabled: portfolioSetting, source: "portfolio" };
  }

  const environmentSetting = env.AUTO_REBALANCE_DRY_RUN?.trim().toLowerCase();
  if (environmentSetting === "true") {
    return { enabled: true, source: "environment" };
  }

  return { enabled: false, source: "disabled" };
}

export interface AutoRebalanceBackoffConfig {
  baseBackoffMs?: number;
  backoffMultiplier?: number;
  maxBackoffMs?: number;
  minCooldownHours?: number;
}

export const DEFAULT_BACKOFF_CONFIG = {
  baseBackoffMs: 5 * 60 * 1000,
  backoffMultiplier: 2,
  maxBackoffMs: 60 * 60 * 1000,
  minCooldownHours: 1,
};

export function calculateBackoffDelay(failures: number, config?: AutoRebalanceBackoffConfig): number {
  if (failures <= 0) return 0;
  const cfg = { ...DEFAULT_BACKOFF_CONFIG, ...config };
  const delay = cfg.baseBackoffMs * Math.pow(cfg.backoffMultiplier, failures - 1);
  return Math.min(delay, cfg.maxBackoffMs);
}

export interface PortfolioBackoffState {
  portfolioId: string;
  consecutiveFailures: number;
  currentBackoffMs: number;
  lastFailureReason?: string;
  nextAllowedAttemptAt?: string;
  lastSuccessAt?: string;
}

const backoffStates = new Map<string, PortfolioBackoffState>();

export function resetAllBackoffStates(): void {
  backoffStates.clear();
}

export function getAllBackoffStates(): PortfolioBackoffState[] {
  return Array.from(backoffStates.values());
}

export function getPortfolioBackoffState(portfolioId: string): PortfolioBackoffState | undefined {
  return backoffStates.get(portfolioId);
}

export function recordAutoRebalanceFailure(
  portfolioId: string,
  reason: string | Error,
  config?: AutoRebalanceBackoffConfig
): PortfolioBackoffState {
  const reasonStr = reason instanceof Error ? reason.message : String(reason);
  const current = backoffStates.get(portfolioId);
  const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1;
  const currentBackoffMs = calculateBackoffDelay(consecutiveFailures, config);
  const nextAllowedAttemptAt = new Date(Date.now() + currentBackoffMs).toISOString();

  const state: PortfolioBackoffState = {
    portfolioId,
    consecutiveFailures,
    currentBackoffMs,
    lastFailureReason: reasonStr,
    nextAllowedAttemptAt,
    lastSuccessAt: current?.lastSuccessAt,
  };
  backoffStates.set(portfolioId, state);
  return state;
}

export function recordAutoRebalanceSuccess(portfolioId: string): void {
  const current = backoffStates.get(portfolioId);
  backoffStates.set(portfolioId, {
    portfolioId,
    consecutiveFailures: 0,
    currentBackoffMs: 0,
    nextAllowedAttemptAt: undefined,
    lastSuccessAt: new Date().toISOString(),
  });
}

export function isPortfolioInBackoff(portfolioId: string): { inBackoff: boolean; consecutiveFailures: number; remainingMs: number } {
  const state = backoffStates.get(portfolioId);
  if (!state || state.consecutiveFailures <= 0 || !state.nextAllowedAttemptAt) {
    return { inBackoff: false, consecutiveFailures: 0, remainingMs: 0 };
  }
  const nextAttemptTime = new Date(state.nextAllowedAttemptAt).getTime();
  const remainingMs = Math.max(0, nextAttemptTime - Date.now());
  return {
    inBackoff: remainingMs > 0,
    consecutiveFailures: state.consecutiveFailures,
    remainingMs,
  };
}

/**
 * Returns true when the portfolio is currently auto-paused by the CVaR/VaR
 * risk guardrail (`riskPausedUntil` is set in the future).
 */
export function isRiskPaused(p: Portfolio): boolean {
  if (!p.riskPausedUntil) return false;
  const untilMs = new Date(p.riskPausedUntil).getTime();
  if (Number.isNaN(untilMs)) return false;
  return untilMs > Date.now();
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

/** Evaluate eligible portfolios and either simulate or enqueue their rebalance plans. */
export async function processAutoRebalanceJob(
  job: Job<AutoRebalanceCheckJobData>,
  backoffConfig?: AutoRebalanceBackoffConfig,
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
      portfoliosSimulated: 0,
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

    const stellarService = new StellarService();
    const reflector = new ReflectorService();
    let prices: PricesMap;
    let feedMeta: any;
    if (typeof (reflector as any).getCurrentPricesWithMeta === "function") {
      const res = await (reflector as any).getCurrentPricesWithMeta();
      prices = res.prices;
      feedMeta = res.feedMeta;
    } else {
      prices = await reflector.getCurrentPrices();
      feedMeta = { isStale: false, staleOrLimited: false };
    }

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

    const skipCounts: Record<string, number> = {};
    const flags = getFeatureFlags();

    for (const portfolio of eligible) {
      summary.portfoliosChecked++;

      try {
        const backoffStatus = isPortfolioInBackoff(portfolio.id);
        if (backoffStatus.inBackoff) {
          skipCounts["backoff"] = (skipCounts["backoff"] ?? 0) + 1;
          logger.debug("[WORKER:auto-rebalance] Portfolio skipped — backoff active", {
            portfolioId: portfolio.id,
            consecutiveFailures: backoffStatus.consecutiveFailures,
            remainingMs: backoffStatus.remainingMs,
          });
          continue;
        }

        // CVaR/VaR auto-pause: a portfolio with a future riskPausedUntil is skipped.
        if (isRiskPaused(portfolio)) {
          skipCounts["risk_paused"] = (skipCounts["risk_paused"] ?? 0) + 1;
          logger.debug("[WORKER:auto-rebalance] Portfolio skipped — risk auto-paused", {
            portfolioId: portfolio.id,
            riskPausedUntil: portfolio.riskPausedUntil,
          });
          continue;
        }

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
          // A VaR/CVaR breach also triggers the configurable auto-pause guardrail
          // (notification + riskPausedUntil persistence) so the user knows why
          // rebalancing stopped.
          if (
            riskCheck.reasonCode === "STAT_MODEL_VAR_BREACH" ||
            riskCheck.reasonCode === "STAT_MODEL_CVAR_BREACH"
          ) {
            if (feedMeta?.staleOrLimited) {
              // Skip pause persistence/notification when the feed is degraded;
              // the block still applies for this cycle but without durable side effects.
              skipCounts["stale_price_data"] = (skipCounts["stale_price_data"] ?? 0) + 1;
            } else {
              await riskManagementService.checkCVaRVaRThresholdsAndAutoPause(
                portfolio.id,
                portfolio.allocations ?? {},
                prices,
                portfolio.userAddress,
              );
              skipCounts["risk_paused"] = (skipCounts["risk_paused"] ?? 0) + 1;
            }
          } else {
            skipCounts["circuit_breaker"] = (skipCounts["circuit_breaker"] ?? 0) + 1;
          }
          logger.debug("[WORKER:auto-rebalance] Portfolio skipped — risk check", {
            portfolioId: portfolio.id,
            reason: riskCheck.reason,
            reasonCode: riskCheck.reasonCode,
          });
          continue;
        }

        const now = Date.now();
        const drift = computeDrift(portfolio, prices);
        const strategy = portfolio.strategy ?? "threshold";
        const strategyConfig = portfolio.strategyConfig ?? {};
        const strategyTriggered = shouldRebalanceByStrategy({ portfolio, prices, now });

        let shouldTrigger: boolean;
        let triggerReason: string;

        if (strategy === "dca") {
          // DCA portfolios run on their own interval cadence regardless of drift.
          const schedule = computeDcaSchedule(portfolio, strategyConfig, now);
          shouldTrigger = strategyTriggered;
          triggerReason = shouldTrigger
            ? `dca_interval_${schedule.intervalDays}d`
            : "dca_not_due";
          if (shouldTrigger) {
            logger.info("[WORKER:auto-rebalance] DCA execution due", {
              portfolioId: portfolio.id,
              amount: schedule.amount,
              intervalDays: schedule.intervalDays,
              nextBuyAtMs: schedule.nextBuyAtMs,
            });
          }
        } else if (strategy === "threshold") {
          shouldTrigger = drift.drifted;
          triggerReason = drift.drifted ? "drift" : "no_drift_needed";
        } else {
          shouldTrigger = strategyTriggered;
          triggerReason = shouldTrigger ? `strategy:${strategy}` : "strategy_not_due";
        }

        if (!shouldTrigger) {
          skipCounts[triggerReason] = (skipCounts[triggerReason] ?? 0) + 1;
          logger.debug("[WORKER:auto-rebalance] Portfolio skipped — no trigger", {
            portfolioId: portfolio.id,
            triggerReason,
            maxDriftPct: drift.maxDriftPct.toFixed(2),
            threshold: portfolio.threshold,
          });
          continue;
        }

        // Cross-check the backend decision against the on-chain check_rebalance_needed
        // view before executing. Warn-only by default while rolling out; set
        // REBALANCE_CROSS_CHECK_REQUIRE_AGREEMENT to block execution on disagreement.
        if (flags.enableRebalanceCrossCheck) {
          const crossCheck = await crossCheckRebalanceDecision(
            { portfolio, prices, now },
            async () => stellarService.checkRebalanceNeeded(portfolio.id),
            {
              requireAgreement: flags.requireRebalanceCrossCheckAgreement,
              alertOnDisagreement: true,
            },
          );

          if (!crossCheck.finalDecision) {
            const skipReason = crossCheck.agreement
              ? "rebalance_not_needed"
              : "crosscheck_disagreement";
            skipCounts[skipReason] = (skipCounts[skipReason] ?? 0) + 1;
            logger.warn("[WORKER:auto-rebalance] Cross-check blocked rebalance", {
              portfolioId: portfolio.id,
              backendDecision: crossCheck.backendDecision,
              onChainDecision: crossCheck.onChainDecision,
              agreement: crossCheck.agreement,
              skipReason,
            });
            continue;
          }
        }

        const dryRun = resolveAutoRebalanceDryRun(portfolio);
        if (dryRun.enabled) {
          const plan = buildRebalancePlan(portfolio, prices, feedMeta);
          const estimatedTrades = plan.estimatedFees.tradeCount;

          logger.info("[WORKER:auto-rebalance] Dry-run plan computed — no transaction submitted", {
            portfolioId: portfolio.id,
            dryRunSource: dryRun.source,
            plan,
          });

          await rebalanceHistoryService.recordRebalanceEvent({
            portfolioId: portfolio.id,
            trigger: "Automatic Rebalancing (Dry Run Simulation)",
            trades: estimatedTrades,
            gasUsed: "0 XLM",
            status: "completed",
            isAutomatic: true,
            actor: "scheduler",
            source: "auto_rebalance",
            eventSource: "simulated",
            isSimulated: true,
            triggerMetadata: {
              dryRun: true,
              simulated: true,
              dryRunSource: dryRun.source,
              plan,
            },
            estimatedSlippageBps: plan.estimatedSlippageBps,
          });

          try {
            await notificationService.notify({
              userId: portfolio.userAddress,
              portfolioId: portfolio.id,
              eventType: "rebalance",
              title: "Rebalance Simulation (Dry Run)",
              message: `Simulation only — no on-chain transaction was submitted. The scheduled plan contains ${estimatedTrades} estimated trade${estimatedTrades === 1 ? "" : "s"}.`,
              data: {
                portfolioId: portfolio.id,
                dryRun: true,
                isSimulated: true,
                plan,
              },
              timestamp: new Date().toISOString(),
            });
          } catch (notifyErr) {
            logger.error("[WORKER:auto-rebalance] Dry-run notification failed (non-fatal)", {
              portfolioId: portfolio.id,
              error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
            });
          }

          recordAutoRebalanceSuccess(portfolio.id);
          summary.portfoliosSimulated++;
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

        recordAutoRebalanceSuccess(portfolio.id);
        summary.portfoliosTriggered++;
        logger.info("[WORKER:auto-rebalance] Rebalance enqueued", {
          portfolioId: portfolio.id,
          maxDriftPct: drift.maxDriftPct.toFixed(2),
          threshold: portfolio.threshold,
          reason: triggerReason,
        });
      } catch (err) {
        recordAutoRebalanceFailure(portfolio.id, err instanceof Error ? err : String(err), backoffConfig);
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
      simulated: summary.portfoliosSimulated,
      skipped: summary.portfoliosSkipped,
      errors: summary.errors.length,
    });

    if (summary.portfoliosTriggered > 0 || summary.portfoliosSimulated > 0) {
      logAudit("auto_rebalance_check_triggered", {
        checked: summary.portfoliosChecked,
        triggered: summary.portfoliosTriggered,
        simulated: summary.portfoliosSimulated,
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
