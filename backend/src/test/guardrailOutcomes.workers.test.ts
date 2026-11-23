/**
 * Worker-level coverage for guardrail outcomes:
 *  - SPR-2026-136 / SPR-2026-139: concurrent auto-rebalance cycles crossing the
 *    cooldown expiry instant enqueue exactly one execution.
 *  - SPR-2026-134: the rebalance worker defers when the price snapshot went
 *    stale while the job waited in the queue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { Portfolio } from "../types/index.js";

vi.mock("../services/portfolioStorage.js", () => ({
  portfolioStorage: { getAllPortfolios: vi.fn() },
}));

vi.mock("../services/reflector.js", () => ({
  ReflectorService: class {
    async getCurrentPrices() {
      return {
        XLM: { price: 1, change: 0, timestamp: Date.now() / 1000 },
        USDC: { price: 1, change: 0, timestamp: Date.now() / 1000 },
      };
    }
  },
}));

const executeRebalance = vi.fn().mockResolvedValue({ trades: 1, gasUsed: "0 XLM" });
vi.mock("../services/stellar.js", () => {
  function StellarService(this: any) {}
  StellarService.prototype.getPortfolio = vi.fn().mockResolvedValue({ id: "p1", userAddress: "GUSER" });
  StellarService.prototype.executeRebalance = (...args: unknown[]) => executeRebalance(...args);
  StellarService.prototype.checkRebalanceNeeded = vi.fn().mockResolvedValue(true);
  return { StellarService };
});

vi.mock("../services/serviceContainer.js", () => ({
  riskManagementService: { shouldAllowRebalance: vi.fn().mockReturnValue({ allowed: true }) },
  rebalanceHistoryService: { recordRebalanceEvent: vi.fn().mockResolvedValue({ id: "h1" }) },
}));

vi.mock("../services/notificationService.js", () => ({
  notificationService: { notify: vi.fn().mockResolvedValue(undefined) },
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

const mockAdd = vi.fn();
vi.mock("../queue/queues.js", () => ({
  getRebalanceQueue: vi.fn(() => ({ add: mockAdd })),
}));

import { processAutoRebalanceJob, resetAllBackoffStates } from "../jobs/autoRebalance.js";
import { processRebalanceJob } from "../queue/workers/rebalanceWorker.js";
import { portfolioStorage } from "../services/portfolioStorage.js";
import { rebalanceHistoryService } from "../services/serviceContainer.js";
import { broadcastPortfolioEvent } from "../services/websocket.service.js";
import { cooldownGate, MAX_PRICE_AGE_MS } from "../services/guardrailOutcomes.js";
import { releaseWorkerLock } from "../queue/workers/workerRuntime.js";
import { logger } from "../utils/logger.js";

const NOW = Date.parse("2026-01-01T10:00:00.000Z");

const portfolio = (lastRebalance: string): Portfolio =>
  ({
    id: "p1",
    userAddress: "GUSER",
    balances: { XLM: 100, USDC: 0 },
    allocations: { XLM: 50, USDC: 50 },
    threshold: 5,
    lastRebalance,
    createdAt: new Date(0).toISOString(),
  }) as Portfolio;

const autoJob = (id: string, triggeredBy: string) => ({ id, data: { triggeredBy } }) as any;

describe("auto-rebalance at the cooldown expiry instant", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    resetAllBackoffStates();
    cooldownGate.reset();
    mockAdd.mockReset();
  });

  afterEach(() => {
    cooldownGate.reset();
    vi.useRealTimers();
  });

  it("enqueues one execution for concurrent cycles and records its last-run time", async () => {
    // Persisted last run is exactly one cooldown (1h) ago: NOW is the expiry instant.
    vi.mocked(portfolioStorage.getAllPortfolios).mockResolvedValue([portfolio("2026-01-01T09:00:00.000Z")]);
    const info = vi.spyOn(logger, "info");

    const [a, b] = await Promise.all([
      processAutoRebalanceJob(autoJob("job-a", "scheduler")),
      processAutoRebalanceJob(autoJob("job-b", "manual")),
    ]);

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith(
      "rebalance-p1",
      expect.objectContaining({
        portfolioId: "p1",
        cooldownClaimedAt: "2026-01-01T10:00:00.000Z",
        pricesObservedAt: NOW,
      }),
      expect.anything(),
    );
    expect(a.portfoliosTriggered + b.portfoliosTriggered).toBe(1);
    const skipped = [...a.portfoliosSkipped, ...b.portfoliosSkipped];
    expect(skipped).toContainEqual({ reason: "cooldown", count: 1 });

    expect(info).toHaveBeenCalledWith(
      "[GUARDRAIL] cooldown delayed",
      expect.objectContaining({
        source: "auto_rebalance",
        reasonCode: "COOLDOWN_ALREADY_CLAIMED",
        portfolioId: "p1",
        lastRunAt: "2026-01-01T10:00:00.000Z",
        persistedLastRunAt: "2026-01-01T09:00:00.000Z",
      }),
    );
    info.mockRestore();
  });

  it("returns the cooldown window when enqueueing fails", async () => {
    vi.mocked(portfolioStorage.getAllPortfolios).mockResolvedValue([portfolio("2026-01-01T09:00:00.000Z")]);
    mockAdd.mockRejectedValueOnce(new Error("redis down"));

    const failed = await processAutoRebalanceJob(autoJob("job-a", "scheduler"));
    expect(failed.errors).toHaveLength(1);
    expect(cooldownGate.getClaim("p1")).toBeUndefined();

    resetAllBackoffStates();
    const retried = await processAutoRebalanceJob(autoJob("job-b", "scheduler"));
    expect(retried.portfoliosTriggered).toBe(1);
  });
});

describe("rebalance worker – prices stale while queued", () => {
  const job = (data: Record<string, unknown>, timestamp: number) =>
    ({ id: "rb-1", data: { portfolioId: "p1", triggeredBy: "auto", ...data }, timestamp, attemptsMade: 0, opts: { attempts: 3 } }) as unknown as Job;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    executeRebalance.mockClear();
    vi.mocked(releaseWorkerLock).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defers execution and reports a delayed outcome when the snapshot aged out", async () => {
    const info = vi.spyOn(logger, "info");
    const observedAt = NOW - MAX_PRICE_AGE_MS - 60_000;

    await processRebalanceJob(job({ pricesObservedAt: observedAt }, observedAt + 1_000) as any);

    expect(executeRebalance).not.toHaveBeenCalled();
    expect(releaseWorkerLock).toHaveBeenCalledWith("p1");
    expect(info).toHaveBeenCalledWith(
      "[GUARDRAIL] circuit_breaker delayed",
      expect.objectContaining({
        source: "rebalance_worker",
        reasonCode: "STALE_PRICES_WHILE_QUEUED",
        action: "stop_current_job",
        retryPolicy: "next_scheduled_cycle",
        portfolioId: "p1",
        jobId: "rb-1",
        priceAgeMs: MAX_PRICE_AGE_MS + 60_000,
        queuedForMs: MAX_PRICE_AGE_MS + 59_000,
      }),
    );
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "rebalance_deferred_stale_prices", reasonCode: "STALE_PRICES_WHILE_QUEUED" }),
      "audit",
    );
    info.mockRestore();
  });

  it("executes normally when the snapshot is still fresh", async () => {
    await processRebalanceJob(job({ pricesObservedAt: NOW - 1_000 }, NOW - 500) as any);
    expect(executeRebalance).toHaveBeenCalledTimes(1);
  });

  it("keeps legacy jobs without a snapshot timestamp unchanged", async () => {
    await processRebalanceJob(job({}, NOW - 60 * 60 * 1000) as any);
    expect(executeRebalance).toHaveBeenCalledTimes(1);
  });
});

describe("rebalance worker – execution outcome consistency", () => {
  beforeEach(() => {
    executeRebalance.mockReset();
    vi.mocked(rebalanceHistoryService.recordRebalanceEvent).mockClear();
    vi.mocked(broadcastPortfolioEvent).mockClear();
  });

  it("persists and broadcasts a partial executor result with its residual state", async () => {
    const residualWork = { hasResidualWork: true, remainingTrades: [{ tradeId: "leg-2" }] };
    const postTradeBalances = { XLM: 60, USDC: 40 };
    executeRebalance.mockResolvedValue({
      status: "partial",
      trades: 1,
      postTradeBalances,
      postTradeWeights: { XLM: 60, USDC: 40 },
      residualWork,
    });

    await processRebalanceJob({
      id: "partial-job",
      data: { portfolioId: "p1", triggeredBy: "auto" },
      attemptsMade: 0,
      opts: { attempts: 1 },
    } as unknown as Job);

    expect(rebalanceHistoryService.recordRebalanceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "partial",
        persistenceContext: expect.objectContaining({
          executionStatus: "partial",
          postTradeBalances,
          residualWork,
        }),
      }),
    );
    expect(broadcastPortfolioEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "rebalance_completed",
        data: expect.objectContaining({ status: "partial", postTradeBalances, residualWork }),
      }),
    );
  });
});
