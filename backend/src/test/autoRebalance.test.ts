import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateBackoffDelay,
  recordAutoRebalanceFailure,
  recordAutoRebalanceSuccess,
  isPortfolioInBackoff,
  getPortfolioBackoffState,
  getAllBackoffStates,
  resetAllBackoffStates,
  processAutoRebalanceJob,
  DEFAULT_BACKOFF_CONFIG,
  type AutoRebalanceBackoffConfig,
} from "../jobs/autoRebalance.js";
import { portfolioStorage } from "../services/portfolioStorage.js";
import { ReflectorService } from "../services/reflector.js";
import { CircuitBreakers } from "../services/circuitBreakers.js";
import { riskManagementService } from "../services/serviceContainer.js";
import { getRebalanceQueue } from "../queue/queues.js";
import type { Portfolio } from "../types/index.js";

vi.mock("../services/portfolioStorage.js", () => ({
  portfolioStorage: {
    getAllPortfolios: vi.fn(),
  },
}));

vi.mock("../services/reflector.js", () => {
  return {
    ReflectorService: class {
      async getCurrentPrices() {
        return {
          XLM: { price: 1, timestamp: Date.now() },
          USDC: { price: 1, timestamp: Date.now() },
        };
      }
    },
  };
});

vi.mock("../services/circuitBreakers.js", () => ({
  CircuitBreakers: {
    checkMarketConditions: vi.fn().mockReturnValue({ safe: true }),
    checkCooldownPeriod: vi.fn().mockReturnValue({ safe: true }),
  },
}));

vi.mock("../services/serviceContainer.js", () => ({
  riskManagementService: {
    shouldAllowRebalance: vi.fn().mockReturnValue({ allowed: true }),
  },
}));

const mockAdd = vi.fn();
vi.mock("../queue/queues.js", () => ({
  getRebalanceQueue: vi.fn(() => ({
    add: mockAdd,
  })),
}));

