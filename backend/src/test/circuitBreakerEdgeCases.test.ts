/**
 * SPR-2026-135: deterministic circuit-breaker edge cases.
 *
 *  - A price move evaluated exactly at the configured volatility threshold is
 *    allowed; the triggering observation is reported only when the move
 *    exceeds it. The persisted admin threshold store is replaced by an
 *    isolated DB double so env configuration is the only input.
 *  - A price snapshot that is exactly at the freshness limit still executes;
 *    one millisecond older defers with a single delayed outcome and no
 *    duplicate side effects (no execution, no history write, no notification).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";

vi.mock("../services/portfolioStorage.js", () => ({
  portfolioStorage: { getAllPortfolios: vi.fn() },
}));

vi.mock("../services/reflector.js", () => ({
  ReflectorService: class {
    async getCurrentPrices() {
      return {};
    }
  },
}));

const { executeRebalance, recordRebalanceEvent, notify } = vi.hoisted(() => ({
  executeRebalance: vi.fn().mockResolvedValue({ trades: 1, gasUsed: "0 XLM" }),
  recordRebalanceEvent: vi.fn().mockResolvedValue({ id: "h1" }),
  notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/stellar.js", () => {
  function StellarService(this: any) {}
  StellarService.prototype.getPortfolio = vi.fn().mockResolvedValue({ id: "p1", userAddress: "GUSER" });
  StellarService.prototype.executeRebalance = (...args: unknown[]) => executeRebalance(...args);
  StellarService.prototype.checkRebalanceNeeded = vi.fn().mockResolvedValue(true);
  return { StellarService };
});

vi.mock("../services/serviceContainer.js", () => ({
  riskManagementService: { shouldAllowRebalance: vi.fn().mockReturnValue({ allowed: true }) },
  rebalanceHistoryService: { recordRebalanceEvent },
}));

vi.mock("../services/notificationService.js", () => ({
  notificationService: { notify },
}));

vi.mock("../services/websocket.service.js", () => ({
  broadcastPortfolioEvent: vi.fn(),
}));

vi.mock("../queue/workers/workerRuntime.js", () => ({
  acquireWorkerLock: vi.fn().mockResolvedValue(true),
  releaseWorkerLock: vi.fn().mockResolvedValue(true),
  createWorkerRuntimeStatus: vi.fn().mockReturnValue({}),
  handleFinalFailure: vi.fn(),
}));

vi.mock("../queue/queues.js", () => ({
  getRebalanceQueue: vi.fn(() => null),
}));

import { CircuitBreakers } from "../services/circuitBreakers.js";
import { databaseService } from "../services/databaseService.js";
import { processRebalanceJob } from "../queue/workers/rebalanceWorker.js";
import { MAX_PRICE_AGE_MS } from "../services/guardrailOutcomes.js";
import { releaseWorkerLock } from "../queue/workers/workerRuntime.js";
import { logger } from "../utils/logger.js";

const NOW = Date.parse("2026-01-01T10:00:00.000Z");

describe("circuit breaker – volatility threshold boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    vi.stubEnv("CIRCUIT_BREAKER_VOLATILITY_THRESHOLD_PCT", "15");
    // Isolated DB double: no persisted admin override can leak into the decision.
    vi.spyOn(databaseService, "getKvValue").mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("allows a move exactly at the threshold and reports the boundary observation only when exceeded", async () => {
    const atThreshold = await CircuitBreakers.checkMarketConditions({
      BTC: { change: 15, timestamp: NOW / 1000 },
    });
    expect(atThreshold).toMatchObject({
      safe: true,
      outcome: "allowed",
      reasonCode: "MARKET_OK",
      context: { asset: "BTC", observedChangePct: 15, thresholdPct: 15, comparison: ">" },
    });

    const negativeAtThreshold = await CircuitBreakers.checkMarketConditions({
      BTC: { change: -15, timestamp: NOW / 1000 },
    });
    expect(negativeAtThreshold).toMatchObject({ safe: true, outcome: "allowed" });

    const beyond = await CircuitBreakers.checkMarketConditions({
      BTC: { change: 15.01, timestamp: NOW / 1000 },
    });
    expect(beyond).toMatchObject({
      safe: false,
      outcome: "delayed",
      reasonCode: "HIGH_VOLATILITY",
      context: { asset: "BTC", observedChangePct: 15.01, thresholdPct: 15 },
    });
    expect(beyond.reason).toContain("BTC");
  });
});

describe("circuit breaker – queued execution freshness boundary", () => {
  const job = (pricesObservedAt: number) =>
    ({
      id: "rb-edge",
      data: { portfolioId: "p1", triggeredBy: "auto", pricesObservedAt },
      timestamp: pricesObservedAt,
      attemptsMade: 0,
      opts: { attempts: 1 },
    }) as unknown as Job;

  const delayedCalls = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.filter(
      ([message, payload]) =>
        message === "[GUARDRAIL] circuit_breaker delayed" &&
        (payload as any)?.reasonCode === "STALE_PRICES_WHILE_QUEUED",
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    executeRebalance.mockClear();
    recordRebalanceEvent.mockClear();
    notify.mockClear();
    vi.mocked(releaseWorkerLock).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes exactly once when the snapshot age equals the freshness limit", async () => {
    const info = vi.spyOn(logger, "info");
    const observedAt = NOW - MAX_PRICE_AGE_MS;

    await processRebalanceJob(job(observedAt));

    expect(executeRebalance).toHaveBeenCalledTimes(1);
    expect(recordRebalanceEvent).toHaveBeenCalledTimes(1);
    expect(delayedCalls(info)).toHaveLength(0);
    info.mockRestore();
  });

  it("defers with a single delayed outcome and no duplicate side effects one ms past the limit", async () => {
    const info = vi.spyOn(logger, "info");
    const observedAt = NOW - MAX_PRICE_AGE_MS - 1;

    await processRebalanceJob(job(observedAt));

    // The triggering observation: snapshot age exceeded the freshness window.
    const delayed = delayedCalls(info);
    expect(delayed).toHaveLength(1);
    expect(delayed[0][1]).toEqual(expect.objectContaining({
      source: "rebalance_worker",
      outcome: "delayed",
      reasonCode: "STALE_PRICES_WHILE_QUEUED",
      portfolioId: "p1",
      jobId: "rb-edge",
      priceAgeMs: MAX_PRICE_AGE_MS + 1,
      maxAgeMs: MAX_PRICE_AGE_MS,
    }));

    // Absence of duplicate side effects: nothing executed, persisted, or notified.
    expect(executeRebalance).not.toHaveBeenCalled();
    expect(recordRebalanceEvent).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(releaseWorkerLock).toHaveBeenCalledTimes(1);
    expect(releaseWorkerLock).toHaveBeenCalledWith("p1");
    info.mockRestore();
  });
});
