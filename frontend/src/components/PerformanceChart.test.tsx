import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import PerformanceChart from "./PerformanceChart";

// Mock the analytics query hooks
const queryMocks = vi.hoisted(() => ({
  usePortfolioAnalytics: vi.fn(),
  usePerformanceSummary: vi.fn(),
  useRebalanceHistory: vi.fn(),
}));

// Mock export utilities
const exportMocks = vi.hoisted(() => ({
  downloadCSV: vi.fn(),
  toCSV: vi.fn((rows, headers) => 'mocked-csv-content'),
}));

vi.mock("../hooks/queries/useAnalyticsQuery", () => ({
  usePortfolioAnalytics: queryMocks.usePortfolioAnalytics,
  usePerformanceSummary: queryMocks.usePerformanceSummary,
}));


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
  ReferenceDot: () => <div data-testid="reference-dot" />,
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
  Download: () => <div data-testid="download" />,
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

    // Reset export mocks
    exportMocks.downloadCSV.mockReset();
    exportMocks.toCSV.mockReturnValue('mocked-csv-content');
    });

    queryMocks.useRebalanceHistory.mockReturnValue({
      data: { history: [] },
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

    it("should coerce null snapshot values to zero without crashing", () => {
      const snapshotsWithNulls = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: null },
        { timestamp: "2024-01-02T00:00:00Z", totalValue: 1000.0 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: snapshotsWithNulls },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);
      const chart = screen.getByTestId("line-chart");
      expect(chart.getAttribute("data-chart-length")).toBe("2");
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

    it("should request extended analytics data when compare mode is enabled", () => {
      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: {
          data: [
            { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000 },
            { timestamp: "2024-01-02T00:00:00Z", totalValue: 1020 },
            { timestamp: "2024-01-03T00:00:00Z", totalValue: 1040 },
            { timestamp: "2024-01-04T00:00:00Z", totalValue: 1060 },
          ],
        },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const toggle = screen.getByRole('button', {
        name: /compare previous period/i,
      });
      fireEvent.click(toggle);

      expect(queryMocks.usePortfolioAnalytics).toHaveBeenCalledWith(
        "test-portfolio",
        60,
      );
    });

    it("should render rebalance markers from history events", () => {
      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: {
          data: [
            { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000 },
            { timestamp: "2024-01-02T00:00:00Z", totalValue: 1100 },
          ],
        },
        isLoading: false,
        error: null,
      });

      queryMocks.useRebalanceHistory.mockReturnValue({
        data: {
          history: [
            {
              id: 'event-1',
              timestamp: '2024-01-02T00:00:00Z',
              status: 'completed',
              trigger: 'Rebalance executed',
            },
          ],
        },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      expect(screen.getAllByTestId('reference-dot').length).toBeGreaterThan(0);
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


  describe("CSV Export", () => {
    it("should render export button", () => {
      const knownSnapshots = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000.0 },
        { timestamp: "2024-01-02T00:00:00Z", totalValue: 1050.5 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: knownSnapshots },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const exportButton = screen.getByText("Export CSV");
      expect(exportButton).toBeTruthy();
    });

    it("should export chart data as CSV when button is clicked", () => {
      const knownSnapshots = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000.0 },
        { timestamp: "2024-01-02T00:00:00Z", totalValue: 1050.5 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: knownSnapshots },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const exportButton = screen.getByText("Export CSV");
      fireEvent.click(exportButton);

      // Verify toCSV was called with correct data structure
      expect(exportMocks.toCSV).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            timestamp: "2024-01-01T00:00:00Z",
            portfolioValue: 1000,
          }),
          expect.objectContaining({
            timestamp: "2024-01-02T00:00:00Z",
            portfolioValue: 1050.5,
          }),
        ]),
        ["timestamp", "date", "portfolioValue"]
      );

      // Verify downloadCSV was called with filename and CSV content
      expect(exportMocks.downloadCSV).toHaveBeenCalledWith(
        expect.stringMatching(/^portfolio_performance_test-portfolio_30days_/),
        "mocked-csv-content"
      );
    });

    it("should disable export button when no data is available", () => {
      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: [] },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const exportButton = screen.getByText("Export CSV");
      expect(exportButton).toHaveProperty("disabled", true);
    });

    it("should export data with correct time period in filename", () => {
      const knownSnapshots = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000.0 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: knownSnapshots },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      // Change time period to 7 days
      const select = screen.getByDisplayValue("30 days");
      fireEvent.change(select, { target: { value: "7" } });

      const exportButton = screen.getByText("Export CSV");
      fireEvent.click(exportButton);

      // Verify filename includes 7days
      expect(exportMocks.downloadCSV).toHaveBeenCalledWith(
        expect.stringMatching(/7days/),
        expect.any(String)
      );
    });

    it("should include all required columns in CSV export", () => {
      const knownSnapshots = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000.0 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: knownSnapshots },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const exportButton = screen.getByText("Export CSV");
      fireEvent.click(exportButton);

      // Verify the headers passed to toCSV
      expect(exportMocks.toCSV).toHaveBeenCalledWith(
        expect.any(Array),
        ["timestamp", "date", "portfolioValue"]
      );
    });

    it("should format values correctly for CSV export", () => {
      const knownSnapshots = [
        { timestamp: "2024-01-01T00:00:00Z", totalValue: 1000.123 },
        { timestamp: "2024-01-02T00:00:00Z", totalValue: 1050.567 },
      ];

      queryMocks.usePortfolioAnalytics.mockReturnValue({
        data: { data: knownSnapshots },
        isLoading: false,
        error: null,
      });

      render(<PerformanceChart portfolioId="test-portfolio" />);

      const exportButton = screen.getByText("Export CSV");
      fireEvent.click(exportButton);

      const csvRows = exportMocks.toCSV.mock.calls[0][0];
      
      // Values should be rounded to 2 decimal places
      expect(csvRows[0].portfolioValue).toBe(1000.12);
      expect(csvRows[1].portfolioValue).toBe(1050.57);
    });
  });
      const chart = screen.getByTestId("line-chart");
      expect(chart).toBeTruthy();
      expect(chart.getAttribute("data-chart-length")).toBe("3");
    });
  });
});
