import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { WalletSelector } from "./WalletSelector";

// Mock the walletManager and wallet adapters
const mockWalletManager = vi.hoisted(() => ({
  getAvailableWallets: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  getPublicKey: vi.fn(),
  getWalletType: vi.fn(),
  isConnected: vi.fn(),
}));

// Mock wallet adapters
const mockFreighterAdapter = {
  type: "freighter",
  name: "Freighter",
  isAvailable: vi.fn(() => true),
  connect: vi
    .fn()
    .mockResolvedValue(
      "GAfreightertest1234567890abcdef1234567890abcdef1234567890abcdef",
    ),
  isConnected: vi.fn().mockResolvedValue(true),
  disconnect: vi.fn().mockResolvedValue(undefined),
  signTransaction: vi.fn(),
};

const mockRabetAdapter = {
  type: "rabet",
  name: "Rabet",
  isAvailable: vi.fn(() => true),
  connect: vi
    .fn()
    .mockResolvedValue(
      "GArabettest1234567890abcdef1234567890abcdef1234567890abcdef",
    ),
  isConnected: vi.fn().mockResolvedValue(true),
  disconnect: vi.fn().mockResolvedValue(undefined),
  signTransaction: vi.fn(),
};

const mockXBullAdapter = {
  type: "xbull",
  name: "xBull",
  isAvailable: vi.fn(() => true),
  connect: vi
    .fn()
    .mockResolvedValue(
      "GAxbulltest1234567890abcdef1234567890abcdef1234567890abcdef",
    ),
  isConnected: vi.fn().mockResolvedValue(true),
  disconnect: vi.fn().mockResolvedValue(undefined),
  signTransaction: vi.fn(),
};

vi.mock("../utils/walletManager", () => ({
  walletManager: mockWalletManager,
}));

// Mock WalletError class
vi.mock("../utils/walletAdapters", () => ({
  WalletError: class extends Error {
    constructor(
      message: string,
      public code: string,
      public walletType?: string,
    ) {
      super(message);
      this.name = "WalletError";
    }
  },
}));

