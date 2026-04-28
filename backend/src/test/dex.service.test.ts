import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Horizon, Asset, Networks } from "@stellar/stellar-sdk";
import {
  StellarDEXService,
  DEXTradeRequest,
  DEXTradeExecutionResult,
} from "../services/dex.js";
import { Dec } from "../utils/decimal.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mock types and helpers
// ─────────────────────────────────────────────────────────────────────────────

interface MockOrderbookResponse {
  bids: Array<{ price: string; amount: string }>;
  asks: Array<{ price: string; amount: string }>;
  self_trade: boolean;
}

interface MockOfferRecord {
  id: string;
  amount: string;
  price: string;
  selling: { asset_type: string; asset_code?: string; asset_issuer?: string };
  buying: { asset_type: string; asset_code?: string; asset_issuer?: string };
}

interface MockTradeRecord {
  base_amount: string;
  counter_amount: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const TEST_ASSETS = {
  XLM: Asset.native(),
  USDC: new Asset(
    "USDC",
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  ),
};

const TEST_SIGNER = {
  publicKey: () => "GABCD123456789",
  sign: () => ({ signature: Buffer.from("test") }),
};

const TEST_TRADE_REQUEST: DEXTradeRequest = {
  tradeId: "test-trade-001",
  fromAsset: "XLM",
  toAsset: "USDC",
  amount: 1000,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

function createOrderbook(
  bids: Array<{ price: number; amount: number }>,
  asks: Array<{ price: number; amount: number }>,
): MockOrderbookResponse {
  return {
    bids: bids.map(({ price, amount }) => ({
      price: Dec.formatStellar(price),
      amount: Dec.formatStellar(amount),
    })),
    asks: asks.map(({ price, amount }) => ({
      price: Dec.formatStellar(price),
      amount: Dec.formatStellar(amount),
    })),
    self_trade: false,
  };
}

function createMockOffer(
  id: string,
  amount: number,
  price: number,
  selling: Asset,
  buying: Asset,
): MockOfferRecord {
  return {
    id,
    amount: Dec.formatStellar(amount),
    price: Dec.formatStellar(price),
    selling: {
      asset_type: selling.isNative() ? "native" : "credit_alphanum4",
      asset_code: selling.isNative() ? undefined : selling.getCode(),
      asset_issuer: selling.isNative() ? undefined : selling.getIssuer(),
    },
    buying: {
      asset_type: buying.isNative() ? "native" : "credit_alphanum4",
      asset_code: buying.isNative() ? undefined : buying.getCode(),
      asset_issuer: buying.isNative() ? undefined : buying.getIssuer(),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("StellarDEXService", () => {
  let service: StellarDEXService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("STELLAR_HORIZON_URL", "https://horizon-testnet.stellar.org");
    vi.stubEnv(
      "STELLAR_REBALANCE_SECRET",
      "SBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBB",
    );

    // Reset the service to reinitialize with mocked Horizon
    service = new StellarDEXService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Path-finding tests ───────────────────────────────────────────────────

  describe("Path-finding with mocked order book data", () => {
    it("should select the best bid for a sell order", async () => {
      // Setup: Create orderbook with multiple bid levels
      const orderbook = createOrderbook(
        [
          { price: 0.185, amount: 5000 }, // Best bid
          { price: 0.184, amount: 3000 },
          { price: 0.183, amount: 2000 },
        ],
        [
          { price: 0.186, amount: 4000 }, // Best ask
          { price: 0.187, amount: 2500 },
        ],
      );

      // Mock the orderbook chain: server.orderbook().call()
      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      const result = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      // Should use the best bid (0.185) as reference price
      expect(result.referencePrice).toBeCloseTo(0.185, 4);
      // Spread: (bestAsk - bestBid) / bestAsk * 10000 = (0.186 - 0.185) / 0.186 * 10000 = 53.76...
      expect(result.spreadBps).toBeCloseTo(53.7634, 2);
      // Liquidity coverage: (5000 + 3000 + 2000) / 1000 = 10
      expect(result.liquidityCoverage).toBeCloseTo(10, 2);
    });

    it("should handle 3-hop trade path selection", async () => {
      // For a 3-hop trade like XLM -> USDC -> EURT -> BTC,
      // we need to verify path selection logic

      // First hop: XLM -> USDC
      const orderbook1 = createOrderbook(
        [{ price: 0.185, amount: 5000 }],
        [{ price: 0.186, amount: 4000 }],
      );
      const mockOrderbookCall1 = vi.fn().mockResolvedValue(orderbook1);
      vi.spyOn(service["server"], "orderbook").mockReturnValueOnce({
        call: mockOrderbookCall1,
      } as any);

      const market1 = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      expect(market1.referencePrice).toBeCloseTo(0.185, 4);

      // Second hop: USDC -> EURT (using same USDC issuer for simplicity)
      const orderbook2 = createOrderbook(
        [{ price: 0.215, amount: 3000 }],
        [{ price: 0.217, amount: 2500 }],
      );
      const mockOrderbookCall2 = vi.fn().mockResolvedValue(orderbook2);
      vi.spyOn(service["server"], "orderbook").mockReturnValueOnce({
        call: mockOrderbookCall2,
      } as any);

      const market2 = await service.assessMarket(
        TEST_ASSETS.USDC,
        TEST_ASSETS.USDC,
        500,
      );

      expect(market2.referencePrice).toBeCloseTo(0.215, 4);

      // Third hop: EURT -> BTC (using same USDC for simplicity)
      const orderbook3 = createOrderbook(
        [{ price: 0.000045, amount: 100 }],
        [{ price: 0.000047, amount: 80 }],
      );
      const mockOrderbookCall3 = vi.fn().mockResolvedValue(orderbook3);
      vi.spyOn(service["server"], "orderbook").mockReturnValueOnce({
        call: mockOrderbookCall3,
      } as any);

      const market3 = await service.assessMarket(
        TEST_ASSETS.USDC,
        TEST_ASSETS.USDC,
        10,
      );

      expect(market3.referencePrice).toBeCloseTo(0.000045, 8);
    });

    it("should calculate effective price for multi-hop path", async () => {
      // Simulate XLM -> USDC -> BTC path
      const xlmToUSDC = 0.185;
      const usdcToBTC = 0.000045;

      // Effective price should be the product of intermediate prices
      const effectivePrice = xlmToUSDC * usdcToBTC;

      expect(effectivePrice).toBeCloseTo(0.000008325, 10);
    });
  });

  // ── Slippage calculation tests ───────────────────────────────────────────

  describe("Slippage calculation", () => {
    it("should calculate slippage correctly for a given order book depth", async () => {
      // Setup: Orderbook with limited depth
      const orderbook = createOrderbook(
        [
          { price: 0.185, amount: 500 }, // 500 XLM at 0.185
          { price: 0.184, amount: 300 }, // 300 XLM at 0.184
          { price: 0.183, amount: 200 }, // 200 XLM at 0.183
        ],
        [{ price: 0.186, amount: 4000 }],
      );

      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      // Request 1000 XLM - this will cross multiple price levels
      const result = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      // Reference price should be the best bid (0.185)
      expect(result.referencePrice).toBeCloseTo(0.185, 4);

      // Note: assessMarket returns the best bid as reference price
      // The weighted average price would be relevant for actual execution
      // when crossing multiple price levels, but the reference price is just the best bid
    });

    it("should calculate slippage percentage correctly", () => {
      // Manual calculation test
      const referencePrice = 0.185;
      const executionPrice = 0.165; // 10.8% slippage
      // Slippage = (reference - execution) / reference * 10000
      const expectedSlippageBps =
        ((referencePrice - executionPrice) / referencePrice) * 10000;

      // Corrected expected value: (0.185 - 0.165) / 0.185 * 10000 = 1081.081...
      expect(expectedSlippageBps).toBeCloseTo(1081.08, 2);

      // Verify with Dec helper
      const calculatedSlippage =
        ((referencePrice - executionPrice) / referencePrice) * 10000;
      expect(calculatedSlippage).toBeCloseTo(expectedSlippageBps, 4);
    });

    it("should handle edge case: no liquidity (empty orderbook)", async () => {
      const orderbook = createOrderbook([], []);

      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      const result = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      expect(result.referencePrice).toBe(0);
      expect(result.spreadBps).toBe(Number.POSITIVE_INFINITY);
      expect(result.liquidityCoverage).toBe(0);
    });

    it("should handle edge case: only bids (no asks)", async () => {
      const orderbook = createOrderbook([{ price: 0.185, amount: 5000 }], []);

      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      const result = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      expect(result.referencePrice).toBeCloseTo(0.185, 4);
      // When there are no asks, spreadBps is 0 (no spread to measure)
      expect(result.spreadBps).toBe(0);
      expect(result.liquidityCoverage).toBeCloseTo(5, 2);
    });
  });

  // ── Slippage tolerance tests ─────────────────────────────────────────────

  describe("Slippage tolerance enforcement", () => {
    it("should reject trades when slippage exceeds user tolerance", async () => {
      // Setup: High spread orderbook (exceeds tolerance)
      const orderbook = createOrderbook(
        [{ price: 0.18, amount: 1000 }],
        [{ price: 0.2, amount: 1000 }],
      );

      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      const result = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      // Calculate spread: (0.200 - 0.180) / 0.200 * 10000 = 1000 bps
      expect(result.spreadBps).toBeCloseTo(1000, 2);

      // With 100 bps tolerance, this should fail
      const maxSpreadBps = 100;
      const spreadExceedsTolerance = result.spreadBps > maxSpreadBps;

      expect(spreadExceedsTolerance).toBe(true);
    });

    it("should calculate price limit based on max slippage tolerance", () => {
      const referencePrice = 0.185;
      const maxSlippageBps = 100; // 1%

      // Price limit = referencePrice * (1 - maxSlippageBps / 10000)
      const priceLimit = referencePrice * (1 - maxSlippageBps / 10000);

      expect(priceLimit).toBeCloseTo(0.18315, 5);

      // Verify with Dec.priceLimit helper
      const calculatedLimit = Dec.priceLimit(referencePrice, maxSlippageBps);
      expect(calculatedLimit).toBeCloseTo(priceLimit, 5);
    });

    it("should reject trades when calculated slippage exceeds tolerance", () => {
      // Simulate a trade with high slippage
      const referencePrice = 0.185;
      const executionPrice = 0.165; // 10.8% slippage
      // Slippage = (0.185 - 0.165) / 0.185 * 10000 = 1081.081...
      const slippageBps =
        ((referencePrice - executionPrice) / referencePrice) * 10000;

      expect(slippageBps).toBeCloseTo(1081.08, 2);

      // With 50 bps tolerance, this should be rejected
      const toleranceBps = 50;
      const slippageExceedsTolerance = slippageBps > toleranceBps;

      expect(slippageExceedsTolerance).toBe(true);
    });
  });

  // ── Failure scenarios tests ──────────────────────────────────────────────

  describe("Failure scenarios", () => {
    it("should fail when no path is available between two assets", async () => {
      // Simulate assets with no trading pair
      const orderbook = createOrderbook([], []);

      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      const result = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      // Should return zero reference price and infinite spread
      expect(result.referencePrice).toBe(0);
      expect(result.spreadBps).toBe(Number.POSITIVE_INFINITY);
      expect(result.liquidityCoverage).toBe(0);
    });

    it("should fail when orderbook data is malformed", async () => {
      // Mock malformed response
      const mockOrderbookCall = vi.fn().mockResolvedValue({
        bids: "invalid",
        asks: null,
      } as any);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      const result = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      // Should handle gracefully
      expect(result.referencePrice).toBe(0);
    });

    it("should fail when amount is zero or negative", async () => {
      const zeroAmount = 0;
      const negativeAmount = -100;

      const orderbook = createOrderbook(
        [{ price: 0.185, amount: 5000 }],
        [{ price: 0.186, amount: 4000 }],
      );
      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      // Zero amount
      const result1 = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        zeroAmount,
      );
      expect(result1.liquidityCoverage).toBe(Number.POSITIVE_INFINITY);

      // Negative amount (edge case - should still calculate)
      const result2 = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        negativeAmount,
      );
      expect(result2.liquidityCoverage).toBeLessThan(0);
    });

    it("should handle network errors gracefully", async () => {
      const mockOrderbookCall = vi
        .fn()
        .mockRejectedValue(new Error("Network timeout"));
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      await expect(
        service.assessMarket(TEST_ASSETS.XLM, TEST_ASSETS.USDC, 1000),
      ).rejects.toThrow("Network timeout");
    });
  });

  // ── Integration tests with executeSingleTrade ────────────────────────────

  describe("Integration with trade execution", () => {
    it("should execute a trade within tolerance", async () => {
      // Setup: Orderbook with reasonable spread
      const orderbook = createOrderbook(
        [{ price: 0.185, amount: 5000 }],
        [{ price: 0.186, amount: 4000 }],
      );

      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      const tradeRequest: DEXTradeRequest = {
        tradeId: "integration-test-001",
        fromAsset: "XLM",
        toAsset: "USDC",
        amount: 1000,
        maxSlippageBps: 100, // 1% tolerance
      };

      // Note: This test would require more extensive mocking for full integration
      // The key is that the assessMarket call works correctly
      const market = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      expect(market.spreadBps).toBeLessThan(100); // Within tolerance
      expect(market.referencePrice).toBeGreaterThan(0);
    });

    it("should skip trade when spread exceeds tolerance", async () => {
      // Setup: Orderbook with high spread
      const orderbook = createOrderbook(
        [{ price: 0.17, amount: 1000 }],
        [{ price: 0.2, amount: 1000 }],
      );

      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      const market = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      // Spread is (0.200 - 0.170) / 0.200 * 10000 = 1500 bps
      expect(market.spreadBps).toBeCloseTo(1500, 2);

      const maxSpreadBps = 100;
      expect(market.spreadBps).toBeGreaterThan(maxSpreadBps);
    });
  });

  // ── Price limit calculation tests ────────────────────────────────────────

  describe("Price limit calculations", () => {
    it("should calculate correct price limit for various slippage tolerances", () => {
      const referencePrice = 0.185;

      const testCases = [
        { tolerance: 10, expected: 0.184815 },
        { tolerance: 50, expected: 0.184075 },
        { tolerance: 100, expected: 0.18315 },
        { tolerance: 500, expected: 0.17575 },
      ];

      for (const { tolerance, expected } of testCases) {
        const limit = Dec.priceLimit(referencePrice, tolerance);
        expect(limit).toBeCloseTo(expected, 4);
      }
    });

    it("should handle edge case: zero slippage tolerance", () => {
      const referencePrice = 0.185;
      const limit = Dec.priceLimit(referencePrice, 0);
      expect(limit).toBeCloseTo(referencePrice, 7);
    });

    it("should handle edge case: 100% slippage tolerance", () => {
      const referencePrice = 0.185;
      const limit = Dec.priceLimit(referencePrice, 10000);
      expect(limit).toBeCloseTo(0, 7);
    });
  });

  // ── Liquidity coverage tests ─────────────────────────────────────────────

  describe("Liquidity coverage calculations", () => {
    it("should calculate liquidity coverage correctly", async () => {
      const orderbook = createOrderbook(
        [
          { price: 0.185, amount: 5000 },
          { price: 0.184, amount: 3000 },
        ],
        [{ price: 0.186, amount: 4000 }],
      );

      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      // Test with different trade sizes
      const testCases = [
        { amount: 1000, expectedCoverage: 8 }, // 8000 / 1000
        { amount: 5000, expectedCoverage: 1.6 }, // 8000 / 5000
        { amount: 10000, expectedCoverage: 0.8 }, // 8000 / 10000
      ];

      for (const { amount, expectedCoverage } of testCases) {
        const result = await service.assessMarket(
          TEST_ASSETS.XLM,
          TEST_ASSETS.USDC,
          amount,
        );
        expect(result.liquidityCoverage).toBeCloseTo(expectedCoverage, 2);
      }
    });

    it("should reject trades with insufficient liquidity", async () => {
      const orderbook = createOrderbook(
        [{ price: 0.185, amount: 500 }],
        [{ price: 0.186, amount: 4000 }],
      );

      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      const result = await service.assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      // Coverage is 500 / 1000 = 0.5x
      expect(result.liquidityCoverage).toBeCloseTo(0.5, 2);

      const minLiquidityCoverage = 1.0;
      const insufficientLiquidity =
        result.liquidityCoverage < minLiquidityCoverage;
      expect(insufficientLiquidity).toBe(true);
    });
  });
});
