import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AllocationHistory from "./AllocationHistory";

const queryMocks = vi.hoisted(() => ({
  usePortfolioAnalytics: vi.fn(),
  useRebalanceHistory: vi.fn(),
}));

vi.mock("../hooks/queries/useAnalyticsQuery", () => ({
  usePortfolioAnalytics: queryMocks.usePortfolioAnalytics,
  usePerformanceSummary: vi.fn(),
}));

vi.mock("../hooks/queries/useHistoryQuery", () => ({
  useRebalanceHistory: queryMocks.useRebalanceHistory,
}));

vi.mock("../context/ThemeContext", () => ({
  useTheme: vi.fn(() => ({ isDark: false })),
}));

vi.mock("../content/uiCopy", () => ({
  DEFAULT_LOCALE: "en-US",
  performanceChartCopy: {},
}));

vi.mock("recharts", () => ({
  AreaChart: ({ children, data }: { children: React.ReactNode; data: any[] }) => (
    <div data-testid="area-chart" data-chart-length={data.length}>
      {children}
    </div>
  ),
  Area: () => <div data-testid="area" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: ({ content }: { content: () => React.ReactNode }) => (
    <div data-testid="legend">{content()}</div>
  ),
  ReferenceLine: () => <div data-testid="reference-line" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
}));

vi.mock("lucide-react", () => ({
  BarChart3: () => <div data-testid="bar-chart3" />,
  AlertCircle: () => <div data-testid="alert-circle" />,
}));

describe("AllocationHistory", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockDailyValues = [
    {
      timestamp: "2025-01-01T00:00:00Z",
      totalValue: 10000,
      allocations: { XLM: 40, USDC: 35, BTC: 25 },
    },
    {
      timestamp: "2025-01-02T00:00:00Z",
      totalValue: 10200,
      allocations: { XLM: 42, USDC: 33, BTC: 25 },
    },
  ];

  it("renders empty state when portfolioId is null", () => {
    queryMocks.usePortfolioAnalytics.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    queryMocks.useRebalanceHistory.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    render(<AllocationHistory portfolioId={null} />);
    expect(screen.getByText(/connect a wallet/i)).toBeDefined();
  });

  it("renders empty state for demo portfolio", () => {
    queryMocks.usePortfolioAnalytics.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
    queryMocks.useRebalanceHistory.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    render(<AllocationHistory portfolioId="demo" />);
    expect(screen.getByText(/connect a wallet/i)).toBeDefined();
  });

  it("renders loading skeleton when loading", () => {
    queryMocks.usePortfolioAnalytics.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });
    queryMocks.useRebalanceHistory.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    render(<AllocationHistory portfolioId="pf-123" />);
    expect(screen.getByRole("status", { busy: true })).toBeDefined();
  });

  it("renders error state on fetch failure", () => {
    queryMocks.usePortfolioAnalytics.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error("Network error"),
    });
    queryMocks.useRebalanceHistory.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    render(<AllocationHistory portfolioId="pf-123" />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("renders empty state when no data points", () => {
    queryMocks.usePortfolioAnalytics.mockReturnValue({
      data: { dailyValues: [] },
      isLoading: false,
      error: null,
    });
    queryMocks.useRebalanceHistory.mockReturnValue({
      data: { history: [] },
      isLoading: false,
      error: null,
    });

    render(<AllocationHistory portfolioId="pf-123" />);
    expect(screen.getByText(/no allocation data available/i)).toBeDefined();
  });

  it("renders chart with allocation data", () => {
    queryMocks.usePortfolioAnalytics.mockReturnValue({
      data: { dailyValues: mockDailyValues },
      isLoading: false,
      error: null,
    });
    queryMocks.useRebalanceHistory.mockReturnValue({
      data: { history: [] },
      isLoading: false,
      error: null,
    });

    render(<AllocationHistory portfolioId="pf-123" />);
    expect(screen.getByTestId("area-chart")).toBeDefined();
    expect(screen.getByTestId("responsive-container")).toBeDefined();
    expect(screen.getByText("Allocation History")).toBeDefined();
  });

  it("shows asset toggle buttons in legend", () => {
    queryMocks.usePortfolioAnalytics.mockReturnValue({
      data: { dailyValues: mockDailyValues },
      isLoading: false,
      error: null,
    });
    queryMocks.useRebalanceHistory.mockReturnValue({
      data: { history: [] },
      isLoading: false,
      error: null,
    });

    render(<AllocationHistory portfolioId="pf-123" />);
    expect(screen.getByText("XLM")).toBeDefined();
    expect(screen.getByText("USDC")).toBeDefined();
    expect(screen.getByText("BTC")).toBeDefined();
  });

  it("toggles asset visibility on legend click", () => {
    queryMocks.usePortfolioAnalytics.mockReturnValue({
      data: { dailyValues: mockDailyValues },
      isLoading: false,
      error: null,
    });
    queryMocks.useRebalanceHistory.mockReturnValue({
      data: { history: [] },
      isLoading: false,
      error: null,
    });

    render(<AllocationHistory portfolioId="pf-123" />);
    const xlmButton = screen.getByText("XLM").closest("button")!;
    expect(xlmButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(xlmButton);
    expect(xlmButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(xlmButton);
    expect(xlmButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows time range selector buttons", () => {
    queryMocks.usePortfolioAnalytics.mockReturnValue({
      data: { dailyValues: mockDailyValues },
      isLoading: false,
      error: null,
    });
    queryMocks.useRebalanceHistory.mockReturnValue({
      data: { history: [] },
      isLoading: false,
      error: null,
    });

    render(<AllocationHistory portfolioId="pf-123" />);
    expect(screen.getByText("7D")).toBeDefined();
    expect(screen.getByText("30D")).toBeDefined();
    expect(screen.getByText("90D")).toBeDefined();
  });

  it("renders reference lines for rebalance events", () => {
    const rebalanceEvent = {
      id: "evt-1",
      timestamp: "2025-01-01T12:00:00Z",
      status: "completed",
    };

    queryMocks.usePortfolioAnalytics.mockReturnValue({
      data: { dailyValues: mockDailyValues },
      isLoading: false,
      error: null,
    });
    queryMocks.useRebalanceHistory.mockReturnValue({
      data: { history: [rebalanceEvent] },
      isLoading: false,
      error: null,
    });

    render(<AllocationHistory portfolioId="pf-123" />);
    expect(screen.getByTestId("reference-line")).toBeDefined();
  });
});
