import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getRequestId } from "../utils/requestContext.js";
import { logger } from "../utils/logger.js";

vi.mock("../services/stellar.js", () => {
  function StellarService(this: any) {}
  StellarService.prototype.getPortfolio = vi
    .fn()
    .mockResolvedValue({ id: "p1", userAddress: "GUSER" });
  StellarService.prototype.executeRebalance = vi
    .fn()
    .mockResolvedValue({ trades: 0, gasUsed: "0 XLM" });
  StellarService.prototype.checkRebalanceNeeded = vi
    .fn()
    .mockResolvedValue(true);
  return { StellarService };
});

vi.mock("../services/reflector.js", () => {
  function ReflectorService(this: any) {
    this.getCurrentPrices = vi.fn().mockResolvedValue({});
  }
  return { ReflectorService };
});

vi.mock("../queue/workers/workerRuntime.js", () => ({
  acquireWorkerLock: vi.fn().mockResolvedValue(true),
  releaseWorkerLock: vi.fn().mockResolvedValue(true),
  createWorkerRuntimeStatus: vi.fn().mockReturnValue({}),
}));

vi.mock("../services/portfolioStorage.js", () => ({
  portfolioStorage: {
    getAllPortfolios: vi.fn().mockResolvedValue([{ id: "p1", threshold: 5 }]),
    getPortfolio: vi.fn().mockResolvedValue({ id: "p1" }),
  },
}));

vi.mock("../services/serviceContainer.js", () => ({
  rebalanceHistoryService: {
    recordRebalanceEvent: vi.fn().mockResolvedValue({ id: "hist-1" }),
  },
}));

vi.mock("../queue/queues.js", () => ({
  getRebalanceQueue: vi
    .fn()
    .mockReturnValue({ add: vi.fn().mockResolvedValue({ id: "job-1" }) }),
  getPortfolioCheckQueue: vi
    .fn()
    .mockReturnValue({ add: vi.fn().mockResolvedValue({ id: "job-2" }) }),
}));

import { processRebalanceJob } from "../queue/workers/rebalanceWorker.js";
import { processPortfolioCheckJob } from "../queue/workers/portfolioCheckWorker.js";

describe("correlation propagation into workers", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("exposes correlationId as request context in rebalance worker", async () => {
    const testCid = "test-cid-rebalance";
    const spy = vi.spyOn(logger, "info").mockImplementation(() => {
      expect(getRequestId()).toBe(testCid);
    });

    const job = {
      id: "j1",
      data: {
        portfolioId: "p1",
        triggeredBy: "manual",
        correlationId: testCid,
      },
      attemptsMade: 0,
    } as any;
    await processRebalanceJob(job);
    expect(spy).toHaveBeenCalled();
  });

  it("exposes correlationId as request context in portfolio-check worker", async () => {
    const testCid = "test-cid-check";
    const spy = vi.spyOn(logger, "info").mockImplementation(() => {
      expect(getRequestId()).toBe(testCid);
    });

    const job = {
      id: "j2",
      data: { triggeredBy: "manual", correlationId: testCid },
      attemptsMade: 0,
    } as any;
    await processPortfolioCheckJob(job);
    expect(spy).toHaveBeenCalled();
  });
});
