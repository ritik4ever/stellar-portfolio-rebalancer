import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";

const mocks = vi.hoisted(() => ({
  getAllPortfolios: vi.fn(),
  getCurrentPricesWithMeta: vi.fn(),
  queueAdd: vi.fn(),
  getRebalanceQueue: vi.fn(),
  recordRebalanceEvent: vi.fn(),
  notify: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock("../services/portfolioStorage.js", () => ({
  portfolioStorage: { getAllPortfolios: mocks.getAllPortfolios },
}));

vi.mock("../services/reflector.js", () => ({
  ReflectorService: function ReflectorService(this: any) {
    this.getCurrentPricesWithMeta = mocks.getCurrentPricesWithMeta;
  },
}));

vi.mock("../services/serviceContainer.js", () => ({
  riskManagementService: {
    shouldAllowRebalance: vi.fn().mockReturnValue({ allowed: true, reason: "OK" }),
  },
  rebalanceHistoryService: {
    recordRebalanceEvent: mocks.recordRebalanceEvent,
  },
}));

vi.mock("../services/circuitBreakers.js", () => ({
  CircuitBreakers: {
    checkMarketConditions: vi.fn().mockReturnValue({ safe: true }),
    checkCooldownPeriod: vi.fn().mockReturnValue({ safe: true }),
  },
}));

vi.mock("../services/notificationService.js", () => ({
  notificationService: { notify: mocks.notify },
}));

vi.mock("../queue/queues.js", () => ({
  getRebalanceQueue: mocks.getRebalanceQueue,
}));

vi.mock("../queue/connection.js", () => ({
  getConnectionOptions: vi.fn().mockReturnValue({}),
}));

vi.mock("../queue/workers/workerRuntime.js", () => ({
  createWorkerRuntimeStatus: vi.fn().mockReturnValue({}),
  markWorkerFailed: vi.fn(),
  markWorkerJobCompleted: vi.fn(),
  markWorkerJobFailed: vi.fn(),
  markWorkerReady: vi.fn(),
  markWorkerStarting: vi.fn(),
  markWorkerStopped: vi.fn(),
  snapshotWorkerRuntimeStatus: vi.fn().mockReturnValue({}),
  handleFinalFailure: vi.fn(),
}));

vi.mock("../utils/requestContext.js", () => ({
  runWithRequestContext: vi.fn((_context, callback) => callback()),
}));

vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: mocks.loggerInfo,
    warn: vi.fn(),
  },
  logAudit: vi.fn(),
}));

import {
  processAutoRebalanceJob,
  resolveAutoRebalanceDryRun,
} from "../jobs/autoRebalance.js";
import { createPortfolioSchema } from "../api/validation.js";

const portfolio = {
  id: "portfolio-dry-run",
  userAddress: "GDRYRUNUSER",
  allocations: { XLM: 50, USDC: 50 },
  balances: { XLM: 100, USDC: 0 },
  threshold: 5,
  totalValue: 100,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastRebalance: "2026-01-01T00:00:00.000Z",
  version: 1,
  strategyConfig: { dryRun: true },
};

function mockJob(): Job<any> {
  return {
    id: "auto-check-1",
    data: { triggeredBy: "scheduler", correlationId: "correlation-1" },
  } as Job<any>;
}

describe("scheduled auto-rebalance dry-run mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUTO_REBALANCE_DRY_RUN;
    mocks.getAllPortfolios.mockResolvedValue([portfolio]);
    mocks.getCurrentPricesWithMeta.mockResolvedValue({
      prices: {
        XLM: { price: 1, change: 0, timestamp: 1 },
        USDC: { price: 1, change: 0, timestamp: 1 },
      },
      feedMeta: {
        provider: "backend",
        resolvedAtMs: 1,
        degraded: false,
        staleOrLimited: false,
        resolutionHint: "fresh_primary",
        assetsCount: 2,
      },
    });
    mocks.getRebalanceQueue.mockReturnValue({ add: mocks.queueAdd });
    mocks.recordRebalanceEvent.mockResolvedValue({ id: "history-1" });
    mocks.notify.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.AUTO_REBALANCE_DRY_RUN;
  });

  it("computes and reports a simulated plan without enqueueing execution", async () => {
    const summary = await processAutoRebalanceJob(mockJob());

    expect(mocks.queueAdd).not.toHaveBeenCalled();
    expect(mocks.recordRebalanceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        portfolioId: portfolio.id,
        eventSource: "simulated",
        isSimulated: true,
        trades: 2,
        triggerMetadata: expect.objectContaining({
          dryRun: true,
          simulated: true,
          plan: expect.objectContaining({
            portfolioId: portfolio.id,
            estimatedFees: expect.objectContaining({ tradeCount: 2 }),
            assets: expect.arrayContaining([
              expect.objectContaining({ asset: "XLM", action: "sell" }),
              expect.objectContaining({ asset: "USDC", action: "buy" }),
            ]),
          }),
        }),
      }),
    );
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        portfolioId: portfolio.id,
        title: "Rebalance Simulation (Dry Run)",
        data: expect.objectContaining({
          dryRun: true,
          isSimulated: true,
          plan: expect.objectContaining({ portfolioId: portfolio.id }),
        }),
      }),
    );
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining("Dry-run plan computed"),
      expect.objectContaining({
        portfolioId: portfolio.id,
        plan: expect.objectContaining({ portfolioId: portfolio.id }),
      }),
    );
    expect(summary).toMatchObject({ portfoliosTriggered: 0, portfoliosSimulated: 1 });
  });

  it("allows the global setting and lets portfolio configuration override it", () => {
    expect(
      resolveAutoRebalanceDryRun(
        { ...portfolio, strategyConfig: undefined },
        { AUTO_REBALANCE_DRY_RUN: " TRUE " },
      ),
    ).toEqual({ enabled: true, source: "environment" });

    expect(
      resolveAutoRebalanceDryRun(
        { ...portfolio, strategyConfig: { dryRun: false } },
        { AUTO_REBALANCE_DRY_RUN: "true" },
      ),
    ).toEqual({ enabled: false, source: "portfolio" });
  });

  it("uses the global setting in the scheduled path when no portfolio override exists", async () => {
    process.env.AUTO_REBALANCE_DRY_RUN = "true";
    mocks.getAllPortfolios.mockResolvedValue([
      { ...portfolio, strategyConfig: undefined },
    ]);

    const summary = await processAutoRebalanceJob(mockJob());

    expect(mocks.queueAdd).not.toHaveBeenCalled();
    expect(mocks.recordRebalanceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        isSimulated: true,
        triggerMetadata: expect.objectContaining({
          dryRun: true,
          dryRunSource: "environment",
        }),
      }),
    );
    expect(summary).toMatchObject({ portfoliosTriggered: 0, portfoliosSimulated: 1 });
  });

  it("accepts dryRun in portfolio strategy configuration", () => {
    const parsed = createPortfolioSchema.safeParse({
      userAddress: "GDRYRUNUSER",
      allocations: { XLM: 50, USDC: 50 },
      threshold: 5,
      strategyConfig: { dryRun: true },
    });

    expect(parsed.success).toBe(true);
  });
});
