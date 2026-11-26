import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreakers } from "../services/circuitBreakers.js";
import {
  CooldownGate,
  cooldownHoursToMs,
  emitGuardrailOutcome,
  evaluateCooldown,
  evaluatePartialFillConcentration,
  evaluateQueuedPriceFreshness,
  MAX_PRICE_AGE_MS,
  oldestPriceTimestampMs,
  type GuardrailOutcome,
} from "../services/guardrailOutcomes.js";
import { logger } from "../utils/logger.js";

const HOUR = 60 * 60 * 1000;
const LAST_RUN = Date.parse("2026-01-01T09:00:00.000Z");
const EXPIRY = LAST_RUN + HOUR;

// ─────────────────────────────────────────────────────────────────────────────
// #2060 – Boundary handling for cooldown enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("cooldown boundary handling (SPR-2026-136)", () => {
  it("permits a request evaluated exactly at the cooldown expiry instant", () => {
    const decision = evaluateCooldown({
      source: "test",
      lastRebalance: new Date(LAST_RUN).toISOString(),
      minCooldownHours: 1,
      nowMs: EXPIRY,
    });

    expect(decision.outcome).toBe("allowed");
    expect(decision.reasonCode).toBe("COOLDOWN_EXPIRED");
    expect(decision.remainingMs).toBe(0);
    expect(decision.lastRunAt).toBe("2026-01-01T09:00:00.000Z");
    expect(decision.cooldownEndsAt).toBe("2026-01-01T10:00:00.000Z");
  });

  it("delays a request 1ms before the expiry instant", () => {
    const decision = evaluateCooldown({
      source: "test",
      lastRebalance: new Date(LAST_RUN).toISOString(),
      minCooldownHours: 1,
      nowMs: EXPIRY - 1,
    });

    expect(decision.outcome).toBe("delayed");
    expect(decision.reasonCode).toBe("COOLDOWN_ACTIVE");
    expect(decision.remainingMs).toBe(1);
  });

  it("uses integer milliseconds so fractional-hour cooldowns have a stable boundary", () => {
    expect(cooldownHoursToMs(0.1)).toBe(360_000);
    const decision = evaluateCooldown({
      source: "test",
      lastRebalance: LAST_RUN,
      minCooldownHours: 0.1,
      nowMs: LAST_RUN + 360_000,
    });
    expect(decision.outcome).toBe("allowed");
  });

  it("returns an identical decision for identical inputs (stable result)", () => {
    const input = {
      source: "test",
      lastRebalance: new Date(LAST_RUN).toISOString(),
      minCooldownHours: 1,
      nowMs: EXPIRY,
    };
    expect(evaluateCooldown(input)).toEqual(evaluateCooldown(input));
  });

  it("treats a missing or invalid last-run time as no prior run", () => {
    for (const lastRebalance of [undefined, null, "", "not-a-date"]) {
      const decision = evaluateCooldown({ source: "test", lastRebalance, minCooldownHours: 1, nowMs: EXPIRY });
      expect(decision.outcome).toBe("allowed");
      expect(decision.reasonCode).toBe("COOLDOWN_NO_PRIOR_RUN");
    }
  });

  it("keeps the cooldown active when the last run is in the future (clock skew)", () => {
    const decision = evaluateCooldown({
      source: "test",
      lastRebalance: EXPIRY + 5_000,
      minCooldownHours: 1,
      nowMs: EXPIRY,
    });
    expect(decision.outcome).toBe("delayed");
    expect(decision.remainingMs).toBe(HOUR + 5_000);
  });

  describe("CircuitBreakers.checkCooldownPeriod at the boundary", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(EXPIRY));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("is safe exactly at expiry and reports the expiry instant", () => {
      const result = CircuitBreakers.checkCooldownPeriod(new Date(LAST_RUN).toISOString(), 1);
      expect(result.safe).toBe(true);
      expect(result.outcome).toBe("allowed");
      expect(result.reasonCode).toBe("COOLDOWN_EXPIRED");
      expect(result.cooldownEndsAt).toBe("2026-01-01T10:00:00.000Z");
    });

    it("keeps the legacy reason text while active", () => {
      vi.setSystemTime(new Date(LAST_RUN + 42 * 60 * 1000));
      const result = CircuitBreakers.checkCooldownPeriod(new Date(LAST_RUN).toISOString(), 1);
      expect(result.safe).toBe(false);
      expect(result.reason).toBe("Cooldown active: 0.3 hours remaining");
      expect(result.outcome).toBe("delayed");
      expect(result.remainingMs).toBe(18 * 60 * 1000);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #2063 – Actionable cooldown outcomes for concurrent requests at the instant
// ─────────────────────────────────────────────────────────────────────────────

describe("cooldown gate for concurrent requests (SPR-2026-139)", () => {
  let gate: CooldownGate;
  const persisted = new Date(LAST_RUN).toISOString();

  beforeEach(() => {
    gate = new CooldownGate();
  });

  it("permits exactly one of several requests crossing the expiry instant", () => {
    const results = ["scheduler", "force", "manual"].map((source) =>
      gate.tryClaim({ portfolioId: "p1", source, lastRebalance: persisted, minCooldownHours: 1, nowMs: EXPIRY }),
    );

    const winners = results.filter((r) => r.claimed);
    const losers = results.filter((r) => !r.claimed);
    expect(winners).toHaveLength(1);
    expect(winners[0].outcome).toBe("allowed");
    expect(winners[0].recordedLastRunAt).toBe(new Date(EXPIRY).toISOString());

    expect(losers).toHaveLength(2);
    for (const loser of losers) {
      expect(loser.outcome).toBe("delayed");
      expect(loser.reasonCode).toBe("COOLDOWN_ALREADY_CLAIMED");
      expect(loser.context.claimedBySource).toBe("scheduler");
      expect(loser.context.persistedLastRunAt).toBe(persisted);
      expect(loser.cooldownEndsAt).toBe(new Date(EXPIRY + HOUR).toISOString());
    }
  });

  it("keeps portfolios independent", () => {
    const a = gate.tryClaim({ portfolioId: "a", source: "s", lastRebalance: persisted, minCooldownHours: 1, nowMs: EXPIRY });
    const b = gate.tryClaim({ portfolioId: "b", source: "s", lastRebalance: persisted, minCooldownHours: 1, nowMs: EXPIRY });
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(true);
  });

  it("frees the window when the winning work is released before it ran", () => {
    const first = gate.tryClaim({ portfolioId: "p1", source: "s", lastRebalance: persisted, minCooldownHours: 1, nowMs: EXPIRY });
    expect(gate.release("p1", "wrong-token")).toBe(false);
    expect(gate.release("p1", first.claimToken)).toBe(true);

    const retry = gate.tryClaim({ portfolioId: "p1", source: "s", lastRebalance: persisted, minCooldownHours: 1, nowMs: EXPIRY });
    expect(retry.claimed).toBe(true);
  });

  it("falls back to the persisted last run once it is newer than the claim", () => {
    gate.tryClaim({ portfolioId: "p1", source: "s", lastRebalance: persisted, minCooldownHours: 1, nowMs: EXPIRY });
    const newerPersisted = new Date(EXPIRY + 10).toISOString();
    const r = gate.tryClaim({ portfolioId: "p1", source: "s", lastRebalance: newerPersisted, minCooldownHours: 1, nowMs: EXPIRY + 20 });
    expect(r.claimed).toBe(false);
    expect(r.reasonCode).toBe("COOLDOWN_ACTIVE");
  });

  it("permits the next window after the claimed cooldown expires", () => {
    gate.tryClaim({ portfolioId: "p1", source: "s", lastRebalance: persisted, minCooldownHours: 1, nowMs: EXPIRY });
    const next = gate.tryClaim({ portfolioId: "p1", source: "s", lastRebalance: persisted, minCooldownHours: 1, nowMs: EXPIRY + HOUR });
    expect(next.claimed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared outcome emission (#2058, #2063, #2068)
// ─────────────────────────────────────────────────────────────────────────────

describe("emitGuardrailOutcome", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const base: GuardrailOutcome = {
    guardrail: "cooldown",
    source: "test",
    outcome: "allowed",
    reasonCode: "COOLDOWN_EXPIRED",
    reason: "ok",
    portfolioId: "p1",
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    context: { remainingMs: 0 },
  };

  it("logs allowed at debug, delayed at info and blocked at warn", () => {
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => logger);
    const info = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    emitGuardrailOutcome(base);
    emitGuardrailOutcome({ ...base, outcome: "delayed" });
    emitGuardrailOutcome({ ...base, outcome: "blocked" });

    expect(debug).toHaveBeenCalledWith("[GUARDRAIL] cooldown allowed", expect.objectContaining({ outcome: "allowed" }));
    expect(info).toHaveBeenCalledWith("[GUARDRAIL] cooldown delayed", expect.objectContaining({ outcome: "delayed" }));
    expect(warn).toHaveBeenCalledWith(
      "[GUARDRAIL] cooldown blocked",
      expect.objectContaining({ guardrail: "cooldown", source: "test", reasonCode: "COOLDOWN_EXPIRED", portfolioId: "p1", remainingMs: 0 }),
    );
  });

  it("never throws even if the logger does", () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {
      throw new Error("sink down");
    });
    expect(() => emitGuardrailOutcome({ ...base, outcome: "blocked" })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #2058 – Circuit breaker: stale prices while execution is queued
// ─────────────────────────────────────────────────────────────────────────────

describe("circuit breaker outcomes for queued executions (SPR-2026-134)", () => {
  const observedAt = Date.parse("2026-01-01T12:00:00.000Z");

  it("allows execution while the enqueued snapshot is still fresh", () => {
    const r = evaluateQueuedPriceFreshness({
      source: "rebalance_worker",
      portfolioId: "p1",
      pricesObservedAtMs: observedAt,
      enqueuedAtMs: observedAt + 1_000,
      nowMs: observedAt + MAX_PRICE_AGE_MS,
    });
    expect(r.outcome).toBe("allowed");
    expect(r.reasonCode).toBe("QUEUED_PRICES_FRESH");
  });

  it("delays execution when prices went stale while the job was queued", () => {
    const r = evaluateQueuedPriceFreshness({
      source: "rebalance_worker",
      portfolioId: "p1",
      pricesObservedAtMs: observedAt,
      enqueuedAtMs: observedAt + 1_000,
      nowMs: observedAt + MAX_PRICE_AGE_MS + 1,
    });
    expect(r.guardrail).toBe("circuit_breaker");
    expect(r.outcome).toBe("delayed");
    expect(r.reasonCode).toBe("STALE_PRICES_WHILE_QUEUED");
    expect(r.context).toMatchObject({
      pricesObservedAt: "2026-01-01T12:00:00.000Z",
      enqueuedAt: "2026-01-01T12:00:01.000Z",
      priceAgeMs: MAX_PRICE_AGE_MS + 1,
      queuedForMs: MAX_PRICE_AGE_MS + 1 - 1_000,
      maxAgeMs: MAX_PRICE_AGE_MS,
    });
  });

  it("finds the oldest price timestamp, normalising seconds to milliseconds", () => {
    expect(
      oldestPriceTimestampMs({
        XLM: { timestamp: 1_767_268_800 }, // seconds
        USDC: { timestamp: 1_767_268_700_000 }, // ms, older
        BAD: { timestamp: Number.NaN },
        NONE: {},
      }),
    ).toBe(1_767_268_700_000);
    expect(oldestPriceTimestampMs({})).toBeUndefined();
  });

  describe("CircuitBreakers.checkMarketConditions", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(observedAt));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("classifies stale data as delayed with diagnostic context", () => {
      const ts = observedAt / 1000 - 11 * 60;
      const r = CircuitBreakers.checkMarketConditions({ XLM: { change: 0, timestamp: ts, source: "reflector" } });
      expect(r.safe).toBe(false);
      expect(r.outcome).toBe("delayed");
      expect(r.reasonCode).toBe("STALE_PRICE_DATA");
      expect(r.context).toMatchObject({ asset: "XLM", ageSeconds: 660, maxAgeSeconds: 600, priceSource: "reflector" });
    });

    it("classifies volatility and correlation trips as delayed", () => {
      const now = observedAt / 1000;
      expect(CircuitBreakers.checkMarketConditions({ BTC: { change: 30, timestamp: now } })).toMatchObject({
        safe: false,
        outcome: "delayed",
        reasonCode: "HIGH_VOLATILITY",
      });
      expect(
        CircuitBreakers.checkMarketConditions({
          A: { change: 6, timestamp: now },
          B: { change: 7, timestamp: now },
          C: { change: 8, timestamp: now },
        }),
      ).toMatchObject({ safe: false, outcome: "delayed", reasonCode: "CORRELATION_BREAKDOWN" });
    });

    it("reports success explicitly", () => {
      expect(CircuitBreakers.checkMarketConditions({ XLM: { change: 1, timestamp: observedAt / 1000 } })).toMatchObject({
        safe: true,
        outcome: "allowed",
        reasonCode: "MARKET_OK",
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #2068 – Concentration limit: partial fills
// ─────────────────────────────────────────────────────────────────────────────

describe("concentration limit outcomes (SPR-2026-144)", () => {
  it("allows holdings that stay within the cap", () => {
    const r = evaluatePartialFillConcentration({
      source: "test",
      holdingsUsd: { XLM: 600, USDC: 400 },
      plannedLegs: 2,
      filledLegs: 1,
    });
    expect(r.outcome).toBe("allowed");
    expect(r.reasonCode).toBe("CONCENTRATION_WITHIN_CAP");
  });

  it("allows a weight exactly at the cap", () => {
    const r = evaluatePartialFillConcentration({ source: "test", holdingsUsd: { XLM: 800, USDC: 200 }, plannedLegs: 2, filledLegs: 2 });
    expect(r.outcome).toBe("allowed");
  });

  it("delays when a partial fill pushes the remaining weight over the cap", () => {
    const r = evaluatePartialFillConcentration({
      source: "rebalance_worker",
      portfolioId: "p1",
      holdingsUsd: { XLM: 850, USDC: 150 },
      plannedLegs: 3,
      filledLegs: 1,
    });
    expect(r.guardrail).toBe("concentration_limit");
    expect(r.outcome).toBe("delayed");
    expect(r.reasonCode).toBe("CONCENTRATION_PARTIAL_FILL_OVER_CAP");
    expect(r.context).toEqual({
      asset: "XLM",
      weightPct: 85,
      capPct: 80,
      overByPct: 5,
      totalValueUsd: 1000,
      assetCount: 2,
      plannedLegs: 3,
      filledLegs: 1,
      pendingLegs: 2,
      partialFill: true,
    });
    expect(r.reason).toContain("1/3 legs");
  });

  it("blocks when every leg filled and the weight is still over the cap", () => {
    const r = evaluatePartialFillConcentration({ source: "test", holdingsUsd: { XLM: 900, USDC: 100 }, plannedLegs: 2, filledLegs: 2 });
    expect(r.outcome).toBe("blocked");
    expect(r.reasonCode).toBe("CONCENTRATION_OVER_CAP");
    expect(r.context.pendingLegs).toBe(0);
  });

  it("honours a custom cap and ignores non-positive holdings", () => {
    const r = evaluatePartialFillConcentration({
      source: "test",
      holdingsUsd: { XLM: 700, USDC: 300, DUST: 0, NEG: -5 },
      plannedLegs: 1,
      filledLegs: 1,
      capPct: 60,
    });
    expect(r.outcome).toBe("blocked");
    expect(r.context.assetCount).toBe(2);
  });

  it("classifies a target allocation over the cap as blocked", () => {
    const r = CircuitBreakers.checkConcentrationRisk({ BTC: 85, ETH: 15 });
    expect(r).toMatchObject({
      safe: false,
      outcome: "blocked",
      reasonCode: "CONCENTRATION_OVER_CAP",
      context: { asset: "BTC", weightPct: 85, capPct: 80 },
    });
    expect(CircuitBreakers.checkConcentrationRisk({ BTC: 50, ETH: 50 })).toMatchObject({
      safe: true,
      outcome: "allowed",
    });
  });
});
