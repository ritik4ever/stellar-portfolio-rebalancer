import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PortfolioWizard from './PortfolioWizard';
import { api } from '../config/api';

// Mock framer-motion to simplify DOM structure
vi.mock('framer-motion', () => ({
  motion: {
    div: (props: any) => React.createElement('div', props, props.children),
    p: (props: any) => React.createElement('p', props, props.children),
  },
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

vi.mock('../components/ThemeToggle', () => ({ default: () => null }));
vi.mock('../components/AssetSelector', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
    React.createElement('select', {
      value,
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value),
    }, [
      React.createElement('option', { key: 'XLM', value: 'XLM' }, 'XLM'),
      React.createElement('option', { key: 'USDC', value: 'USDC' }, 'USDC'),
      React.createElement('option', { key: 'BTC', value: 'BTC' }, 'BTC'),
      React.createElement('option', { key: 'ETH', value: 'ETH' }, 'ETH'),
    ]),
}));

const mockMutateAsync = vi.fn();
vi.mock('../hooks/mutations/usePortfolioMutations', () => ({
  useCreatePortfolioMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

const mockPost = vi.fn();
vi.mock('../config/api', () => ({
  api: {
    post: (...args: any[]) => mockPost(...args),
  },
  ENDPOINTS: {
    PORTFOLIO_SHARE: (id: string) => `/portfolio/${id}/share`,
  },
}));

vi.mock('../utils/walletManager', () => ({
  walletManager: {
    signTransaction: vi.fn().mockResolvedValue('signed-mock-xdr'),
  },
}));

function renderWizard(publicKey: string | null = 'GBTEST...') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onNavigate = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <PortfolioWizard onNavigate={onNavigate} publicKey={publicKey} />
    </QueryClientProvider>
  );
  return { ...utils, onNavigate };
}

describe('PortfolioWizard Page', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders Step 1 with template options and allow moving to Step 2', async () => {
    renderWizard();
    
    expect(screen.getByText('Step 1: Choose a Template')).toBeInTheDocument();
    expect(screen.getByText('Conservative Growth')).toBeInTheDocument();
    expect(screen.getByText('Balanced Growth')).toBeInTheDocument();
    expect(screen.getByText('Aggressive Alt')).toBeInTheDocument();
    expect(screen.getByText('Custom Setup')).toBeInTheDocument();

    const nextButton = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextButton);

    // Expect to be on Step 2
    expect(screen.getByText('Step 2: Add Assets & Allocations')).toBeInTheDocument();
  });

  it('validates Step 2 live allocation sum and blocks navigation if sum is not 100%', async () => {
    renderWizard();
    
    // Go to Step 2
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // By default, custom template has XLM: 100%, which is valid
    expect(screen.getByText('Total Allocations: 100%')).toBeInTheDocument();
    
    // Update XLM to 50%
    const input = screen.getByPlaceholderText('0');
    fireEvent.change(input, { target: { value: '50' } });

    // Expect allocations sum to show 50% remaining
    expect(screen.getByText('Allocations: 50% (50% remaining)')).toBeInTheDocument();

    // Next button should be disabled when total is not 100%
    const nextButton = screen.getByRole('button', { name: /next/i });
    expect(nextButton).toBeDisabled();
  });

  it('allows configuring automation rules in Step 3', async () => {
    renderWizard();
    
    // Go to Step 2
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Go to Step 3 (total is 100% by default, so it can advance)
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText('Step 3: Configure Automation Rules')).toBeInTheDocument();

    // Verify cooldown input field is present and mutable
    const cooldownInput = screen.getByRole('spinbutton');
    expect(cooldownInput).toHaveValue(24);
    fireEvent.change(cooldownInput, { target: { value: '48' } });
    expect(cooldownInput).toHaveValue(48);
  });

  it('shows summary and signs using Freighter in Step 4 and shows success in Step 5', async () => {
    mockMutateAsync.mockResolvedValue({ id: 'portfolio-123' });
    mockPost.mockResolvedValue({ hash: 'share-abc' });

    const { onNavigate } = renderWizard('GBTEST...');
    
    // Step 1 -> Step 2
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Step 2 -> Step 3
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Step 3 -> Step 4
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText('Step 4: Review & Sign')).toBeInTheDocument();
    expect(screen.getByText('Wallet Connected')).toBeInTheDocument();

    const signButton = screen.getByRole('button', { name: /sign with freighter/i });
    fireEvent.click(signButton);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        userAddress: 'GBTEST...',
        allocations: { XLM: 100 },
        threshold: 5,
        cooldownHours: 24,
        autoRebalance: true,
        strategy: 'threshold'
      });
      expect(mockPost).toHaveBeenCalledWith('/portfolio/portfolio-123/share');
    });

    // Advance to Step 5 Success Screen
    expect(screen.getByText('Portfolio Created Successfully!')).toBeInTheDocument();
    expect(screen.getByText('portfolio-123')).toBeInTheDocument();

    const doneButton = screen.getByRole('button', { name: /go to dashboard/i });
    fireEvent.click(doneButton);
    expect(onNavigate).toHaveBeenCalledWith('dashboard');
  });

  it('preserves form data when navigating backward and forward', async () => {
    renderWizard();

    // Go to Step 2
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Change XLM allocation to 100%
    const input = screen.getByPlaceholderText('0');
    fireEvent.change(input, { target: { value: '80' } });

    // Go back to Step 1
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText('Step 1: Choose a Template')).toBeInTheDocument();

    // Go forward to Step 2 again
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText('Step 2: Add Assets & Allocations')).toBeInTheDocument();

    // Verify 80% is preserved
    const restoredInput = screen.getByPlaceholderText('0');
    expect(restoredInput).toHaveValue(80);
  });
});
