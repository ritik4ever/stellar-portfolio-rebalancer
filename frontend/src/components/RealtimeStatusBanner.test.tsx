import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockReconnect = vi.fn();

vi.mock("../context/RealtimeConnectionContext", () => ({
  useRealtimeConnection: vi.fn(() => ({
    state: "connected",
    statusDetail: null,
    reconnect: mockReconnect,
  })),
}));

import RealtimeStatusBanner from "./RealtimeStatusBanner";
import { useRealtimeConnection } from "../context/RealtimeConnectionContext";

describe("RealtimeStatusBanner", () => {
  afterEach(() => {
    cleanup();
    mockReconnect.mockClear();
    vi.clearAllMocks();
  });

  it("does not render warning bar when connected (shows live badge)", () => {
    vi.mocked(useRealtimeConnection).mockReturnValue({
      state: "connected",
      statusDetail: null,
      reconnect: mockReconnect,
      disconnect: vi.fn(),
      send: vi.fn(),
    });

    render(<RealtimeStatusBanner />);
    expect(screen.getByText(/live updates/i)).toBeInTheDocument();
  });

  it("shows connecting state with loading spinner", () => {
    vi.mocked(useRealtimeConnection).mockReturnValue({
      state: "connecting",
      statusDetail: null,
      reconnect: mockReconnect,
      disconnect: vi.fn(),
      send: vi.fn(),
    });

    render(<RealtimeStatusBanner />);
    expect(screen.getByText(/connecting to live updates/i)).toBeInTheDocument();
  });

  it("shows reconnecting state with loading spinner", () => {
    vi.mocked(useRealtimeConnection).mockReturnValue({
      state: "reconnecting",
      statusDetail: null,
      reconnect: mockReconnect,
      disconnect: vi.fn(),
      send: vi.fn(),
    });

    render(<RealtimeStatusBanner />);
    expect(screen.getByText(/reconnecting to live updates/i)).toBeInTheDocument();
  });

  it("shows disconnected state with retry button", () => {
    vi.mocked(useRealtimeConnection).mockReturnValue({
      state: "disconnected",
      statusDetail: null,
      reconnect: mockReconnect,
      disconnect: vi.fn(),
      send: vi.fn(),
    });

    render(<RealtimeStatusBanner />);

    const button = screen.getByRole("button", { name: /retry/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(mockReconnect).toHaveBeenCalled();
  });

  it("displays status detail when provided", () => {
    vi.mocked(useRealtimeConnection).mockReturnValue({
      state: "reconnecting",
      statusDetail: "Next retry in 5s (2/12)",
      reconnect: mockReconnect,
      disconnect: vi.fn(),
      send: vi.fn(),
    });

    render(<RealtimeStatusBanner />);
    expect(screen.getByText(/next retry in 5s/i)).toBeInTheDocument();
  });

  it("shows diagnostics panel when help button is clicked", () => {
    vi.mocked(useRealtimeConnection).mockReturnValue({
      state: "disconnected",
      statusDetail: "WebSocket error",
      reconnect: mockReconnect,
      disconnect: vi.fn(),
      send: vi.fn(),
    });

    render(<RealtimeStatusBanner />);

    const helpButton = screen.getByRole("button", { name: /show diagnostics/i });
    fireEvent.click(helpButton);

    expect(screen.getByText(/Status:/)).toBeInTheDocument();
    expect(screen.getByText(/WebSocket:/)).toBeInTheDocument();
    expect(screen.getByText(/Available/)).toBeInTheDocument();
    expect(screen.getByText(/Detail:/)).toBeInTheDocument();
  });

  it("toggles diagnostics panel on repeated clicks", () => {
    vi.mocked(useRealtimeConnection).mockReturnValue({
      state: "disconnected",
      statusDetail: null,
      reconnect: mockReconnect,
      disconnect: vi.fn(),
      send: vi.fn(),
    });

    render(<RealtimeStatusBanner />);

    const helpButton = screen.getByRole("button", { name: /show diagnostics/i });

    // Open diagnostics
    fireEvent.click(helpButton);
    expect(screen.getByText(/Status:/)).toBeInTheDocument();

    // Close diagnostics
    fireEvent.click(helpButton);
    expect(screen.queryByText(/Status:/)).not.toBeInTheDocument();
  });

  it("shows retry and help buttons in disconnected state", () => {
    vi.mocked(useRealtimeConnection).mockReturnValue({
      state: "disconnected",
      statusDetail: null,
      reconnect: mockReconnect,
      disconnect: vi.fn(),
      send: vi.fn(),
    });

    render(<RealtimeStatusBanner />);

    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show diagnostics/i })).toBeInTheDocument();
  });

  it("shows only help button in connecting state", () => {
    vi.mocked(useRealtimeConnection).mockReturnValue({
      state: "connecting",
      statusDetail: null,
      reconnect: mockReconnect,
      disconnect: vi.fn(),
      send: vi.fn(),
    });

    render(<RealtimeStatusBanner />);

    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show diagnostics/i })).toBeInTheDocument();
  });

  it("displays WebSocket availability in diagnostics", () => {
    vi.mocked(useRealtimeConnection).mockReturnValue({
      state: "disconnected",
      statusDetail: null,
      reconnect: mockReconnect,
      disconnect: vi.fn(),
      send: vi.fn(),
    });

    render(<RealtimeStatusBanner />);

    const helpButton = screen.getByRole("button", { name: /show diagnostics/i });
    fireEvent.click(helpButton);

    expect(screen.getByText(/WebSocket:/)).toBeInTheDocument();
    expect(screen.getByText(/Available/)).toBeInTheDocument();
  });

  it("displays timestamp in diagnostics", () => {
    vi.mocked(useRealtimeConnection).mockReturnValue({
      state: "disconnected",
      statusDetail: null,
      reconnect: mockReconnect,
      disconnect: vi.fn(),
      send: vi.fn(),
    });

    render(<RealtimeStatusBanner />);

    const helpButton = screen.getByRole("button", { name: /show diagnostics/i });
    fireEvent.click(helpButton);

    expect(screen.getByText(/Timestamp:/)).toBeInTheDocument();
  });
});
