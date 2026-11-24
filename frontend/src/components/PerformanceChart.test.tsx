import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import PerformanceChart from "./PerformanceChart";

// Isolated API doubles: every data hook the chart uses is replaced, so no request leaves the test and no
// wallet or provider is needed (the chart only takes a portfolio id).
const queryMocks = vi.hoisted(() => ({
  usePortfolioAnalytics: vi.fn(),
  usePerformanceSummary: vi.fn(),
  usePortfolioBenchmark: vi.fn(),
  useRebalanceHistory: vi.fn(),
}));

const exportMocks = vi.hoisted(() => ({
  downloadCSV: vi.fn(),
  toCSV: vi.fn(() => "mocked-csv-content"),
}));

vi.mock("../hooks/queries/useAnalyticsQuery", () => ({
  usePortfolioAnalytics: queryMocks.usePortfolioAnalytics,
  usePerformanceSummary: queryMocks.usePerformanceSummary,
  usePortfolioBenchmark: queryMocks.usePortfolioBenchmark,
}));

vi.mock("../hooks/queries/useHistoryQuery", () => ({
  useRebalanceHistory: queryMocks.useRebalanceHistory,
}));

vi.mock("../utils/export", () => ({
  downloadCSV: exportMocks.downloadCSV,
  toCSV: exportMocks.toCSV,
}));

vi.mock("../context/ThemeContext", () => ({
  useTheme: vi.fn(() => ({ isDark: false })),
}));

// Recharts needs real layout; a light double keeps what the tests assert on (data length, single-point dot).
vi.mock("recharts", () => ({
  LineChart: ({ children, data }: { children: React.ReactNode; data: any[] }) => (
    <div data-testid="line-chart" data-chart-length={data.length}>
      {children}
    </div>
  ),
  Line: ({ dot }: { dot: unknown }) => <div data-testid="line" data-dot={dot ? "shown" : "hidden"} />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
  ReferenceDot: () => <div data-testid="reference-dot" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
}));

vi.mock("lucide-react", () => ({
  TrendingUp: () => <div data-testid="trending-up" />,
  TrendingDown: () => <div data-testid="trending-down" />,
  BarChart3: () => <div data-testid="bar-chart3" />,
  AlertCircle: () => <div data-testid="alert-circle" />,
}));

type QueryDouble = { data: any; isLoading: boolean; error: unknown; refetch: ReturnType<typeof vi.fn> };

function query(data: any, overrides: Partial<QueryDouble> = {}): QueryDouble {
  return { data, isLoading: false, error: null, refetch: vi.fn(() => Promise.resolve({ data })), ...overrides };
}

function series(values: number[], allocations?: (i: number) => Record<string, unknown>) {
  return values.map((totalValue, i) => ({
    timestamp: `2024-01-0${i + 1}T00:00:00Z`,
    totalValue,
    ...(allocations ? { allocations: allocations(i) } : {}),
  }));
}

/** A promise the test resolves by hand, to hold a retry "in flight". */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

let analytics: QueryDouble;

function setAnalytics(q: QueryDouble) {
  analytics = q;
  queryMocks.usePortfolioAnalytics.mockImplementation(() => analytics);
}

const status = () => screen.getByTestId("performance-chart-status").textContent ?? "";

