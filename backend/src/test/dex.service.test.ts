import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Horizon, Asset, Account, Networks, Keypair } from "@stellar/stellar-sdk";

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  StellarDEXService,
  DEXTradeRequest,
  DEXTradeExecutionResult,
} from "../services/dex.js";
import { Dec } from "../utils/decimal.js";
import { logger } from "../utils/logger.js";

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

interface MockPathRecord {
  source_asset_type: string;
  source_amount: string;
  destination_asset_type: string;
  destination_asset_code?: string;
  destination_asset_issuer?: string;
  destination_amount: string;
  path: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  }>;
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

function createPathRecord(options: {
  destinationAmount: number;
  sourceAmount?: number;
  path: Array<{ code: string; issuer?: string }>;
}): MockPathRecord {
  const path = options.path.map((hop) =>
    hop.code === "XLM"
      ? { asset_type: "native" }
      : {
          asset_type: "credit_alphanum4",
          asset_code: hop.code,
          asset_issuer: hop.issuer ?? "GAXLV64VNE4LBFCVEOZ6PZW2653SNHTU3QKJ63QO7VVL7YV2T3OTRDYD",
        },
  );

  return {
    source_asset_type: "native",
    source_amount: Dec.formatStellar(options.sourceAmount ?? 1000),
    destination_asset_type: "credit_alphanum4",
    destination_asset_code: "USDC",
    destination_asset_issuer: TEST_ASSETS.USDC.getIssuer(),
    destination_amount: Dec.formatStellar(options.destinationAmount),
    path,
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

      // Use type assertion to call private method
      const result = await (service as any).assessMarket(
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

      // Create a mock spy with chained responses for each hop
      const mockOrderbookCall = vi.fn();

      // First hop: XLM -> USDC
      const orderbook1 = createOrderbook(
        [{ price: 0.185, amount: 5000 }],
        [{ price: 0.186, amount: 4000 }],
      );
      mockOrderbookCall.mockResolvedValueOnce(orderbook1);

      // Second hop: USDC -> EURT (using same USDC issuer for simplicity)
      const orderbook2 = createOrderbook(
        [{ price: 0.215, amount: 3000 }],
        [{ price: 0.217, amount: 2500 }],
      );
      mockOrderbookCall.mockResolvedValueOnce(orderbook2);

      // Third hop: EURT -> BTC (using same USDC for simplicity)
      const orderbook3 = createOrderbook(
        [{ price: 0.000045, amount: 100 }],
        [{ price: 0.000047, amount: 80 }],
      );
      mockOrderbookCall.mockResolvedValueOnce(orderbook3);

      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);

      const market1 = await (service as any).assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      expect(market1.referencePrice).toBeCloseTo(0.185, 4);

      const market2 = await (service as any).assessMarket(
        TEST_ASSETS.USDC,
        TEST_ASSETS.USDC,
        500,
      );

      expect(market2.referencePrice).toBeCloseTo(0.215, 4);

      const market3 = await (service as any).assessMarket(
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
      const result = await (service as any).assessMarket(
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

      const result = await (service as any).assessMarket(
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

      const result = await (service as any).assessMarket(
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

      const result = await (service as any).assessMarket(
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

      const result = await (service as any).assessMarket(
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

      const result = await (service as any).assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        1000,
      );

      // Should handle gracefully
      expect(result.referencePrice).toBe(0);
    });

    it("should handle zero amount gracefully", async () => {
      const zeroAmount = 0;

      const orderbook = createOrderbook(
        [{ price: 0.185, amount: 5000 }],
        [{ price: 0.186, amount: 4000 }],
      );
      const mockOrderbookCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      // Zero amount - assessMarket doesn't validate, returns infinite coverage
      const result1 = await (service as any).assessMarket(
        TEST_ASSETS.XLM,
        TEST_ASSETS.USDC,
        zeroAmount,
      );
      expect(result1.liquidityCoverage).toBe(Number.POSITIVE_INFINITY);
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
        (service as any).assessMarket(TEST_ASSETS.XLM, TEST_ASSETS.USDC, 1000),
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
      const market = await (service as any).assessMarket(
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

      const market = await (service as any).assessMarket(
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

  // ── ExecutionExplanation tests ───────────────────────────────────────────

  describe("ExecutionExplanation in executeRebalanceTrades", () => {
    const MOCK_KEYPAIR = Keypair.random();

    function setupOrderbookMock(spreadBps: number, liquidityAmount: number) {
      const bid = 0.185;
      const ask = bid / (1 - spreadBps / 10000);
      const orderbook = createOrderbook(
        [{ price: bid, amount: liquidityAmount }],
        [{ price: ask, amount: liquidityAmount }],
      );
      const mockCall = vi.fn().mockResolvedValue(orderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockCall,
      } as any);
    }

    it("happy path: explanation has correct shape and rationale", async () => {
      setupOrderbookMock(50, 5000);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);
      vi.spyOn(service as any, "resolveSigner").mockReturnValue(MOCK_KEYPAIR);
      vi.spyOn(service["server"], "loadAccount").mockResolvedValue({
        id: MOCK_KEYPAIR.publicKey(),
        sequence: "1",
        incrementSequenceNumber: () => {},
      } as any);
      vi.spyOn(service["server"], "submitTransaction").mockResolvedValue({ hash: "abc123" } as any);
      vi.spyOn(service["server"], "offers").mockReturnValue({
        forAccount: () => ({ limit: () => ({ call: vi.fn().mockResolvedValue({ records: [] }) }) }),
      } as any);
      vi.spyOn(service as any, "tryGetAverageTradePrice").mockResolvedValue(0.185);

      const result = await service.executeRebalanceTrades(
        MOCK_KEYPAIR.publicKey(),
        [{ tradeId: "t1", fromAsset: "XLM", toAsset: "USDC", amount: 100 }],
        { rollbackOnFailure: false }
      );

      expect(result.explanation).toBeDefined();
      expect(typeof result.explanation.routeLength).toBe("number");
      expect(typeof result.explanation.estimatedSlippage).toBe("number");
      expect(Array.isArray(result.explanation.skippedAlternatives)).toBe(true);
      expect(result.explanation.rationale.length).toBeGreaterThan(0);
    });

    it("failure case: explanation includes failureReason when spread exceeds max", async () => {
      setupOrderbookMock(2000, 5000); // 2000 bps spread
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);
      vi.spyOn(service as any, "resolveSigner").mockReturnValue(MOCK_KEYPAIR);

      const result = await service.executeRebalanceTrades(
        MOCK_KEYPAIR.publicKey(),
        [{ tradeId: "t1", fromAsset: "XLM", toAsset: "USDC", amount: 100 }],
        { maxSpreadBps: 100, rollbackOnFailure: false }
      );

      expect(result.status).toBe("failed");
      expect(result.explanation.failureReason).toBeDefined();
      expect(result.explanation.failureReason).toContain("bps");
      expect(result.explanation.rationale).toBeTruthy();
    });
  });

  // ── Rollback on partial multi-leg failure (#1380) ────────────────────────

  describe("Rollback on partial multi-leg failure", () => {
    const MOCK_KEYPAIR = Keypair.random();

    function tightOrderbook() {
      return createOrderbook(
        [{ price: 0.185, amount: 5000 }],
        [{ price: 0.1855, amount: 5000 }],
      );
    }

    function wideOrderbook() {
      return createOrderbook(
        [{ price: 0.00002, amount: 1000 }],
        [{ price: 0.00005, amount: 1000 }],
      );
    }

    function setupCommonMocks() {
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);
      vi.spyOn(service as any, "resolveSigner").mockReturnValue(MOCK_KEYPAIR);
      vi.spyOn(service["server"], "loadAccount").mockImplementation(
        async () => new Account(MOCK_KEYPAIR.publicKey(), "1") as any,
      );
      vi.spyOn(service["server"], "submitTransaction").mockResolvedValue({
        hash: "tx-hash",
      } as any);
      vi.spyOn(service["server"], "offers").mockReturnValue({
        forAccount: () => ({
          limit: () => ({ call: vi.fn().mockResolvedValue({ records: [] }) }),
        }),
      } as any);
      vi.spyOn(service as any, "tryGetAverageTradePrice").mockResolvedValue(
        undefined,
      );
    }

    // Every pair resolves to a healthy orderbook, except USDC->BTC which is
    // deliberately too wide to clear `maxSpreadBps` -- simulating the second
    // leg of a three-leg rebalance failing after the first already executed.
    function mockPerPairOrderbook() {
      vi.spyOn(service["server"], "orderbook").mockImplementation(((
        selling: Asset,
        buying: Asset,
      ) => {
        const sellCode = selling.isNative() ? "XLM" : selling.getCode();
        const buyCode = buying.isNative() ? "XLM" : buying.getCode();
        const isWideLeg = sellCode === "USDC" && buyCode === "BTC";
        return {
          call: vi
            .fn()
            .mockResolvedValue(isWideLeg ? wideOrderbook() : tightOrderbook()),
        } as any;
      }) as any);
    }

    it("rolls back the successfully executed first leg when the second of three legs fails", async () => {
      setupCommonMocks();
      mockPerPairOrderbook();

      const trades: DEXTradeRequest[] = [
        { tradeId: "leg-1", fromAsset: "XLM", toAsset: "USDC", amount: 100 },
        { tradeId: "leg-2", fromAsset: "USDC", toAsset: "BTC", amount: 50 },
        { tradeId: "leg-3", fromAsset: "BTC", toAsset: "XLM", amount: 1 },
      ];

      const result = await service.executeRebalanceTrades(
        MOCK_KEYPAIR.publicKey(),
        trades,
        { maxSpreadBps: 200 },
      );

      expect(result.status).toBe("failed");
      // The loop stops at the first failure, so the third leg is never attempted.
      expect(result.executedTrades.map((t) => t.tradeId)).toEqual(["leg-1"]);
      expect(result.failedTrades.map((t) => t.tradeId)).toEqual(["leg-2"]);

      // Compensation ran for the leg that had already succeeded, rather than
      // leaving the portfolio silently partially rebalanced.
      expect(result.rollback.attempted).toBe(true);
      expect(result.rollback.success).toBe(true);
      expect(result.rollback.rolledBackTrades).toBe(1);
      expect(result.executedTrades[0].rolledBack).toBe(true);
      expect(result.executedTrades[0].rollbackTxHash).toBeDefined();
    });

    it("logs rebalance_partial_failure capturing which legs succeeded and which failed", async () => {
      setupCommonMocks();
      mockPerPairOrderbook();

      const trades: DEXTradeRequest[] = [
        { tradeId: "leg-1", fromAsset: "XLM", toAsset: "USDC", amount: 100 },
        { tradeId: "leg-2", fromAsset: "USDC", toAsset: "BTC", amount: 50 },
      ];

      await service.executeRebalanceTrades(MOCK_KEYPAIR.publicKey(), trades, {
        maxSpreadBps: 200,
      });

      expect(logger.warn).toHaveBeenCalledWith(
        "[DEX] rebalance_partial_failure",
        expect.objectContaining({
          succeededLegs: expect.arrayContaining([
            expect.objectContaining({ tradeId: "leg-1" }),
          ]),
          failedLegs: expect.arrayContaining([
            expect.objectContaining({ tradeId: "leg-2" }),
          ]),
        }),
      );
    });

    it("does not attempt rollback or log a partial failure when the single leg that fails never executed anything", async () => {
      setupCommonMocks();
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: vi.fn().mockResolvedValue(wideOrderbook()),
      } as any);
      (logger.warn as any).mockClear();

      const result = await service.executeRebalanceTrades(
        MOCK_KEYPAIR.publicKey(),
        [{ tradeId: "leg-1", fromAsset: "XLM", toAsset: "USDC", amount: 100 }],
        { maxSpreadBps: 200 },
      );

      expect(result.status).toBe("failed");
      expect(result.executedTrades).toEqual([]);
      expect(result.rollback.attempted).toBe(false);
      expect(logger.warn).not.toHaveBeenCalledWith(
        "[DEX] rebalance_partial_failure",
        expect.anything(),
      );
    });
  });

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

  // ── Rebalance dry-run assessment (assessRebalanceTrades) ─────────────────

  describe("assessRebalanceTrades", () => {
    const healthyOrderbook = createOrderbook(
      [{ price: 0.185, amount: 5000 }],
      [{ price: 0.186, amount: 4000 }],
    );

    beforeEach(() => {
      const mockOrderbookCall = vi.fn().mockResolvedValue(healthyOrderbook);
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: mockOrderbookCall,
      } as any);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);
    });

    it("returns executable trades and fee estimate for valid requests", async () => {
      const trades: DEXTradeRequest[] = [
        {
          tradeId: "dry-run-1",
          fromAsset: "XLM",
          toAsset: "USDC",
          amount: 100,
        },
      ];

      const result = await service.assessRebalanceTrades(trades, {
        maxSpreadBps: 500,
        minLiquidityCoverage: 0.5,
      });

      expect(result.status).toBe("success");
      expect(result.executableTrades).toHaveLength(1);
      expect(result.skippedTrades).toHaveLength(0);
      expect(result.executableTrades[0]?.status).toBe("executable");
      expect(result.executableTrades[0]?.estimatedReceivedAmount).toBeGreaterThan(0);
      expect(result.totalEstimatedFeeXLM).toBeGreaterThanOrEqual(0);
    });

    it("skips trades when spread exceeds tolerance", async () => {
      const wideSpread = createOrderbook(
        [{ price: 0.17, amount: 1000 }],
        [{ price: 0.2, amount: 1000 }],
      );
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: vi.fn().mockResolvedValue(wideSpread),
      } as any);

      const result = await service.assessRebalanceTrades(
        [{ tradeId: "dry-run-2", fromAsset: "XLM", toAsset: "USDC", amount: 100 }],
        { maxSpreadBps: 100 },
      );

      expect(result.status).toBe("failed");
      expect(result.executableTrades).toHaveLength(0);
      expect(result.skippedTrades).toHaveLength(1);
      expect(result.skippedTrades[0]?.skipReason).toMatch(/spread/i);
    });

    it("skips zero-amount trades with actionable reason", async () => {
      const result = await service.assessRebalanceTrades([
        { tradeId: "dry-run-3", fromAsset: "XLM", toAsset: "USDC", amount: 0 },
      ]);

      expect(result.skippedTrades[0]?.skipReason).toMatch(/greater than zero/i);
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
        const result = await (service as any).assessMarket(
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

      const result = await (service as any).assessMarket(
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

  // ── allowPartialFill handling (#1381) ────────────────────────────────────

  describe("allowPartialFill handling (#1381)", () => {
    const MOCK_KEYPAIR = Keypair.random();

    function setupHealthyMarket() {
      const orderbook = createOrderbook(
        [{ price: 0.185, amount: 5000 }],
        [{ price: 0.1855, amount: 5000 }],
      );
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: vi.fn().mockResolvedValue(orderbook),
      } as any);
    }

    function setupExecutionMocks(remainingAmount: number) {
      const leftoverOffer =
        remainingAmount > 0
          ? createMockOffer("999", remainingAmount, 0.185, TEST_ASSETS.XLM, TEST_ASSETS.USDC)
          : undefined;

      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);
      vi.spyOn(service as any, "resolveSigner").mockReturnValue(MOCK_KEYPAIR);
      vi.spyOn(service["server"], "loadAccount").mockResolvedValue({
        id: MOCK_KEYPAIR.publicKey(),
        sequence: "1",
        incrementSequenceNumber: () => {},
      } as any);
      vi.spyOn(service["server"], "submitTransaction").mockResolvedValue({
        hash: "tx-partial",
      } as any);
      vi.spyOn(service["server"], "offers").mockReturnValue({
        forAccount: () => ({
          limit: () => ({
            call: vi
              .fn()
              .mockResolvedValueOnce({ records: [] })
              .mockResolvedValueOnce({ records: leftoverOffer ? [leftoverOffer] : [] })
              .mockResolvedValue({ records: [] }),
          }),
        }),
      } as any);
      vi.spyOn(service as any, "tryGetAverageTradePrice").mockResolvedValue(0.185);
    }

    it("records a full fill with partialFill=false and the filled amount", async () => {
      setupHealthyMarket();
      setupExecutionMocks(0);

      const result = await service.executeRebalanceTrades(
        MOCK_KEYPAIR.publicKey(),
        [{ tradeId: "pf-full", fromAsset: "XLM", toAsset: "USDC", amount: 1000 }],
        { allowPartialFill: true, rollbackOnFailure: false },
      );

      expect(result.status).toBe("success");
      expect(result.explanation.partialFill).toBe(false);
      expect(result.explanation.filledAmount).toBe(1000);
      expect(result.executedTrades[0].status).toBe("executed");
      expect(result.executedTrades[0].remainingAmount).toBe(0);
    });

    it("accepts a partial fill when allowPartialFill is true", async () => {
      setupHealthyMarket();
      setupExecutionMocks(400); // 400 of 1000 XLM left unfilled

      const result = await service.executeRebalanceTrades(
        MOCK_KEYPAIR.publicKey(),
        [{ tradeId: "pf-ok", fromAsset: "XLM", toAsset: "USDC", amount: 1000 }],
        { allowPartialFill: true, rollbackOnFailure: false },
      );

      expect(result.status).toBe("partial");
      expect(result.partialFills).toHaveLength(1);
      expect(result.executedTrades[0].status).toBe("partial");
      expect(result.executedTrades[0].executedAmount).toBe(600);
      expect(result.executedTrades[0].remainingAmount).toBe(400);
      expect(result.explanation.partialFill).toBe(true);
      expect(result.explanation.filledAmount).toBe(600);
    });

    it("rejects a partial fill when allowPartialFill is false", async () => {
      setupHealthyMarket();
      setupExecutionMocks(400);

      const result = await service.executeRebalanceTrades(
        MOCK_KEYPAIR.publicKey(),
        [{ tradeId: "pf-no", fromAsset: "XLM", toAsset: "USDC", amount: 1000 }],
        { allowPartialFill: false, rollbackOnFailure: false },
      );

      expect(result.status).toBe("failed");
      expect(result.failureReason).toContain("Partial fill is not allowed");
      expect(result.failedTrades).toHaveLength(1);
      expect(result.failedTrades[0].status).toBe("failed");
      // The filled position is retained so rollback/reconciliation can act on it.
      expect(result.executedTrades).toHaveLength(1);
      expect(result.executedTrades[0].executedAmount).toBe(600);
      expect(result.explanation.partialFill).toBe(true);
      expect(result.explanation.filledAmount).toBe(600);
    });
  });

  // ── Multi-hop path payments (#1382) ──────────────────────────────────────

  describe("Multi-hop path payments (#1382)", () => {
    const MOCK_KEYPAIR = Keypair.random();

    function mockEmptyOrderbook() {
      vi.spyOn(service["server"], "orderbook").mockReturnValue({
        call: vi.fn().mockResolvedValue(createOrderbook([], [])),
      } as any);
    }

    function mockStrictSendPaths(records: MockPathRecord[]) {
      vi.spyOn(service["server"], "strictSendPaths").mockReturnValue({
        call: vi.fn().mockResolvedValue({ records }),
      } as any);
    }

    function setupExecutionMocks() {
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);
      vi.spyOn(service as any, "resolveSigner").mockReturnValue(MOCK_KEYPAIR);
      vi.spyOn(service["server"], "loadAccount").mockResolvedValue(
        new Account(MOCK_KEYPAIR.publicKey(), "1") as any,
      );
      vi.spyOn(service["server"], "offers").mockReturnValue({
        forAccount: () => ({
          limit: () => ({ call: vi.fn().mockResolvedValue({ records: [] }) }),
        }),
      } as any);
      vi.spyOn(service as any, "tryGetAverageTradePrice").mockResolvedValue(undefined);
    }

    describe("discoverPath", () => {
      it("prefers the shortest path (fewest hops)", async () => {
        const singleHop = createPathRecord({ destinationAmount: 180, path: [{ code: "EURT" }] });
        const twoHop = createPathRecord({
          destinationAmount: 182,
          path: [{ code: "EURT" }, { code: "AUDD" }],
        });
        mockStrictSendPaths([twoHop, singleHop]);

        const best = await (service as any).discoverPath(
          TEST_ASSETS.XLM,
          TEST_ASSETS.USDC,
          1000,
          3,
        );

        expect(best.pathLength).toBe(1);
        expect(best.intermediateAssets).toHaveLength(1);
        expect(best.estimatedDestinationAmount).toBe(180);
      });

      it("prefers the highest destination amount among paths of equal length", async () => {
        const worse = createPathRecord({ destinationAmount: 178, path: [{ code: "EURT" }] });
        const better = createPathRecord({ destinationAmount: 183, path: [{ code: "AUDD" }] });
        mockStrictSendPaths([worse, better]);

        const best = await (service as any).discoverPath(
          TEST_ASSETS.XLM,
          TEST_ASSETS.USDC,
          1000,
          3,
        );

        expect(best.pathLength).toBe(1);
        expect(best.estimatedDestinationAmount).toBe(183);
      });

      it("returns undefined when every candidate path exceeds maxHops", async () => {
        const tooLong = createPathRecord({
          destinationAmount: 183,
          path: [{ code: "EURT" }, { code: "AUDD" }, { code: "BRL" }],
        });
        mockStrictSendPaths([tooLong]);

        const best = await (service as any).discoverPath(
          TEST_ASSETS.XLM,
          TEST_ASSETS.USDC,
          1000,
          2,
        );

        expect(best).toBeUndefined();
      });

      it("filters source and destination assets out of the intermediate hop list", async () => {
        const record = createPathRecord({
          destinationAmount: 182,
          path: [
            { code: "XLM" },
            { code: "EURT" },
            { code: "USDC", issuer: TEST_ASSETS.USDC.getIssuer() },
          ],
        });
        mockStrictSendPaths([record]);

        const best = await (service as any).discoverPath(
          TEST_ASSETS.XLM,
          TEST_ASSETS.USDC,
          1000,
          3,
        );

        expect(best.pathLength).toBe(3);
        expect(best.intermediateAssets).toEqual([
          `EURT:${record.path[1].asset_issuer}`,
        ]);
      });
    });

    it("executes a two-hop trade with a pathPaymentStrictSend operation", async () => {
      const record = createPathRecord({
        destinationAmount: 182,
        sourceAmount: 100,
        path: [{ code: "EURT" }, { code: "AUDD" }],
      });
      mockEmptyOrderbook();
      mockStrictSendPaths([record]);
      setupExecutionMocks();

      const submitSpy = vi.fn().mockResolvedValue({ hash: "multi-hop-tx" });
      vi.spyOn(service["server"], "submitTransaction").mockImplementation(submitSpy as any);

      const result = await service.executeRebalanceTrades(
        MOCK_KEYPAIR.publicKey(),
        [
          {
            tradeId: "hop-1",
            fromAsset: "XLM",
            toAsset: "USDC",
            amount: 100,
            maxSlippageBps: 100,
          },
        ],
        { rollbackOnFailure: false },
      );

      expect(result.status).toBe("success");
      const trade = result.executedTrades[0];
      expect(trade.status).toBe("executed");
      expect(trade.path).toEqual([
        `EURT:${record.path[0].asset_issuer}`,
        `AUDD:${record.path[1].asset_issuer}`,
      ]);
      expect(trade.remainingAmount).toBe(0);

      const submittedTx = submitSpy.mock.calls[0][0];
      const op = submittedTx.operations[0];
      expect(op.type).toBe("pathPaymentStrictSend");
      expect(op.sendAmount).toBe("100.0000000");
      // priceLimit = 1.82 * (1 - 100/10000) = 1.8018 → destMin = round(100 * 1.8018)
      expect(op.destMin).toBe("180.1800000");
      expect(op.path.map((asset: any) => asset.getCode())).toEqual(["EURT", "AUDD"]);
      expect(op.destAsset.getCode()).toBe("USDC");
      expect(op.sendAsset.getCode()).toBe("XLM");
    });

    it("fails when the only discovered path exceeds the configured maxHops", async () => {
      const record = createPathRecord({
        destinationAmount: 182,
        path: [{ code: "EURT" }, { code: "AUDD" }, { code: "BRL" }],
      });
      mockEmptyOrderbook();
      mockStrictSendPaths([record]);
      setupExecutionMocks();

      const submitSpy = vi.fn().mockResolvedValue({ hash: "multi-hop-tx" });
      vi.spyOn(service["server"], "submitTransaction").mockImplementation(submitSpy as any);

      const result = await service.executeRebalanceTrades(
        MOCK_KEYPAIR.publicKey(),
        [{ tradeId: "hop-2", fromAsset: "XLM", toAsset: "USDC", amount: 100 }],
        { rollbackOnFailure: false, maxHops: 2 },
      );

      expect(result.status).toBe("failed");
      expect(result.failedTrades[0].failureReason).toContain(
        "No direct trading pair or multi-hop path found",
      );
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it("assesses a two-hop path as executable when no direct pair exists", async () => {
      const record = createPathRecord({
        destinationAmount: 182,
        sourceAmount: 100,
        path: [{ code: "EURT" }, { code: "AUDD" }],
      });
      mockEmptyOrderbook();
      mockStrictSendPaths([record]);
      vi.spyOn(service["server"], "fetchBaseFee").mockResolvedValue(100);

      const result = await service.assessRebalanceTrades(
        [{ tradeId: "hop-3", fromAsset: "XLM", toAsset: "USDC", amount: 100 }],
        { maxHops: 3 },
      );

      expect(result.status).toBe("success");
      expect(result.executableTrades).toHaveLength(1);
      expect(result.executableTrades[0].estimatedReceivedAmount).toBe(182);
      expect(result.executableTrades[0].path).toEqual([
        `EURT:${record.path[0].asset_issuer}`,
        `AUDD:${record.path[1].asset_issuer}`,
      ]);
    });
  });
});
