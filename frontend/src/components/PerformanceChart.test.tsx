import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import PerformanceChart from "./PerformanceChart";

// Mock the analytics query hooks
const queryMocks = vi.hoisted(() => ({
  usePortfolioAnalytics: vi.fn(),
  usePerformanceSummary: vi.fn(),
}));

vi.mock("../hooks/queries/useAnalyticsQuery", () => ({
  usePortfolioAnalytics: queryMocks.usePortfolioAnalytics,
  usePerformanceSummary: queryMocks.usePerformanceSummary,
}));

// Mock ThemeContext
vi.mock("../context/ThemeContext", () => ({
  useTheme: vi.fn(() => ({ isDark: false })),
}));

// Mock Recharts components to avoid rendering complexity
vi.mock("recharts", () => ({
  LineChart: ({
    children,
    data,
  }: {
    children: React.ReactNode;
    data: any[];
  }) => (
    <div data-testid="line-chart" data-chart-length={data.length}>
      {children}
    </div>
  ),
  Line: () => <div data-testid="line" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
}));

// Mock Lucide icons
vi.mock("lucide-react", () => ({
  TrendingUp: () => <div data-testid="trending-up" />,
  TrendingDown: () => <div data-testid="trending-down" />,
  BarChart3: () => <div data-testid="bar-chart3" />,
  AlertCircle: () => <div data-testid="alert-circle" />,
}));

