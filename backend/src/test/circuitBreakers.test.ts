import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CircuitBreakers } from "../services/circuitBreakers.js";
import { RiskManagementService } from "../services/riskManagements.js";
import type { PricesMap } from "../types/index.js";

const makePrices = (
  entries: Record<string, { price: number; change?: number }>,
  timestamp: number,
): PricesMap =>
  Object.entries(entries).reduce<PricesMap>((acc, [asset, value]) => {
    acc[asset] = {
      price: value.price,
      change: value.change ?? 0,
      timestamp,
      source: "external",
    };
    return acc;
  }, {});

// ============================================================
// CircuitBreakers static class tests
// ============================================================

describe("CircuitBreakers", () => {
  describe("trigger path - volatility detection", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("triggers circuit breaker when asset volatility exceeds 15%", async () => {
      const prices = {
        BTC: { change: 16.5, timestamp: Date.now() / 1000 },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("High volatility detected");
      expect(result.reason).toContain("BTC");
    });

    it("does not trigger when volatility is below threshold", async () => {
      const prices = {
        BTC: { change: 10, timestamp: Date.now() / 1000 },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("triggers for negative volatility exceeding threshold", async () => {
      const prices = {
        ETH: { change: -18.2, timestamp: Date.now() / 1000 },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("High volatility detected");
      expect(result.reason).toContain("-18.20%");
    });
  });

  describe("trigger path - stale data detection", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("triggers circuit breaker when price data is older than 10 minutes", async () => {
      const staleTimestamp = Date.now() / 1000 - 11 * 60;
      const prices = {
        BTC: { change: 5, timestamp: staleTimestamp },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Stale price data");
      expect(result.reason).toContain("BTC");
    });

    it("does not trigger for fresh data within 10 minutes", async () => {
      const freshTimestamp = Date.now() / 1000 - 5 * 60;
      const prices = {
        BTC: { change: 5, timestamp: freshTimestamp },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(true);
    });

    it("triggers when any asset has stale data", async () => {
      vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));

      const freshTimestamp = Date.now() / 1000 - 5 * 60;
      const staleTimestamp = Date.now() / 1000 - 15 * 60;

      const prices = {
        BTC: { change: 5, timestamp: freshTimestamp },
        ETH: { change: 3, timestamp: staleTimestamp },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Stale price data");
    });
  });

  describe("trigger path - correlation breakdown", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("triggers when all major assets move in the same positive direction", async () => {
      const prices = {
        BTC: { change: 6 },
        ETH: { change: 7 },
        XLM: { change: 8 },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Extreme market correlation detected");
      expect(result.reason).toContain("up");
    });

    it("triggers when all major assets move in the same negative direction", async () => {
      const prices = {
        BTC: { change: -6 },
        ETH: { change: -7 },
        XLM: { change: -8 },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Extreme market correlation detected");
      expect(result.reason).toContain("down");
    });

    it("does not trigger when assets move in mixed directions", async () => {
      const prices = {
        BTC: { change: 6 },
        ETH: { change: -3 },
        XLM: { change: 2 },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(true);
    });

    it("does not trigger when fewer than 3 assets have significant moves", async () => {
      const prices = {
        BTC: { change: 6 },
        ETH: { change: 2 },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(true);
    });
  });

  describe("cooldown period", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("rejects rebalance during cooldown period", () => {
      const lastRebalance = new Date("2026-01-01T09:30:00.000Z").toISOString();

      const result = CircuitBreakers.checkCooldownPeriod(lastRebalance, 1);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Cooldown active");
      expect(result.reason).toContain("hours remaining");
    });

    it("allows rebalance after cooldown expires", () => {
      const lastRebalance = new Date("2026-01-01T08:59:00.000Z").toISOString();

      const result = CircuitBreakers.checkCooldownPeriod(lastRebalance, 1);

      expect(result.safe).toBe(true);
    });

    it("allows rebalance exactly at cooldown boundary", () => {
      const lastRebalance = new Date("2026-01-01T09:00:00.000Z").toISOString();

      const result = CircuitBreakers.checkCooldownPeriod(lastRebalance, 1);

      expect(result.safe).toBe(true);
    });

    it("calculates remaining cooldown time correctly", () => {
      vi.setSystemTime(new Date("2026-01-01T10:42:00.000Z"));
      const lastRebalance = new Date("2026-01-01T10:00:00.000Z").toISOString();

      const result = CircuitBreakers.checkCooldownPeriod(lastRebalance, 1);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("0.3 hours remaining");
    });

    it("uses default cooldown of 1 hour when not specified", () => {
      const lastRebalance = new Date("2026-01-01T09:45:00.000Z").toISOString();

      const result = CircuitBreakers.checkCooldownPeriod(lastRebalance);

      expect(result.safe).toBe(false);
    });
  });

  describe("recovery path", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("recovers after cooldown expires and allows rebalancing", () => {
      const lastRebalance = new Date("2026-01-01T10:00:00.000Z").toISOString();

      // During cooldown - should be blocked
      const duringCooldown = CircuitBreakers.checkCooldownPeriod(
        lastRebalance,
        1,
      );
      expect(duringCooldown.safe).toBe(false);

      // Advance time past cooldown (1 hour + 1 second)
      vi.advanceTimersByTime(3601000);

      // After cooldown - should be allowed
      const afterCooldown = CircuitBreakers.checkCooldownPeriod(
        lastRebalance,
        1,
      );
      expect(afterCooldown.safe).toBe(true);
    });

    it("recovers market conditions after volatility normalizes", async () => {
      const highVolatilityPrices = {
        BTC: { change: 20, timestamp: Date.now() / 1000 },
      };

      const highVolResult =
        await CircuitBreakers.checkMarketConditions(highVolatilityPrices);
      expect(highVolResult.safe).toBe(false);

      const normalPrices = {
        BTC: { change: 3, timestamp: Date.now() / 1000 },
      };

      const normalResult =
        await CircuitBreakers.checkMarketConditions(normalPrices);
      expect(normalResult.safe).toBe(true);
    });

    it("recovers after stale data becomes fresh", async () => {
      vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));

      const staleTimestamp = Date.now() / 1000 - 15 * 60;
      const stalePrices = {
        BTC: { change: 5, timestamp: staleTimestamp },
      };

      const staleResult =
        await CircuitBreakers.checkMarketConditions(stalePrices);
      expect(staleResult.safe).toBe(false);

      const freshPrices = {
        BTC: { change: 5, timestamp: Date.now() / 1000 },
      };

      const freshResult =
        await CircuitBreakers.checkMarketConditions(freshPrices);
      expect(freshResult.safe).toBe(true);
    });

    it("recovers after correlation normalizes", async () => {
      const correlatedPrices = {
        BTC: { change: 8 },
        ETH: { change: 7 },
        XLM: { change: 9 },
      };

      const correlatedResult =
        await CircuitBreakers.checkMarketConditions(correlatedPrices);
      expect(correlatedResult.safe).toBe(false);

      const normalPrices = {
        BTC: { change: 5 },
        ETH: { change: -2 },
        XLM: { change: 3 },
      };

      const normalResult =
        await CircuitBreakers.checkMarketConditions(normalPrices);
      expect(normalResult.safe).toBe(true);
    });
  });

  describe("concurrent triggers for multiple assets", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("triggers circuit breaker for multiple assets independently", async () => {
      const prices = {
        BTC: { change: 18, timestamp: Date.now() / 1000 },
        ETH: { change: 20, timestamp: Date.now() / 1000 },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/BTC|ETH/);
    });

    it("handles mixed trigger conditions across assets", async () => {
      const prices = {
        BTC: { change: 16, timestamp: Date.now() / 1000 },
        ETH: { change: 3, timestamp: Date.now() / 1000 },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("BTC");
    });

    it("handles stale data for some assets but not others", async () => {
      vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));

      const freshTimestamp = Date.now() / 1000 - 5 * 60;
      const staleTimestamp = Date.now() / 1000 - 15 * 60;

      const prices = {
        BTC: { change: 5, timestamp: freshTimestamp },
        ETH: { change: 3, timestamp: staleTimestamp },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("ETH");
    });

    it("processes all assets in portfolio for correlation check", async () => {
      const prices = {
        BTC: { change: 10 },
        ETH: { change: 12 },
        XLM: { change: 8 },
        USDC: { change: 0.01 },
      };

      const result = await CircuitBreakers.checkMarketConditions(prices);

      expect(result.safe).toBe(false);
    });
  });

  describe("additional risk checks", () => {
    it("checks concentration risk - rejects single asset over 80%", () => {
      const allocations = {
        BTC: 85,
        ETH: 15,
      };

      const result = CircuitBreakers.checkConcentrationRisk(allocations);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Concentration risk");
      expect(result.reason).toContain("BTC");
    });

    it("allows well-diversified portfolios", () => {
      const allocations = {
        BTC: 40,
        ETH: 35,
        XLM: 25,
      };

      const result = CircuitBreakers.checkConcentrationRisk(allocations);

      expect(result.safe).toBe(true);
    });

    it("rejects trade size over 25% of portfolio", () => {
      const result = CircuitBreakers.checkTradeSize(30000, 100000);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Trade size too large");
      expect(result.reason).toContain("30.0%");
    });

    it("rejects trade size below $10 minimum", () => {
      const result = CircuitBreakers.checkTradeSize(5, 10000);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Trade size too small");
    });

    it("allows valid trade sizes", () => {
      const result = CircuitBreakers.checkTradeSize(15000, 100000);

      expect(result.safe).toBe(true);
    });
  });

  describe("end-to-end lifecycle", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("complete lifecycle: trigger → cooldown → recovery", async () => {
      // Step 1: Trigger circuit breaker with high volatility
      const highVolPrices = {
        BTC: { change: 25, timestamp: Date.now() / 1000 },
      };
      const triggerResult =
        await CircuitBreakers.checkMarketConditions(highVolPrices);
      expect(triggerResult.safe).toBe(false);

      // Step 2: Verify cooldown blocks rebalance
      const lastRebalance = new Date("2026-01-01T10:00:00.000Z").toISOString();
      const cooldownResult = CircuitBreakers.checkCooldownPeriod(
        lastRebalance,
        1,
      );
      expect(cooldownResult.safe).toBe(false);

      // Step 3: Advance time past cooldown
      vi.advanceTimersByTime(3601000);

      // Step 4: Verify recovery - rebalancing allowed
      const recoveryCooldownResult = CircuitBreakers.checkCooldownPeriod(
        lastRebalance,
        1,
      );
      expect(recoveryCooldownResult.safe).toBe(true);

      // Step 5: Verify market conditions are now safe
      const normalPrices = {
        BTC: { change: 5, timestamp: Date.now() / 1000 },
      };
      const marketResult =
        await CircuitBreakers.checkMarketConditions(normalPrices);
      expect(marketResult.safe).toBe(true);
    });

    it("handles multiple assets with staggered recovery", async () => {
      const btcVolatilePrices = {
        BTC: { change: 20, timestamp: Date.now() / 1000 },
      };
      const btcTrigger =
        await CircuitBreakers.checkMarketConditions(btcVolatilePrices);
      expect(btcTrigger.safe).toBe(false);

      vi.advanceTimersByTime(60000);
      const ethVolatilePrices = {
        ETH: { change: 22, timestamp: Date.now() / 1000 },
      };
      const ethTrigger =
        await CircuitBreakers.checkMarketConditions(ethVolatilePrices);
      expect(ethTrigger.safe).toBe(false);

      const combinedPrices = {
        BTC: { change: 20, timestamp: Date.now() / 1000 },
        ETH: { change: 22, timestamp: Date.now() / 1000 },
      };
      const combinedResult =
        CircuitBreakers.checkMarketConditions(combinedPrices);
      expect(combinedResult.safe).toBe(false);
    });
  });
});

// ============================================================
// RiskManagementService circuit breaker lifecycle tests
// ============================================================

describe("RiskManagementService circuit breaker lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers breaker, rejects rebalance during cooldown, and recovers after expiry", () => {
    const service = new RiskManagementService();
    const t0 = Date.now();

    service.updatePriceData(makePrices({ BTC: { price: 100 } }, t0));
    service.updatePriceData(makePrices({ BTC: { price: 130 } }, t0 + 1_000));

    const triggeredStatus = service.getCircuitBreakerStatus();
    expect(triggeredStatus.BTC?.isTriggered).toBe(true);

    const cooldownDecision = service.shouldAllowRebalance(
      { allocations: { BTC: 0.5, ETH: 0.5 } },
      makePrices({ BTC: { price: 130 }, ETH: { price: 50 } }, Date.now()),
    );
    expect(cooldownDecision.allowed).toBe(false);
    expect(cooldownDecision.reasonCode).toBe("CIRCUIT_BREAKER_ACTIVE");

    vi.advanceTimersByTime(300_001);

    const recoveredStatus = service.getCircuitBreakerStatus();
    expect(recoveredStatus.BTC?.isTriggered).toBe(false);

    const recoveredDecision = service.shouldAllowRebalance(
      { allocations: { BTC: 0.5, ETH: 0.5 } },
      makePrices({ BTC: { price: 130 }, ETH: { price: 50 } }, Date.now()),
    );
    expect(recoveredDecision.allowed).toBe(true);
    expect(recoveredDecision.reasonCode).toBe("OK");
  });

  it("supports concurrent circuit-breaker triggers across multiple assets", () => {
    const service = new RiskManagementService();
    const t0 = Date.now();

    service.updatePriceData(
      makePrices(
        {
          BTC: { price: 100 },
          ETH: { price: 50 },
        },
        t0,
      ),
    );

    service.updatePriceData(
      makePrices(
        {
          BTC: { price: 125 },
          ETH: { price: 65 },
        },
        t0 + 1_000,
      ),
    );

    const status = service.getCircuitBreakerStatus();
    expect(status.BTC?.isTriggered).toBe(true);
    expect(status.ETH?.isTriggered).toBe(true);
    expect(status.BTC?.triggeredAssets).toEqual(["BTC"]);
    expect(status.ETH?.triggeredAssets).toEqual(["ETH"]);
  });
});