describe("WalletSelector", () => {
  let mockOnConnect: (publicKey: string) => void;
  let mockOnError: (error: string) => void;

  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();

    mockOnConnect = vi.fn<(publicKey: string) => void>();
    mockOnError = vi.fn<(error: string) => void>();

    // Default mock implementations
    mockWalletManager.getAvailableWallets.mockReturnValue([
      mockFreighterAdapter,
      mockRabetAdapter,
      mockXBullAdapter,
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  describe("Component rendering", () => {
    it("should render available wallet options", () => {
      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      expect(screen.getByText("Freighter")).toBeTruthy();
      expect(screen.getByText("Rabet")).toBeTruthy();
      expect(screen.getByText("xBull")).toBeTruthy();
    });

    it("should render no wallets message when no wallets are available", () => {
      mockWalletManager.getAvailableWallets.mockReturnValue([]);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      expect(
        screen.getByText(
          "No Stellar wallets detected. Please install Freighter, Rabet, or xBull wallet extension.",
        ),
      ).toBeTruthy();
    });

    it("should render wallet buttons with proper styling", () => {
      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const walletButtons = screen.getAllByRole("button");
      expect(walletButtons).toHaveLength(3);

      walletButtons.forEach((button) => {
        expect(button).toHaveClass(
          "w-full",
          "flex",
          "items-center",
          "justify-between",
          "p-4",
          "border",
          "border-gray-200",
        );
      });
    });
  });

  describe("Successful wallet connection", () => {
    it("should successfully connect to Freighter wallet", async () => {
      const testPublicKey =
        "GAfreightertest1234567890abcdef1234567890abcdef1234567890abcdef";
      mockWalletManager.connect.mockResolvedValue(testPublicKey);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const freighterButton = screen.getByText("Freighter").closest("button");
      expect(freighterButton).toBeTruthy();

      fireEvent.click(freighterButton!);

      // Should show connecting state
      expect(screen.getByText("Connecting...")).toBeTruthy();
      expect(freighterButton).toBeDisabled();

      await waitFor(() => {
        expect(mockWalletManager.connect).toHaveBeenCalledWith("freighter");
        expect(mockOnConnect).toHaveBeenCalledWith(testPublicKey);
        expect(mockOnError).not.toHaveBeenCalled();
      });
    });

    it("should successfully connect to Rabet wallet", async () => {
      const testPublicKey =
        "GArabettest1234567890abcdef1234567890abcdef1234567890abcdef";
      mockWalletManager.connect.mockResolvedValue(testPublicKey);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const rabetButton = screen.getByText("Rabet").closest("button");
      expect(rabetButton).toBeTruthy();

      fireEvent.click(rabetButton!);

      await waitFor(() => {
        expect(mockWalletManager.connect).toHaveBeenCalledWith("rabet");
        expect(mockOnConnect).toHaveBeenCalledWith(testPublicKey);
        expect(mockOnError).not.toHaveBeenCalled();
      });
    });

    it("should successfully connect to xBull wallet", async () => {
      const testPublicKey =
        "GAxbulltest1234567890abcdef1234567890abcdef1234567890abcdef";
      mockWalletManager.connect.mockResolvedValue(testPublicKey);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const xBullButton = screen.getByText("xBull").closest("button");
      expect(xBullButton).toBeTruthy();

      fireEvent.click(xBullButton!);

      await waitFor(() => {
        expect(mockWalletManager.connect).toHaveBeenCalledWith("xbull");
        expect(mockOnConnect).toHaveBeenCalledWith(testPublicKey);
        expect(mockOnError).not.toHaveBeenCalled();
      });
    });

    it("should display wallet address after successful connection", async () => {
      const testPublicKey =
        "GAfreightertest1234567890abcdef1234567890abcdef1234567890abcdef";
      mockWalletManager.connect.mockResolvedValue(testPublicKey);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const freighterButton = screen.getByText("Freighter").closest("button");
      fireEvent.click(freighterButton!);

      await waitFor(() => {
        expect(mockOnConnect).toHaveBeenCalledWith(testPublicKey);
      });

      // Verify the public key was passed to the onConnect callback
      expect(mockOnConnect).toHaveBeenCalledWith(
        "GAfreightertest1234567890abcdef1234567890abcdef1234567890abcdef",
      );
    });
  });

  describe("Wallet connection errors", () => {
    it("should handle wallet not installed error", async () => {
      const walletError = new Error("Freighter wallet is not installed");
      (walletError as any).code = "WALLET_NOT_INSTALLED";
      (walletError as any).walletType = "freighter";

      mockWalletManager.connect.mockRejectedValue(walletError);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const freighterButton = screen.getByText("Freighter").closest("button");
      fireEvent.click(freighterButton!);

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith(
          "freighter is not installed. Please install it and refresh.",
        );
        expect(mockOnConnect).not.toHaveBeenCalled();
      });
    });

    it("should handle user declined connection error", async () => {
      const walletError = new Error("User declined connection");
      (walletError as any).code = "USER_DECLINED";

      mockWalletManager.connect.mockRejectedValue(walletError);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const rabetButton = screen.getByText("Rabet").closest("button");
      fireEvent.click(rabetButton!);

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith(
          "Connection was declined. Please approve in your wallet.",
        );
        expect(mockOnConnect).not.toHaveBeenCalled();
      });
    });

    it("should handle network mismatch error", async () => {
      const walletError = new Error("Network mismatch");
      (walletError as any).code = "NETWORK_MISMATCH";

      mockWalletManager.connect.mockRejectedValue(walletError);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const xBullButton = screen.getByText("xBull").closest("button");
      fireEvent.click(xBullButton!);

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith(
          "Network mismatch. Please check your wallet network settings.",
        );
        expect(mockOnConnect).not.toHaveBeenCalled();
      });
    });

    it("should handle timeout error", async () => {
      const walletError = new Error("Connection timeout");
      (walletError as any).code = "TIMEOUT";

      mockWalletManager.connect.mockRejectedValue(walletError);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const freighterButton = screen.getByText("Freighter").closest("button");
      fireEvent.click(freighterButton!);

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith(
          "Connection timed out. Please try again.",
        );
        expect(mockOnConnect).not.toHaveBeenCalled();
      });
    });

    it("should handle generic connection error", async () => {
      const genericError = new Error("Something went wrong");

      mockWalletManager.connect.mockRejectedValue(genericError);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const rabetButton = screen.getByText("Rabet").closest("button");
      fireEvent.click(rabetButton!);

      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith("Something went wrong");
        expect(mockOnConnect).not.toHaveBeenCalled();
      });
    });
  });

  describe("Connection state management", () => {
    it("should show connecting state during connection attempt", async () => {
      mockWalletManager.connect.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const freighterButton = screen.getByText("Freighter").closest("button");
      fireEvent.click(freighterButton!);

      // Should immediately show connecting state
      expect(screen.getByText("Connecting...")).toBeTruthy();
      expect(freighterButton).toBeDisabled();
    });

    it("should reset connecting state after successful connection", async () => {
      mockWalletManager.connect.mockResolvedValue(
        "GAfreightertest1234567890abcdef1234567890abcdef1234567890abcdef",
      );

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const freighterButton = screen.getByText("Freighter").closest("button");
      fireEvent.click(freighterButton!);

      await waitFor(() => {
        expect(freighterButton).not.toBeDisabled();
        expect(screen.queryByText("Connecting...")).not.toBeInTheDocument();
      });
    });

    it("should reset connecting state after failed connection", async () => {
      mockWalletManager.connect.mockRejectedValue(
        new Error("Connection failed"),
      );

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const freighterButton = screen.getByText("Freighter").closest("button");
      fireEvent.click(freighterButton!);

      await waitFor(() => {
        expect(freighterButton).not.toBeDisabled();
        expect(screen.queryByText("Connecting...")).not.toBeInTheDocument();
      });
    });
  });

  describe("Not-installed wallet state", () => {
    it("should render install guidance when wallet is not installed", () => {
      // Mock that no wallets are available
      mockWalletManager.getAvailableWallets.mockReturnValue([]);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      expect(
        screen.getByText(
          "No Stellar wallets detected. Please install Freighter, Rabet, or xBull wallet extension.",
        ),
      ).toBeTruthy();
    });

    it("should show proper styling for no wallets state", () => {
      mockWalletManager.getAvailableWallets.mockReturnValue([]);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const warningContainer = screen
        .getByText(
          "No Stellar wallets detected. Please install Freighter, Rabet, or xBull wallet extension.",
        )
        .closest("div");
      expect(warningContainer).toHaveClass(
        "p-4",
        "border",
        "rounded-lg",
        "bg-yellow-50",
      );
    });
  });

  describe("Multiple wallet interactions", () => {
    it("should handle multiple wallet connection attempts", async () => {
      // Clear previous mock calls
      vi.clearAllMocks();

      mockWalletManager.connect
        .mockResolvedValueOnce(
          "GAfreightertest1234567890abcdef1234567890abcdef1234567890abcdef",
        )
        .mockRejectedValueOnce(new Error("Already connected"));

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      // First connection
      const freighterButton = screen.getByText("Freighter").closest("button");
      fireEvent.click(freighterButton!);

      await waitFor(() => {
        expect(mockOnConnect).toHaveBeenCalledWith(
          "GAfreightertest1234567890abcdef1234567890abcdef1234567890abcdef",
        );
      });

      // Second connection attempt
      const rabetButton = screen.getByText("Rabet").closest("button");
      fireEvent.click(rabetButton!);

      await waitFor(() => {
        expect(mockWalletManager.connect).toHaveBeenCalledTimes(2);
      });
    });

    it("should disable only the currently connecting wallet button", async () => {
      mockWalletManager.connect.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const freighterButton = screen.getByText("Freighter").closest("button");
      const rabetButton = screen.getByText("Rabet").closest("button");

      fireEvent.click(freighterButton!);

      // Only freighter button should be disabled
      expect(freighterButton).toBeDisabled();
      expect(rabetButton).not.toBeDisabled();
    });
  });

  describe("Edge cases", () => {
    it("should handle empty public key response", async () => {
      mockWalletManager.connect.mockResolvedValue("");

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const freighterButton = screen.getByText("Freighter").closest("button");
      fireEvent.click(freighterButton!);

      await waitFor(() => {
        expect(mockOnConnect).toHaveBeenCalledWith("");
        expect(mockOnError).not.toHaveBeenCalled();
      });
    });

    it("should handle null/undefined wallet manager responses", async () => {
      mockWalletManager.connect.mockResolvedValue(null as any);

      render(
        <WalletSelector onConnect={mockOnConnect} onError={mockOnError} />,
      );

      const freighterButton = screen.getByText("Freighter").closest("button");
      fireEvent.click(freighterButton!);

      await waitFor(() => {
        expect(mockOnConnect).toHaveBeenCalledWith(null);
        expect(mockOnError).not.toHaveBeenCalled();
      });
    });
  });
});
