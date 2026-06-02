import React from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../hooks/queries/useAssetsQuery', () => ({
  useAssets: () => ({ data: [{ symbol: 'XLM' }, { symbol: 'USDC' }], isLoading: false })
}))

vi.mock('../../hooks/mutations/usePortfolioMutations', () => ({
  useCreatePortfolioMutation: () => ({ mutateAsync: async () => ({}), isPending: false })
}))

import PortfolioSetup from '../PortfolioSetup'

describe('PortfolioSetup quick-start empty state', () => {
  it('shows quick-start panel when no saved templates exist', () => {
    // Ensure localStorage is empty for the test
    localStorage.clear()
    render(<PortfolioSetup onNavigate={() => {}} publicKey={null} />)
    expect(screen.getByText(/Quick start/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Try Balanced Template/i })).toBeTruthy()
  })
})
