import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

let mockStatus = "connected";
const mockReconnect = vi.fn();

vi.mock("../context/RealtimeConnectionContext", () => ({
  useRealtimeConnection: () => ({
    state: mockStatus,
    statusDetail: null,
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
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
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