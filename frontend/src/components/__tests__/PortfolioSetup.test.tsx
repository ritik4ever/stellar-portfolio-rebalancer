import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../hooks/queries/useAssetsQuery', () => ({
  useAssets: () => ({ data: [{ symbol: 'XLM' }, { symbol: 'USDC' }], isLoading: false })
}))

vi.mock('../../hooks/mutations/usePortfolioMutations', () => ({
  useCreatePortfolioMutation: () => ({ mutateAsync: async () => ({}), isPending: false }),
  loadPortfolioCloneDraft: vi.fn().mockReturnValue(null),
  clearPortfolioCloneDraft: vi.fn(),
}))

import PortfolioSetup from '../PortfolioSetup'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('PortfolioSetup quick-start empty state', () => {
  it('shows quick-start panel when no saved templates exist', () => {
    localStorage.clear()
    renderWithProviders(<PortfolioSetup onNavigate={() => {}} publicKey={null} />)
    expect(screen.getByText(/Quick start/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Try Balanced Template/i })).toBeTruthy()
  })
})
