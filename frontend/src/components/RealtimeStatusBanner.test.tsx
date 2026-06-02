import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockReconnect = vi.fn();

vi.mock("../context/RealtimeConnectionContext", () => ({

    reconnect: mockReconnect,
  })),
}));



    render(<RealtimeStatusBanner />);
    expect(screen.getByText(/reconnecting \(1\/12\)/i)).toBeInTheDocument();
    expect(screen.getByText(/retrying in about 2s/i)).toBeInTheDocument();
  });


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


});
