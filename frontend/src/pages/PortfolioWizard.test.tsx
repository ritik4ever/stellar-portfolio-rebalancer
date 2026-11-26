import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { clearWizardDraft, saveWizardDraft, loadWizardDraft } from '../utils/wizardDraft';
import { walletManager } from '../utils/walletManager';
import i18n from '../i18n';
import userEvent from '@testing-library/user-event';

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

// In-memory draft storage to avoid broken localStorage in jsdom
const mockDraft = { current: null as any };
vi.mock('../utils/wizardDraft', () => ({
  saveWizardDraft: vi.fn((draft: any) => {
    mockDraft.current = draft;
  }),
  loadWizardDraft: vi.fn(() => {
    return mockDraft.current;
  }),
  clearWizardDraft: vi.fn(() => {
    mockDraft.current = null;
  }),
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
    mockDraft.current = null;
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

  it('shows and validates the DCA schedule, then submits it in the payload', async () => {
    mockMutateAsync.mockResolvedValue({ id: 'dca-portfolio' });
    mockPost.mockResolvedValue({ hash: 'dca-share' });

    renderWizard('GBDCA...');
    fireEvent.change(screen.getByLabelText(/rebalancing strategy/i), { target: { value: 'dca' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText('Step 4: Configure DCA Schedule')).toBeInTheDocument();
    const amountInput = screen.getByLabelText('DCA Amount');
    fireEvent.change(amountInput, { target: { value: '0' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/stated range/i);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();

    fireEvent.change(amountInput, { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText(/interval \(days\)/i), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText('Step 5: Review & Sign')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sign with freighter/i }));
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        strategy: 'dca',
        strategyConfig: {
          dcaAmount: 250,
          dcaIntervalDays: 14,
          dcaStartDate: '2026-09-01',
        },
      }));
    });
  });

  it('requires amount review after a language change without losing other edits or submitting twice', async () => {
    mockMutateAsync.mockResolvedValue({ id: 'dca-portfolio' });
    mockPost.mockResolvedValue({ hash: 'dca-share' });
    renderWizard();
    fireEvent.change(screen.getByLabelText(/rebalancing strategy/i), { target: { value: 'dca' } });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const amount = screen.getByLabelText('DCA Amount');
    fireEvent.change(screen.getByLabelText(/interval \(days\)/i), { target: { value: '14' } });
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: '250.5' } });
    await i18n.changeLanguage('de');
    expect(await screen.findByText(/language changed while editing/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    expect(screen.getByLabelText(/interval \(days\)/i)).toHaveValue(14);
    expect(amount).toHaveValue('250.5');
    fireEvent.click(screen.getByRole('button', { name: /confirm amount/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign with freighter/i }));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      strategyConfig: expect.objectContaining({ dcaAmount: 250.5, dcaIntervalDays: 14 }),
    }));
    await i18n.changeLanguage('en');
  });

  it('allows correcting the amount after a language change', async () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText(/rebalancing strategy/i), { target: { value: 'dca' } });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const amount = screen.getByLabelText('DCA Amount');
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: '12' } });
    await i18n.changeLanguage('de');
    expect(await screen.findByText(/language changed while editing/i)).toBeInTheDocument();
    fireEvent.focus(amount);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    fireEvent.change(amount, { target: { value: '15' } });
    expect(screen.queryByText(/language changed while editing/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
    await i18n.changeLanguage('en');
  });

  it('covers keyboard focus, names, and announcements for a decimal comma locale and high-precision token amount', async () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText(/rebalancing strategy/i), { target: { value: 'dca' } });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const amountInput = screen.getByLabelText('DCA Amount');
    expect(amountInput).toHaveAttribute('inputmode', 'decimal');

    // Switch to German (decimal comma locale)
    await i18n.changeLanguage('de');

    // Enter high-precision amount (7 decimal places / stroop)
    fireEvent.change(amountInput, { target: { value: '0,0000001' } });
    expect(screen.getByText(/formatted \(de\): 0,0000001/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Localized amount: 0,0000001')).toBeInTheDocument();

    // Enter large amount with decimals
    fireEvent.change(amountInput, { target: { value: '1234,5678' } });
    expect(screen.getByText(/formatted \(de\): 1\.234,5678/i)).toBeInTheDocument();

    // Verify accessible description includes helper and formatted display
    expect(amountInput).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('dca-amount-help')
    );
    expect(amountInput).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('dca-amount-localized-display')
    );

    // Verify review summary displays DCA schedule with accessible label
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByLabelText(/dca schedule: 1234\.5678 every 7 days/i)).toBeInTheDocument();

    await i18n.changeLanguage('en');
  });

  it('manages keyboard focus, alerts, and live announcements during a locale change during edit', async () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText(/rebalancing strategy/i), { target: { value: 'dca' } });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const amountInput = screen.getByLabelText('DCA Amount');
    fireEvent.focus(amountInput);
    fireEvent.change(amountInput, { target: { value: '500.25' } });

    // Locale change during edit
    await i18n.changeLanguage('de');

    // Screen reader alert & live region announcement
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/language changed while editing/i);
    expect(screen.getByRole('status')).toHaveTextContent(/language changed to de while editing/i);
    expect(amountInput).toHaveAttribute('aria-invalid', 'true');
    expect(amountInput).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('dca-amount-locale-review')
    );

    // Confirm amount button is keyboard operable and restores focus
    const confirmBtn = screen.getByRole('button', { name: /confirm amount/i });
    expect(confirmBtn).toBeInTheDocument();
    confirmBtn.focus();
    expect(confirmBtn).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/dca amount confirmed/i);
    expect(amountInput).toHaveFocus();
    expect(amountInput).toHaveAttribute('aria-invalid', 'false');

    await i18n.changeLanguage('en');
  });

  it('allows keyboard and screen-reader users to abandon the wizard flow', async () => {
    const { onNavigate } = renderWizard();

    // Abandon via header button with keyboard
    const headerAbandonBtn = screen.getByRole('button', { name: /abandon wizard and return to dashboard/i });
    expect(headerAbandonBtn).toBeInTheDocument();
    headerAbandonBtn.focus();
    expect(headerAbandonBtn).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('dashboard');

    // Abandon via footer Cancel button with keyboard
    const cancelBtn = screen.getByRole('button', { name: /cancel and abandon wizard/i });
    expect(cancelBtn).toBeInTheDocument();
    cancelBtn.focus();
    expect(cancelBtn).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it('announces localized amount in polite live region during ordinary edits', async () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText(/rebalancing strategy/i), { target: { value: 'dca' } });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const amountInput = screen.getByLabelText('DCA Amount');
    fireEvent.change(amountInput, { target: { value: '150.5' } });
    expect(screen.getByRole('status')).toHaveTextContent(/dca amount: 150\.5/i);
  });

  it('aborts portfolio creation if user cancels while wallet signature is pending', async () => {
    mockMutateAsync.mockResolvedValue({ id: 'dca-portfolio' });
    let resolveSign: (val: any) => void;
    const signSpy = vi.spyOn(walletManager, 'signTransaction').mockImplementation(() => {
      return new Promise((resolve) => {
        resolveSign = resolve;
      });
    });

    try {
      const { onNavigate } = renderWizard();
      for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }));

      const signButton = screen.getByRole('button', { name: /sign with freighter/i });
      fireEvent.click(signButton);
      expect(signButton).toHaveAttribute('aria-busy', 'true');

      // Cancel while wallet signing is pending using keyboard
      const cancelBtn = screen.getByRole('button', { name: /cancel and abandon wizard/i });
      cancelBtn.focus();
      expect(cancelBtn).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      expect(onNavigate).toHaveBeenCalledWith('dashboard');

      // Resolve signing after user has cancelled
      resolveSign!('mock-signature');
      await waitFor(() => {
        expect(mockMutateAsync).not.toHaveBeenCalled();
      });
    } finally {
      signSpy.mockRestore();
    }
  });

  it('explains decimal-comma boundaries and submits the canonical seven-place amount', async () => {
    await i18n.changeLanguage('de');
    mockMutateAsync.mockResolvedValue({ id: 'dca-portfolio' });
    mockPost.mockResolvedValue({ hash: 'dca-share' });
    renderWizard();
    fireEvent.change(screen.getByLabelText(/rebalancing strategy/i), { target: { value: 'dca' } });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const amount = screen.getByLabelText('DCA Amount');
    expect(amount).toHaveAccessibleDescription(/0,0000001 to 200000000.*7 decimal places.*“,”/i);
    for (const invalid of ['0', '0,00000001', '200000001', '1.5', '1,2,3']) {
      fireEvent.change(amount, { target: { value: invalid } });
      expect(amount).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    }
    fireEvent.change(amount, { target: { value: '0,0000001' } });
    expect(amount).toHaveAttribute('aria-invalid', 'false');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign with freighter/i }));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      strategyConfig: expect.objectContaining({ dcaAmount: 0.0000001 }),
    })));
    await i18n.changeLanguage('en');
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

  it('restores wizard draft after simulated page reload', async () => {
    cleanup();
    vi.clearAllMocks();
    mockDraft.current = null;

    // Simulate completing step 2 and saving a draft
    saveWizardDraft({
      step: 2,
      selectedTemplateId: 'custom',
      allocations: [{ asset: 'XLM', percentage: 60 }],
      threshold: 5,
      cooldown: 24,
      autoRebalance: true,
      savedAt: new Date().toISOString(),
    });
    expect(mockDraft.current).not.toBeNull();

    // Mount wizard - should detect the saved draft and show resume prompt
    const { onNavigate } = renderWizard();

    await waitFor(() => {
      expect(screen.getByText(/Resume where you left off/i)).toBeInTheDocument();
    });

    // Click resume
    fireEvent.click(screen.getByRole('button', { name: /resume draft/i }));

    // Should be on step 2 with allocation preserved
    await waitFor(() => {
      expect(screen.getByText('Step 2: Add Assets & Allocations')).toBeInTheDocument();
    });
    const restoredInput = screen.getByPlaceholderText('0');
    expect(restoredInput).toHaveValue(60);

    // Clean up draft
    clearWizardDraft();
  });
});