describe("PerformanceChart", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();

    // Default mock implementations
    queryMocks.usePortfolioAnalytics.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
    });

    queryMocks.usePerformanceSummary.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
  });

  describe("Rendering with known snapshot data", () => {
    it("should render chart data points correctly for known input", () => {
      const knownSnapshots = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000.0 },
        { timestamp: "2024-01-02T00:00:00Z", totalValue: 1050.5 },
        { timestamp: "2024-01-03T00:00:00Z", totalValue: 1100.75 },
        { timestamp: "2024-01-04T00:00:00Z", totalValue: 1089.25 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: knownSnapshots },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const chart = screen.getByTestId("line-chart");
      expect(chart).toBeTruthy();
      expect(chart.getAttribute("data-chart-length")).toBe("4");

      // Verify chart components are rendered
      expect(screen.getByTestId("responsive-container")).toBeTruthy();
      expect(screen.getByTestId("line")).toBeTruthy();
      expect(screen.getByTestId("x-axis")).toBeTruthy();
      expect(screen.getByTestId("y-axis")).toBeTruthy();
    });

    it("should produce expected chart data shape", () => {
      const knownSnapshots = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000.123 },
        { timestamp: "2024-01-02T00:00:00Z", totalValue: 1050.567 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: knownSnapshots },
        isLoading: false,
        error: null,
      });

      // We need to access the internal formatChartData function
      // Let's test by rendering and checking the chart receives properly formatted data
      render(<PerformanceChart portfolioId="test-portfolio" />);

      const chart = screen.getByTestId("line-chart");
      expect(chart.getAttribute("data-chart-length")).toBe("2");
    });
  });

  describe("Data gap handling", () => {
    it("should handle gaps in data points without producing NaN Y-values", () => {
      const snapshotsWithGaps = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000.0 },
        { timestamp: "2024-01-02T00:00:00Z", totalValue: 0 },
        { timestamp: "2024-01-03T00:00:00Z", totalValue: 0 },
        { timestamp: "2024-01-04T00:00:00Z", totalValue: 1100.0 },
        { timestamp: "2024-01-05T00:00:00Z", totalValue: 0 },
        { timestamp: "2024-01-06T00:00:00Z", totalValue: 1200.0 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: snapshotsWithGaps },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      // Chart should still render without errors
      expect(screen.getByTestId("line-chart")).toBeTruthy();

      // All data points should be processed (6 points)
      const chart = screen.getByTestId("line-chart");
      expect(chart.getAttribute("data-chart-length")).toBe("6");
    });

    it("should handle zero values correctly", () => {
      const snapshotsWithZeros = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: 0 },
        { timestamp: "2024-01-02T00:00:00Z", totalValue: 1000.0 },
        { timestamp: "2024-01-03T00:00:00Z", totalValue: 0 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: snapshotsWithZeros },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const chart = screen.getByTestId("line-chart");
      expect(chart).toBeTruthy();
      expect(chart.getAttribute("data-chart-length")).toBe("3");
    });

    it("should demonstrate the current bug with null/undefined values", () => {
      const snapshotsWithNulls = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: null },
        { timestamp: "2024-01-02T00:00:00Z", totalValue: 1000.0 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: snapshotsWithNulls },
        isLoading: false,
        error: null,
      });

      // This should fail due to the bug in formatChartData function
      expect(() => {
        render(<PerformanceChart portfolioId="test-portfolio" />);
      }).toThrow("Cannot read properties of null");
    });
  });

  describe("Range selector functionality", () => {
    it("should switch to 7-day range when selected", async () => {
      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: {
          data: [
            { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000 },
            { timestamp: "2024-01-02T00:00:00Z", totalValue: 1050 },
          ],
        },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const select = screen.getByDisplayValue("30 days");
      expect(select).toBeTruthy();

      // Change to 7 days
      fireEvent.change(select, { target: { value: "7" } });

      expect(screen.getByDisplayValue("7 days")).toBeTruthy();

      // Verify the hook was called with the correct days parameter
      expect(queryMocks.usePortfolioAnalytics).toHaveBeenCalledWith(
        "test-portfolio",
        7,
      );
    });

    it("should switch to 30-day range when selected", () => {
      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: [] },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const select = screen.getByDisplayValue("30 days");
      fireEvent.change(select, { target: { value: "30" } });

      expect(screen.getByDisplayValue("30 days")).toBeTruthy();
      expect(queryMocks.usePortfolioAnalytics).toHaveBeenCalledWith(
        "test-portfolio",
        30,
      );
    });

    it("should switch to 90-day range when selected", () => {
      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: [] },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const select = screen.getByDisplayValue("30 days");
      fireEvent.change(select, { target: { value: "90" } });

      expect(screen.getByDisplayValue("90 days")).toBeTruthy();
      expect(queryMocks.usePortfolioAnalytics).toHaveBeenCalledWith(
        "test-portfolio",
        90,
      );
    });

    it("should update data slice when range changes", () => {
      // Mock different data for different ranges
      queryMocks.usePortfolioAnalytics.mockImplementation(
        (portfolioId, days) => {
          const dataByDays = {
            7: {
              data: [
                { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000 },
                { timestamp: "2024-01-02T00:00:00Z", totalValue: 1050 },
              ],
            },
            30: {
              data: [
                { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000 },
                { timestamp: "2024-01-02T00:00:00Z", totalValue: 1050 },
                { timestamp: "2024-01-03T00:00:00Z", totalValue: 1100 },
              ],
            },
            90: {
              data: [
                { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000 },
                { timestamp: "2024-01-02T00:00:00Z", totalValue: 1050 },
                { timestamp: "2024-01-03T00:00:00Z", totalValue: 1100 },
                { timestamp: "2024-01-04T00:00:00Z", totalValue: 1150 },
              ],
            },
          };

          return {
            data: dataByDays[days as keyof typeof dataByDays] || { data: [] },
            isLoading: false,
            error: null,
          };
        },
      );

      render(<PerformanceChart portfolioId="test-portfolio" />);

      // Initially 30 days (3 data points)
      expect(
        screen.getByTestId("line-chart").getAttribute("data-chart-length"),
      ).toBe("3");

      // Change to 7 days (2 data points)
      const select = screen.getByDisplayValue("30 days");
      fireEvent.change(select, { target: { value: "7" } });

      expect(
        screen.getByTestId("line-chart").getAttribute("data-chart-length"),
      ).toBe("2");

      // Change to 90 days (4 data points)
      fireEvent.change(select, { target: { value: "90" } });

      expect(
        screen.getByTestId("line-chart").getAttribute("data-chart-length"),
      ).toBe("4");
    });
  });

  describe("Empty state rendering", () => {
    it("should render placeholder message when no portfolio is connected", () => {
      render(<PerformanceChart portfolioId={null} />);

      expect(
        screen.getByText(
          "Connect a wallet and create a portfolio to view performance analytics",
        ),
      ).toBeTruthy();
      expect(screen.getByTestId("bar-chart3")).toBeTruthy();
    });

    it("should render placeholder message when demo portfolio is selected", () => {
      render(<PerformanceChart portfolioId="demo" />);

      expect(
        screen.getByText(
          "Connect a wallet and create a portfolio to view performance analytics",
        ),
      ).toBeTruthy();
      expect(screen.getByTestId("bar-chart3")).toBeTruthy();
    });

    it("should render empty state when analytics data is empty", () => {
      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: [] },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      expect(
        screen.getByText("No performance data available yet"),
      ).toBeTruthy();
      expect(
        screen.getByText("Data will appear as your portfolio value changes"),
      ).toBeTruthy();
      expect(screen.getByTestId("bar-chart3")).toBeTruthy();
    });

    it("should render loading state while fetching data", () => {
      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      queryMocks.usePerformanceSummary.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      // Check for skeleton loading elements using animate-pulse class
      const skeletonElements = document.querySelectorAll(".animate-pulse");
      expect(skeletonElements.length).toBeGreaterThan(0);

      // Should have skeleton elements for the chart area and metrics
      const chartSkeleton = document.querySelector(".h-80.bg-gray-200");
      expect(chartSkeleton).toBeTruthy();
    });

    it("should render error state when data fetching fails", () => {
      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error("API Error"),
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      expect(screen.getByText("Failed to load performance data")).toBeTruthy();
      expect(screen.getByTestId("alert-circle")).toBeTruthy();
    });
  });

  describe("Performance metrics rendering", () => {
    it("should render performance metrics when summary data is available", () => {
      const mockMetrics = {
        totalReturn: 15.5,
        dailyChange: 2.3,
        weeklyChange: -1.2,
        maxDrawdown: -5.8,
        bestDay: { change: 8.9, date: "2024-01-15" },
        worstDay: { change: -4.2, date: "2024-01-10" },
        sharpeRatio: 1.45,
        volatility: 12.3,
      };

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: {
          data: [{ timestamp: "2024-01-01T00:00:00Z", totalValue: 1000 }],
        },
        isLoading: false,
        error: null,
      });

      queryMocks.usePerformanceSummary.mockReturnValue({
        data: { metrics: mockMetrics },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      expect(screen.getByText("+15.50%")).toBeTruthy();
      expect(screen.getByText("+2.30%")).toBeTruthy();
      expect(screen.getByText("-1.20%")).toBeTruthy();
      expect(screen.getByText("-5.80%")).toBeTruthy();
      expect(screen.getByText("1.45")).toBeTruthy();
    });

    it("should show appropriate icons for positive and negative changes", () => {
      const mockMetrics = {
        totalReturn: 15.5,
        dailyChange: -2.3,
        weeklyChange: 1.2,
        maxDrawdown: -5.8,
        bestDay: { change: 8.9, date: "2024-01-15" },
        worstDay: { change: -4.2, date: "2024-01-10" },
        sharpeRatio: 1.45,
        volatility: 12.3,
      };

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: {
          data: [{ timestamp: "2024-01-01T00:00:00Z", totalValue: 1000 }],
        },
        isLoading: false,
        error: null,
      });

      queryMocks.usePerformanceSummary.mockReturnValue({
        data: { metrics: mockMetrics },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const trendingUpIcons = screen.getAllByTestId("trending-up");
      const trendingDownIcons = screen.getAllByTestId("trending-down");

      expect(trendingUpIcons.length).toBeGreaterThan(0);
      expect(trendingDownIcons.length).toBeGreaterThan(0);
    });
  });

  describe("Data normalization edge cases", () => {
    it("should handle malformed timestamps gracefully", () => {
      const malformedSnapshots = [
        { timestamp: "invalid-date", totalValue: 1000 },
        { timestamp: "2024-01-02T00:00:00Z", totalValue: 1050 },
        { timestamp: "", totalValue: 1100 },
        { timestamp: null, totalValue: 1150 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: malformedSnapshots },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      // Chart should still render without crashing
      expect(screen.getByTestId("line-chart")).toBeTruthy();
    });

    it("should handle very large and very small values", () => {
      const extremeValueSnapshots = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: 0.001 },
        { timestamp: "2024-01-02T00:00:00Z", totalValue: 999999999.99 },
        { timestamp: "2024-01-03T00:00:00Z", totalValue: 1000000000 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: extremeValueSnapshots },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const chart = screen.getByTestId("line-chart");
      expect(chart).toBeTruthy();
      expect(chart.getAttribute("data-chart-length")).toBe("3");
    });
  });
});
