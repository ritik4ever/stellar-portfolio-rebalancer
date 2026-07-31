import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockAssets = [
  {
    symbol: 'XLM',
    name: 'Stellar Lumens',
    type: 'native' as const,
    domain: undefined,
    issuer: undefined,
    displayName: 'XLM (Stellar Lumens)',
    searchText: 'xlm stellar lumens native'
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    domain: 'centre.io',
    type: 'credit_alphanum4' as const,
    displayName: 'USDC (USD Coin)',
    searchText: 'usdc usd coin centre.io ga5zsejyb37jrc5avcia5mop4rhtm335x2kgx3ihojapp5re34k4kzvn'
  }
];

vi.mock('../../hooks/queries/useAssetsQuery', () => ({
  useAssets: () => ({ data: mockAssets, isLoading: false })
}));

import AssetSelector from '../AssetSelector';

function renderSelector(props: { value?: string; onChange?: (v: string) => void }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onChange = props.onChange ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <AssetSelector value={props.value ?? ''} onChange={onChange} />
    </QueryClientProvider>
  );
  return { ...utils, onChange };
}

describe('AssetSelector', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the trigger button with placeholder', () => {
    renderSelector({});
    expect(screen.getByText('Select asset...')).toBeInTheDocument();
  });

  it('shows dropdown with assets on click', () => {
    renderSelector({});
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByPlaceholderText('Search assets, issuers, or domains...')).toBeInTheDocument();
    expect(screen.getByText('XLM')).toBeInTheDocument();
    expect(screen.getByText('USDC')).toBeInTheDocument();
  });

  it('filters assets by symbol match (code)', async () => {
    renderSelector({});
    fireEvent.click(screen.getByRole('button'));
    const input = screen.getByPlaceholderText('Search assets, issuers, or domains...');
    fireEvent.change(input, { target: { value: 'XLM' } });
    await waitFor(() => {
      expect(screen.getByText('XLM')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText('USDC')).not.toBeInTheDocument();
    });
  });

  it('returns assets matching issuer domain', async () => {
    renderSelector({});
    fireEvent.click(screen.getByRole('button'));
    const input = screen.getByPlaceholderText('Search assets, issuers, or domains...');
    fireEvent.change(input, { target: { value: 'centre.io' } });
    await waitFor(() => {
      expect(screen.getByText('USDC')).toBeInTheDocument();
      expect(screen.getByText('Domain match')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText('XLM')).not.toBeInTheDocument();
    });
  });

  it('shows no results message when query does not match', async () => {
    renderSelector({});
    fireEvent.click(screen.getByRole('button'));
    const input = screen.getByPlaceholderText('Search assets, issuers, or domains...');
    fireEvent.change(input, { target: { value: 'ZZZZZZ' } });
    await waitFor(() => {
      expect(screen.getByText(/No assets found/i)).toBeInTheDocument();
    });
  });

  it('calls onChange when an asset is selected', () => {
    const { onChange } = renderSelector({});
    fireEvent.click(screen.getByRole('button'));
    const option = screen.getByText('XLM');
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('XLM');
  });
});
