import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

let mockStatus = "connected";
const mockReconnect = vi.fn();

vi.mock("../context/RealtimeConnectionContext", () => ({
  useRealtimeConnection: () => ({
    state: mockStatus,
    statusDetail: mockStatus === "reconnecting" ? "Next retry in 2s (1/12)" : null,
    reconnectInfo:
      mockStatus === "reconnecting"
        ? { attempt: 1, maxAttempts: 12, nextRetryMs: 2000 }
        : null,
    reconnect: mockReconnect,
  }),
}));

import RealtimeStatusBanner from "./RealtimeStatusBanner";

describe("RealtimeStatusBanner", () => {
  beforeEach(() => {
    mockStatus = "connected";
    mockReconnect.mockClear();
  });

  it("does not render warning bar when connected (shows live badge)", () => {
    mockStatus = "connected";

    render(<RealtimeStatusBanner />);
    expect(screen.getByText(/live updates/i)).toBeInTheDocument();
  });

  it("shows reconnecting state", () => {
    mockStatus = "reconnecting";

    render(<RealtimeStatusBanner />);
    expect(screen.getByText(/reconnecting \(1\/12\)/i)).toBeInTheDocument();
    expect(screen.getByText(/retrying in about 2s/i)).toBeInTheDocument();
  });

  it("shows paused state with resume action", () => {
    mockStatus = "paused";

    render(<RealtimeStatusBanner />);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("shows disconnected state and retry button", () => {
    mockStatus = "disconnected";

    render(<RealtimeStatusBanner />);

    const button = screen.getByRole("button", { name: /retry/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(mockReconnect).toHaveBeenCalled();
  });
});