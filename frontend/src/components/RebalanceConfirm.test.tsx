import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Isolated doubles for wallet / API modules. These are hoisted by Vitest so
// they are available before the component module is imported.
// ---------------------------------------------------------------------------
const mockWallet = {
  address: '0xabc0000000000000000000000000000000000001',
  connected: true,
  signTransaction: vi.fn(),
};

vi.mock('../wallet', () => ({
  useWallet: () => mockWallet,
  getWallet: () => mockWallet,
}));

vi.mock('../api', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Query / mutation hook doubles.
// ---------------------------------------------------------------------------
const mockUseRebalancePlan = vi.fn();
const mockMutateAsync = vi.fn();

vi.mock('../hooks/useRebalancePlan', () => ({
  useRebalancePlan: (...args: unknown[]) => mockUseRebalancePlan(...args),
}));

vi.mock('../hooks/useExecuteRebalanceMutation', () => ({
  useExecuteRebalanceMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

// Imported after mocks are registered.
import RebalanceConfirm from './RebalanceConfirm';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const NOW = new Date('2026-04-01T12:00:00.000Z').getTime();

function makeTrade(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `trade-${index}`,
    symbol: `ASSET${index}`,
    side: index % 2 === 0 ? 'BUY' : 'SELL',
    quantity: 10 + index,
    quotedPrice: 100 + index,
    estimatedFee: 0.5 + index * 0.1,
    quoteTimestamp: NOW - index * 1000,
    ...overrides,
  };
}

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    trades: [],
    estimatedFees: 0,
    quoteTimestamp: NOW,
    ...overrides,
  };
}

function setPlan(plan: unknown) {
  mockUseRebalancePlan.mockReturnValue({
    data: plan,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  mockUseRebalancePlan.mockReset();
  mockMutateAsync.mockReset();
  mockWallet.signTransaction.mockReset();
  setPlan(makePlan());
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// (1) Empty plan
// ---------------------------------------------------------------------------
describe('RebalanceConfirm — empty plan', () => {
  it('renders the read-only preview, a Close button, and no Confirm button', () => {
    setPlan(makePlan({ trades: [], estimatedFees: 0 }));

    render(<RebalanceConfirm planId="plan-1" onClose={vi.fn()} />);

    expect(screen.getByText(/no trades/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /confirm/i }),
    ).not.toBeInTheDocument();
  });

  it('invokes onClose when Close is clicked', async () => {
    const onClose = vi.fn();
    setPlan(makePlan({ trades: [] }));

    render(<RebalanceConfirm planId="plan-1" onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// (2) Many trades
// ---------------------------------------------------------------------------
describe('RebalanceConfirm — many trades', () => {
  it('renders every quoted trade, the scroll hint, estimated fees, and oldest price age', () => {
    const trades = Array.from({ length: 7 }, (_, i) => makeTrade(i));
    const totalFees = trades.reduce((sum, t) => sum + t.estimatedFee, 0);
    // Oldest quote is 6 seconds before NOW.
    setPlan(
      makePlan({
        trades,
        estimatedFees: totalFees,
        quoteTimestamp: NOW - 6000,
      }),
    );

    render(<RebalanceConfirm planId="plan-1" onClose={vi.fn()} />);

    for (const trade of trades) {
      expect(screen.getByText(trade.symbol)).toBeInTheDocument();
    }

    expect(screen.getByText(/scroll/i)).toBeInTheDocument();
    expect(screen.getByText(/estimated fees/i)).toBeInTheDocument();
    expect(screen.getByText(/\$5\.60/)).toBeInTheDocument();
    // Oldest price age = 6s.
    expect(screen.getByText(/6s ago/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (3) Price age + quote change before approval
// ---------------------------------------------------------------------------
describe('RebalanceConfirm — price age and quote changes', () => {
  it('updates the displayed price age as the 15s interval ticks', () => {
    setPlan(
      makePlan({
        trades: [makeTrade(0)],
        quoteTimestamp: NOW,
      }),
    );

    render(<RebalanceConfirm planId="plan-1" onClose={vi.fn()} />);

    expect(screen.getByText(/0s ago/i)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(15000);
    });

    expect(screen.getByText(/15s ago/i)).toBeInTheDocument();
  });

  it('reflects a new quote timestamp and gates confirmation on re-acknowledgement', async () => {
    const initialPlan = makePlan({
      trades: [makeTrade(0, { quoteTimestamp: NOW })],
      quoteTimestamp: NOW,
    });
    setPlan(initialPlan);

    const { rerender } = render(
      <RebalanceConfirm planId="plan-1" onClose={vi.fn()} />,
    );

    // Acknowledge the initial quote.
    const ack = screen.getByRole('checkbox', { name: /acknowledge/i });
    await userEvent.click(ack);
    expect(ack).toBeChecked();

    // Quote changes (e.g. prices refreshed) before approval.
    const refreshedPlan = makePlan({
      trades: [makeTrade(0, { quoteTimestamp: NOW - 3000 })],
      quoteTimestamp: NOW - 3000,
    });
    setPlan(refreshedPlan);
    rerender(<RebalanceConfirm planId="plan-1" onClose={vi.fn()} />);

    // Age reflects the new quote.
    expect(screen.getByText(/3s ago/i)).toBeInTheDocument();
    // Acknowledgement is reset because the quote changed.
    expect(
      screen.getByRole('checkbox', { name: /acknowledge/i }),
    ).not.toBeChecked();
    // Confirm is disabled until re-acknowledged.
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();

    await userEvent.click(
      screen.getByRole('checkbox', { name: /acknowledge/i }),
    );
    expect(screen.getByRole('button', { name: /confirm/i })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// (4) Submission failure
// ---------------------------------------------------------------------------
describe('RebalanceConfirm — submission failure', () => {
  it('shows the alert, resets acknowledgement, and allows retry', async () => {
    setPlan(
      makePlan({
        trades: [makeTrade(0)],
        quoteTimestamp: NOW,
      }),
    );
    mockMutateAsync.mockRejectedValueOnce(new Error('network down'));

    render(<RebalanceConfirm planId="plan-1" onClose={vi.fn()} />);

    await userEvent.click(
      screen.getByRole('checkbox', { name: /acknowledge/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/network down/i);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('checkbox', { name: /acknowledge/i }),
    ).not.toBeChecked();

    // Retry succeeds.
    mockMutateAsync.mockResolvedValueOnce({ ok: true });
    await userEvent.click(
      screen.getByRole('checkbox', { name: /acknowledge/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2);
    });
  });
});

// ---------------------------------------------------------------------------
// (5) No duplicate submission
// ---------------------------------------------------------------------------
describe('RebalanceConfirm — no duplicate submission', () => {
  it('calls mutateAsync only once on rapid double-click and shows in-flight status', async () => {
    setPlan(
      makePlan({
        trades: [makeTrade(0)],
        quoteTimestamp: NOW,
      }),
    );

    let resolveSubmit: (value: unknown) => void = () => {};
    mockMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    render(<RebalanceConfirm planId="plan-1" onClose={vi.fn()} />);

    await userEvent.click(
      screen.getByRole('checkbox', { name: /acknowledge/i }),
    );

    const confirm = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/submitting/i);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSubmit({ ok: true });
    });

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });
});