describe("PerformanceChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAnalytics(query({ data: [] }));
    queryMocks.usePerformanceSummary.mockReturnValue(query(null));
    queryMocks.useRebalanceHistory.mockReturnValue(query({ history: [] }));
    queryMocks.usePortfolioBenchmark.mockReturnValue(query({ benchmarks: [] }));
  });

  afterEach(() => cleanup());

  describe("time range", () => {
    it("starts on 1D, shows it visibly and as pressed, and requests that range", () => {
      render(<PerformanceChart portfolioId="p1" />);
      expect(screen.getByTestId("selected-range").textContent).toBe("Range: 1D");
      expect(screen.getByRole("button", { name: "Show 1 day" }).getAttribute("aria-pressed")).toBe("true");
      expect(queryMocks.usePortfolioAnalytics).toHaveBeenLastCalledWith("p1", 1);
    });

    it("switches range, updates the visible label and the announcement", () => {
      setAnalytics(query({ data: series([1000, 1050, 1100]) }));
      render(<PerformanceChart portfolioId="p1" />);
      fireEvent.click(screen.getByRole("button", { name: "Show 1 week" }));
      expect(queryMocks.usePortfolioAnalytics).toHaveBeenLastCalledWith("p1", 7);
      expect(screen.getByTestId("selected-range").textContent).toBe("Range: 1W");
      expect(screen.getByRole("button", { name: "Show 1 week" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "Show 1 day" }).getAttribute("aria-pressed")).toBe("false");
      expect(status()).toContain("1W (last 7 days): 3 price points.");
    });
  });

  describe("empty series", () => {
    it("explains the empty state, announces it, and disables export", () => {
      render(<PerformanceChart portfolioId="p1" />);
      expect(screen.getByTestId("performance-chart-empty")).toBeTruthy();
      expect(screen.getByText("No performance data available yet")).toBeTruthy();
      expect(screen.queryByTestId("line-chart")).toBeNull();
      expect(status()).toContain("1D (last 1 day): 0 price points.");
      expect(screen.getByTestId("selected-range").textContent).toBe("Range: 1D");
      expect(screen.getByRole("button", { name: "Export chart data as CSV" })).toHaveProperty("disabled", true);
      expect(screen.queryByTestId("missing-data-indicator")).toBeNull();
    });
  });

  describe("single price point", () => {
    it("draws the point as a dot, explains why there is no trend, and labels the chart", () => {
      setAnalytics(query({ data: series([1234.5]) }));
      render(<PerformanceChart portfolioId="p1" />);
      expect(screen.getByTestId("line-chart").getAttribute("data-chart-length")).toBe("1");
      expect(screen.getByTestId("line").getAttribute("data-dot")).toBe("shown");
      expect(screen.getByTestId("single-point-note")).toBeTruthy();
      expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/one price point for 1D/);
      expect(status()).toContain("1D (last 1 day): 1 price point.");
    });

    it("hides dots for a normal series", () => {
      setAnalytics(query({ data: series([1000, 1100]) }));
      render(<PerformanceChart portfolioId="p1" />);
      expect(screen.getByTestId("line").getAttribute("data-dot")).toBe("hidden");
      expect(screen.queryByTestId("single-point-note")).toBeNull();
      expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/2 data points/);
    });
  });

  describe("one asset missing historical prices", () => {
    const withGap = () =>
      series([1000, 1010, 1020], (i) => ({ XLM: 60, USDC: i === 1 ? null : 40 }));

    it("shows which asset is missing, how much, and offers retry and dismiss", () => {
      setAnalytics(query({ data: withGap() }));
      render(<PerformanceChart portfolioId="p1" />);
      const panel = screen.getByTestId("missing-history-panel");
      expect(within(panel).getByText("Price history is missing for USDC.")).toBeTruthy();
      expect(within(panel).getByText("USDC: no price for 1 of 3 points")).toBeTruthy();
      expect(within(panel).getByRole("button", { name: "Retry loading prices" })).toBeTruthy();
      expect(within(panel).getByRole("button", { name: "Dismiss" })).toBeTruthy();
      expect(status()).toContain("Price history is missing for USDC.");
      // the chart itself still renders
      expect(screen.getByTestId("line-chart").getAttribute("data-chart-length")).toBe("3");
    });

    it("retries only the price query, once, however often it is clicked", async () => {
      setAnalytics(query({ data: withGap() }));
      const inFlight = deferred();
      analytics.refetch.mockReturnValue(inFlight.promise);
      render(<PerformanceChart portfolioId="p1" />);

      const retry = screen.getByRole("button", { name: "Retry loading prices" });
      fireEvent.click(retry);
      fireEvent.click(retry);
      fireEvent.click(screen.getByRole("button", { name: "Retrying…" }));
      expect(analytics.refetch).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Retrying…" })).toHaveProperty("disabled", true);
      expect(queryMocks.usePerformanceSummary.mock.results[0].value.refetch).not.toHaveBeenCalled();

      // the prices come back complete: the warning goes away and the selected range is kept
      setAnalytics(query({ data: series([1000, 1010, 1020], () => ({ XLM: 60, USDC: 40 })) }));
      await act(async () => inFlight.resolve());
      expect(screen.queryByTestId("missing-history-panel")).toBeNull();
      expect(screen.queryByTestId("missing-data-indicator")).toBeNull();
      expect(screen.getByTestId("selected-range").textContent).toBe("Range: 1D");
    });

    it("can be dismissed, leaves a visible indicator that reopens it, and moves focus with it", () => {
      setAnalytics(query({ data: withGap() }));
      render(<PerformanceChart portfolioId="p1" />);

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByTestId("missing-history-panel")).toBeNull();
      const badge = screen.getByTestId("missing-data-indicator");
      expect(badge.textContent).toBe("Missing data (1)");
      expect(badge.getAttribute("aria-label")).toBe("Missing price history for USDC. Show details");
      expect(document.activeElement).toBe(badge);

      fireEvent.click(badge);
      const panel = screen.getByTestId("missing-history-panel");
      expect(document.activeElement).toBe(panel);
    });

    it("does not warn when snapshots carry no per-asset data", () => {
      setAnalytics(query({ data: series([1000, 1100]) }));
      render(<PerformanceChart portfolioId="p1" />);
      expect(screen.queryByTestId("missing-history-panel")).toBeNull();
      expect(screen.queryByTestId("missing-data-indicator")).toBeNull();
    });
  });

  describe("failure and recovery", () => {
    it("keeps the range controls, explains the failure, and announces it", () => {
      setAnalytics(query(undefined, { error: new Error("boom") }));
      render(<PerformanceChart portfolioId="p1" />);
      expect(screen.getByRole("alert").textContent).toBe("Failed to load performance data");
      expect(screen.getByTestId("range-controls")).toBeTruthy();
      expect(screen.getByTestId("selected-range").textContent).toBe("Range: 1D");
      expect(status()).toBe("Performance data failed to load for 1 day. Retry is available.");
      expect(screen.getByRole("button", { name: "Export chart data as CSV" })).toHaveProperty("disabled", true);
    });

    it("retries only the failed queries, never twice at once, and recovers in place", async () => {
      setAnalytics(query(undefined, { error: new Error("boom") }));
      const summary = query(null);
      queryMocks.usePerformanceSummary.mockReturnValue(summary);
      const inFlight = deferred();
      analytics.refetch.mockReturnValue(inFlight.promise);
      render(<PerformanceChart portfolioId="p1" />);

      // the user changes the range while it is failing: that choice must survive the retry
      fireEvent.click(screen.getByRole("button", { name: "Show 1 month" }));
      const failed = analytics;
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      fireEvent.click(screen.getByRole("button", { name: "Retrying…" }));
      expect(failed.refetch).toHaveBeenCalledTimes(1);
      expect(summary.refetch).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Retrying…" }).getAttribute("aria-busy")).toBe("true");

      setAnalytics(query({ data: series([1000, 1100, 1200]) }));
      await act(async () => inFlight.resolve());
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByTestId("line-chart").getAttribute("data-chart-length")).toBe("3");
      expect(screen.getByTestId("selected-range").textContent).toBe("Range: 1M");
      expect(status()).toContain("1M (last 30 days): 3 price points.");
      // the retry button is gone, so focus lands on the chart heading instead of being lost
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Portfolio performance" }));
    });

    it("allows another retry after a retry fails", async () => {
      setAnalytics(query(undefined, { error: new Error("boom") }));
      analytics.refetch.mockRejectedValueOnce(new Error("still down"));
      render(<PerformanceChart portfolioId="p1" />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      });
      const again = screen.getByRole("button", { name: "Retry" });
      expect(again).toHaveProperty("disabled", false);
      await act(async () => {
        fireEvent.click(again);
      });
      expect(analytics.refetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("loading, demo and narrow layout", () => {
    it("keeps the range controls while loading and announces the load", () => {
      setAnalytics(query(undefined, { isLoading: true }));
      render(<PerformanceChart portfolioId="p1" />);
      expect(screen.getByTestId("performance-chart-loading")).toBeTruthy();
      expect(document.querySelector(".h-80.bg-gray-200")).toBeTruthy();
      expect(screen.getByTestId("range-controls")).toBeTruthy();
      expect(status()).toBe("Loading performance data for 1 day.");
    });

    it("asks to connect a wallet for no portfolio or the demo", () => {
      for (const id of [null, "demo"]) {
        const { unmount } = render(<PerformanceChart portfolioId={id} />);
        expect(screen.getByText("Connect a wallet and create a portfolio to view performance analytics")).toBeTruthy();
        unmount();
      }
    });

    it("lets controls and the missing-data indicator wrap instead of clipping at narrow widths", () => {
      setAnalytics(query({ data: series([1000, 1010], (i) => ({ XLM: 60, USDC: i === 0 ? undefined : 40 })) }));
      render(<PerformanceChart portfolioId="p1" />);
      const controls = screen.getByTestId("range-controls");
      expect(controls.className).toMatch(/\bflex-wrap\b/);
      expect(controls.className).toMatch(/\bmin-w-0\b/);
      expect(screen.getByTestId("missing-history-panel").className).toMatch(/\bflex-col\b/);
      expect(screen.getByTestId("performance-chart-card").className).toMatch(/\bmin-w-0\b/);
      expect(screen.getByRole("img").className).toMatch(/\bw-full\b/);
    });
  });

  describe("data and export", () => {
    it("keeps a valid zero and skips null and malformed values", () => {
      setAnalytics(
        query({
          data: [
            { timestamp: "invalid-date", totalValue: null },
            { timestamp: "2024-01-02T00:00:00Z", totalValue: 0 },
            { timestamp: null, totalValue: "1100.75" },
          ],
        }),
      );
      render(<PerformanceChart portfolioId="p1" />);
      expect(screen.getByTestId("line-chart").getAttribute("data-chart-length")).toBe("1");
    });

    it("renders rebalance markers from history events", () => {
      setAnalytics(query({ data: series([1000, 1100]) }));
      queryMocks.useRebalanceHistory.mockReturnValue(
        query({ history: [{ id: "e1", timestamp: "2024-01-02T00:00:00Z", status: "completed" }] }),
      );
      render(<PerformanceChart portfolioId="p1" />);
      expect(screen.getAllByTestId("reference-dot").length).toBe(1);
    });

    it("exports the rounded series with the selected range in the filename", () => {
      setAnalytics(query({ data: series([1000.123, 1050.567]) }));
      render(<PerformanceChart portfolioId="p1" />);
      fireEvent.click(screen.getByRole("button", { name: "Show 1 week" }));
      fireEvent.click(screen.getByRole("button", { name: "Export chart data as CSV" }));
      const rows = (exportMocks.toCSV.mock.calls[0] as any[])[0];
      expect(rows.map((r: any) => r.portfolioValue)).toEqual([1000.12, 1050.57]);
      expect(exportMocks.downloadCSV).toHaveBeenCalledWith(expect.stringMatching(/^portfolio_performance_p1_7d_/), "mocked-csv-content");
    });

    it("renders summary metrics when available", () => {
      setAnalytics(query({ data: series([1000]) }));
      queryMocks.usePerformanceSummary.mockReturnValue(
        query({
          metrics: {
            totalReturn: 15.5, dailyChange: -2.3, weeklyChange: 1.2, maxDrawdown: -5.8,
            bestDay: { change: 8.9, date: "2024-01-15" }, worstDay: { change: -4.2, date: "2024-01-10" },
            sharpeRatio: 1.45, volatility: 12.3,
          },
        }),
      );
      render(<PerformanceChart portfolioId="p1" />);
      expect(screen.getByText("1.45")).toBeTruthy();
      expect(screen.getAllByTestId("trending-up").length).toBeGreaterThan(0);
      expect(screen.getAllByTestId("trending-down").length).toBeGreaterThan(0);
    });
  });
});
