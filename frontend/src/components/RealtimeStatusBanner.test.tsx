import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import RealtimeStatusBanner from "./RealtimeStatusBanner";

const mockUseRealtimeConnection = vi.hoisted(() => vi.fn());

vi.mock("../context/RealtimeConnectionContext", () => ({
  useRealtimeConnection: mockUseRealtimeConnection,
}));

describe("RealtimeStatusBanner", () => {
  beforeEach(() => {
    cleanup();
    mockUseRealtimeConnection.mockReturnValue({
      state: "connected",
      reconnect: vi.fn(),
      reconnectInfo: null,
      report: null,
      readinessLoading: false,
      readinessError: null,
    });
  });

  it("does not render warning bar when connected (shows live badge)", () => {
    mockUseRealtimeConnection.mockReturnValue({
      state: "connected",
      reconnect: vi.fn(),
      reconnectInfo: null,
      report: null,
      readinessLoading: false,
      readinessError: null,
    });
    render(<RealtimeStatusBanner />);
    expect(screen.getByText(/live updates/i)).toBeInTheDocument();
  });

  it("shows reconnecting state", () => {
    mockUseRealtimeConnection.mockReturnValue({
      state: "reconnecting",
      reconnect: vi.fn(),
      reconnectInfo: null,
      report: null,
      readinessLoading: false,
      readinessError: null,
    });
    render(<RealtimeStatusBanner />);
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });
});
