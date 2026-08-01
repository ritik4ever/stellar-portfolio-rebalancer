import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import PortfolioSettings from '../PortfolioSettings';

describe('PortfolioSettings Page', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  function renderSettings(props?: { portfolioId?: string }) {
    const onNavigate = vi.fn();
    const utils = render(
      <PortfolioSettings onNavigate={onNavigate} portfolioId={props?.portfolioId} />
    );
    return { ...utils, onNavigate };
  }

  it('renders all settings sections', () => {
    renderSettings();
    expect(screen.getByText('Portfolio Settings')).toBeInTheDocument();
    expect(screen.getByText('Allocations')).toBeInTheDocument();
    expect(screen.getByText('Rebalancing')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Assets')).toBeInTheDocument();
    expect(screen.getByText('Risk Management')).toBeInTheDocument();
    expect(screen.getByText('Danger Zone')).toBeInTheDocument();
  });

  it('displays all default assets', () => {
    renderSettings();
    expect(screen.getByText('XLM')).toBeInTheDocument();
    expect(screen.getByText('USDC')).toBeInTheDocument();
    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('ETH')).toBeInTheDocument();
  });

  it('toggles asset freeze state on click and shows frozen badge', async () => {
    renderSettings();

    const xlmToggle = screen.getByTestId('freeze-toggle-XLM');
    expect(xlmToggle).toHaveAttribute('aria-checked', 'false');

    // Freeze XLM
    fireEvent.click(xlmToggle);
    await waitFor(() => {
      expect(screen.getByTestId('freeze-toggle-XLM')).toHaveAttribute('aria-checked', 'true');
    });
    expect(screen.getByText('Frozen')).toBeInTheDocument();
    expect(screen.getByText(/1 asset frozen/)).toBeInTheDocument();

    // Unfreeze
    fireEvent.click(screen.getByTestId('freeze-toggle-XLM'));
    await waitFor(() => {
      expect(screen.getByTestId('freeze-toggle-XLM')).toHaveAttribute('aria-checked', 'false');
    });
    expect(screen.queryByText('Frozen')).not.toBeInTheDocument();
    expect(screen.queryByText(/1 asset frozen/)).not.toBeInTheDocument();
  });

  it('shows unsaved indicator when freeze state changes', () => {
    renderSettings();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('freeze-toggle-USDC'));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('enables save button only when freeze state has changed', async () => {
    renderSettings();
    const saveButtons = screen.getAllByText('Save');
    // Find the Assets section save button
    const assetSaveBtn = saveButtons.find(
      (btn) => btn.closest('section')?.querySelector('h2')?.textContent === 'Assets'
    );
    expect(assetSaveBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId('freeze-toggle-BTC'));
    await waitFor(() => {
      expect(assetSaveBtn).not.toBeDisabled();
    });
  });

  it('renders with portfolioId in subtitle', () => {
    renderSettings({ portfolioId: 'portfolio-42' });
    expect(screen.getByText(/Configure portfolio #portfolio-42/)).toBeInTheDocument();
  });
});
