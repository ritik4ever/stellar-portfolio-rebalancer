import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RealtimeStatusBanner from "./RealtimeStatusBanner";

let mockRealtimeState: any;

vi.mock("../context/RealtimeConnectionContext", () => ({
  useRealtimeConnection: () => mockRealtimeState,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RealtimeStatusBanner", () => {
  it("renders connected status", () => {
    mockRealtimeState = {
      state: "connected",
      statusDetail: undefined,
      reconnect: vi.fn(),
    };

    render(<RealtimeStatusBanner />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/live updates/i)).toBeInTheDocument();
  });

  it("renders reconnecting alert", () => {
    mockRealtimeState = {
      state: "reconnecting",
      statusDetail: undefined,
      reconnect: vi.fn(),
    };

    render(<RealtimeStatusBanner />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/reconnecting to live updates/i)).toBeInTheDocument();
  });

  it("renders disconnected alert with retry button", () => {
    mockRealtimeState = {
      state: "disconnected",
      statusDetail: "Socket closed",
      reconnect: vi.fn(),
    };

    render(<RealtimeStatusBanner />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/live updates disconnected/i)).toBeInTheDocument();
    expect(screen.getByText(/socket closed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry connection/i })).toBeInTheDocument();
  });

  it("calls reconnect when retry button is clicked", () => {
    const reconnect = vi.fn();

    mockRealtimeState = {
      state: "disconnected",
      statusDetail: undefined,
      reconnect,
    };

    render(<RealtimeStatusBanner />);

    fireEvent.click(screen.getByRole("button", { name: /retry connection/i }));

    expect(reconnect).toHaveBeenCalledTimes(1);
  });
});