describe("Per-user exponential backoff after auto-rebalance failures (#1402)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    resetAllBackoffStates();
    mockAdd.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetAllBackoffStates();
    vi.useRealTimers();
  });

  describe("calculateBackoffDelay", () => {
    it("returns 0 for 0 or negative failures", () => {
      expect(calculateBackoffDelay(0)).toBe(0);
      expect(calculateBackoffDelay(-1)).toBe(0);
    });

    it("calculates exponential progression correctly", () => {
      const config: AutoRebalanceBackoffConfig = {
        baseBackoffMs: 5 * 60 * 1000, // 5 min
        backoffMultiplier: 2,
        maxBackoffMs: 60 * 60 * 1000, // 60 min
        minCooldownHours: 1,
      };

      // 1st failure: 5 min
      expect(calculateBackoffDelay(1, config)).toBe(5 * 60 * 1000);
      // 2nd failure: 10 min
      expect(calculateBackoffDelay(2, config)).toBe(10 * 60 * 1000);
      // 3rd failure: 20 min
      expect(calculateBackoffDelay(3, config)).toBe(20 * 60 * 1000);
      // 4th failure: 40 min
      expect(calculateBackoffDelay(4, config)).toBe(40 * 60 * 1000);
      // 5th failure: capped at max (60 min instead of 80 min)
      expect(calculateBackoffDelay(5, config)).toBe(60 * 60 * 1000);
    });

    it("respects default configuration if not provided", () => {
      // 1st failure with default 5m
      expect(calculateBackoffDelay(1)).toBe(DEFAULT_BACKOFF_CONFIG.baseBackoffMs);
      // 2nd failure = 10m
      expect(calculateBackoffDelay(2)).toBe(DEFAULT_BACKOFF_CONFIG.baseBackoffMs * 2);
    });
  });

  describe("recordAutoRebalanceFailure and state tracking", () => {
    it("tracks consecutive failures and sets next allowed attempt timestamp", () => {
      const config = {
        baseBackoffMs: 5 * 60 * 1000, // 5 min
        backoffMultiplier: 2,
      };

      const f1 = recordAutoRebalanceFailure("port-1", "Transaction failed", config);
      expect(f1.consecutiveFailures).toBe(1);
      expect(f1.currentBackoffMs).toBe(5 * 60 * 1000);
      expect(f1.lastFailureReason).toBe("Transaction failed");
      expect(f1.nextAllowedAttemptAt).toBe(new Date(Date.now() + 5 * 60 * 1000).toISOString());

      // 2nd failure
      const f2 = recordAutoRebalanceFailure("port-1", new Error("Slippage too high"), config);
      expect(f2.consecutiveFailures).toBe(2);
      expect(f2.currentBackoffMs).toBe(10 * 60 * 1000);
      expect(f2.lastFailureReason).toBe("Slippage too high");
      expect(f2.nextAllowedAttemptAt).toBe(new Date(Date.now() + 10 * 60 * 1000).toISOString());

      // Verify retrieved state matches
      const retrieved = getPortfolioBackoffState("port-1");
      expect(retrieved?.consecutiveFailures).toBe(2);
      expect(retrieved?.currentBackoffMs).toBe(10 * 60 * 1000);
    });

    it("isolates failure tracking across multiple portfolios", () => {
      recordAutoRebalanceFailure("port-A", "Error A");
      recordAutoRebalanceFailure("port-A", "Error A2");
      recordAutoRebalanceFailure("port-B", "Error B");

      const stateA = getPortfolioBackoffState("port-A");
      const stateB = getPortfolioBackoffState("port-B");

      expect(stateA?.consecutiveFailures).toBe(2);
      expect(stateB?.consecutiveFailures).toBe(1);

      const all = getAllBackoffStates();
      expect(all).toHaveLength(2);
    });
  });

  describe("isPortfolioInBackoff", () => {
    it("returns false for portfolios with no failure history", () => {
      const status = isPortfolioInBackoff("port-clean");
      expect(status.inBackoff).toBe(false);
      expect(status.consecutiveFailures).toBe(0);
    });

    it("returns true while within backoff interval, and false once interval elapses", () => {
      const config = { baseBackoffMs: 10 * 60 * 1000 }; // 10 minutes
      recordAutoRebalanceFailure("port-1", "RPC timeout", config);

      // Immediately after failure: in backoff
      const status1 = isPortfolioInBackoff("port-1");
      expect(status1.inBackoff).toBe(true);
      expect(status1.consecutiveFailures).toBe(1);
      expect(status1.remainingMs).toBe(10 * 60 * 1000);

      // Advance time by 6 minutes (still within 10m backoff)
      vi.advanceTimersByTime(6 * 60 * 1000);
      const status2 = isPortfolioInBackoff("port-1");
      expect(status2.inBackoff).toBe(true);
      expect(status2.remainingMs).toBe(4 * 60 * 1000);

      // Advance time past 10 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);
      const status3 = isPortfolioInBackoff("port-1");
      expect(status3.inBackoff).toBe(false);
      expect(status3.remainingMs).toBe(0);
    });
  });

  describe("recordAutoRebalanceSuccess", () => {
    it("resets consecutive failure counter and clears backoff state", () => {
      recordAutoRebalanceFailure("port-1", "Error 1");
      recordAutoRebalanceFailure("port-1", "Error 2");

      expect(getPortfolioBackoffState("port-1")?.consecutiveFailures).toBe(2);
      expect(isPortfolioInBackoff("port-1").inBackoff).toBe(true);

      // Successful rebalance occurs
      recordAutoRebalanceSuccess("port-1");

      const state = getPortfolioBackoffState("port-1");
      expect(state?.consecutiveFailures).toBe(0);
      expect(state?.currentBackoffMs).toBe(0);
      expect(state?.nextAllowedAttemptAt).toBeUndefined();
      expect(state?.lastSuccessAt).toBeDefined();

      expect(isPortfolioInBackoff("port-1").inBackoff).toBe(false);
    });
  });

  describe("processAutoRebalanceJob integration with backoff", () => {
    const createMockPortfolio = (id: string, overrides: Partial<Portfolio> = {}): Portfolio => ({
      id,
      userAddress: `user-${id}`,
      balances: { XLM: 100, USDC: 0 },
      allocations: { XLM: 50, USDC: 50 },
      threshold: 5,
      lastRebalance: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    });

    it("skips portfolios that are currently in exponential backoff", async () => {
      const port1 = createMockPortfolio("port-1");
      const port2 = createMockPortfolio("port-2");

      vi.mocked(portfolioStorage.getAllPortfolios).mockResolvedValue([port1, port2]);
      vi.mocked(CircuitBreakers.checkMarketConditions).mockReturnValue({ safe: true });
      vi.mocked(CircuitBreakers.checkCooldownPeriod).mockReturnValue({ safe: true });
      vi.mocked(riskManagementService.shouldAllowRebalance).mockReturnValue({ allowed: true });

      // Put port-1 into backoff
      recordAutoRebalanceFailure("port-1", "Temporary DEX failure", { baseBackoffMs: 15 * 60 * 1000 });

      const summary = await processAutoRebalanceJob({
        id: "job-1",
        data: { triggeredBy: "scheduler" },
      } as any);

      expect(summary.portfoliosChecked).toBe(2);
      // port-1 skipped for backoff, port-2 triggered
      expect(summary.portfoliosTriggered).toBe(1);
      const backoffSkip = summary.portfoliosSkipped.find((s) => s.reason === "backoff");
      expect(backoffSkip?.count).toBe(1);

      expect(mockAdd).toHaveBeenCalledTimes(1);
      expect(mockAdd).toHaveBeenCalledWith(
        "rebalance-port-2",
        expect.objectContaining({ portfolioId: "port-2" }),
        expect.anything(),
      );
    });

    it("processes portfolio once backoff interval expires", async () => {
      const port1 = createMockPortfolio("port-1");

      vi.mocked(portfolioStorage.getAllPortfolios).mockResolvedValue([port1]);
      vi.mocked(CircuitBreakers.checkMarketConditions).mockReturnValue({ safe: true });
      vi.mocked(CircuitBreakers.checkCooldownPeriod).mockReturnValue({ safe: true });
      vi.mocked(riskManagementService.shouldAllowRebalance).mockReturnValue({ allowed: true });

      // 5 min backoff
      recordAutoRebalanceFailure("port-1", "Network glitch", { baseBackoffMs: 5 * 60 * 1000 });

      // Attempt 1: blocked
      const res1 = await processAutoRebalanceJob({
        id: "job-1",
        data: { triggeredBy: "scheduler" },
      } as any);
      expect(res1.portfoliosTriggered).toBe(0);
      expect(mockAdd).not.toHaveBeenCalled();

      // Advance time by 6 minutes
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Attempt 2: allowed
      const res2 = await processAutoRebalanceJob({
        id: "job-2",
        data: { triggeredBy: "scheduler" },
      } as any);
      expect(res2.portfoliosTriggered).toBe(1);
      expect(mockAdd).toHaveBeenCalledTimes(1);
    });

    it("records failure and sets up backoff if rebalance queue or check throws", async () => {
      const port1 = createMockPortfolio("port-1");
      vi.mocked(portfolioStorage.getAllPortfolios).mockResolvedValue([port1]);
      vi.mocked(CircuitBreakers.checkMarketConditions).mockReturnValue({ safe: true });
      vi.mocked(CircuitBreakers.checkCooldownPeriod).mockReturnValue({ safe: true });
      vi.mocked(riskManagementService.shouldAllowRebalance).mockImplementation(() => {
        throw new Error("Risk assessment timeout");
      });

      const summary = await processAutoRebalanceJob(
        {
          id: "job-err",
          data: { triggeredBy: "scheduler" },
        } as any,
        { baseBackoffMs: 10 * 60 * 1000 },
      );

      expect(summary.errors).toHaveLength(1);
      expect(summary.errors[0]).toContain("Risk assessment timeout");

      // Verify backoff state was registered
      const backoff = getPortfolioBackoffState("port-1");
      expect(backoff?.consecutiveFailures).toBe(1);
      expect(backoff?.currentBackoffMs).toBe(10 * 60 * 1000);
      expect(backoff?.lastFailureReason).toBe("Risk assessment timeout");
      expect(isPortfolioInBackoff("port-1").inBackoff).toBe(true);
    });
  });
});
