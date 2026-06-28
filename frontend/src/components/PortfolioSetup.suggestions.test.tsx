import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as rtl from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PortfolioSetup from './PortfolioSetup'

const { cleanup, render } = rtl
const fireEvent = (rtl as any).fireEvent
const screen = (rtl as any).screen

const stripMotionProps = ({
  initial,
  animate,
  exit,
  transition,
  variants,
  layout,
  layoutId,
  ...rest
}: any) => rest

vi.mock('framer-motion', () => ({
  motion: {
    div: (props: any) =>
      React.createElement('div', stripMotionProps(props), props.children),
    p: (props: any) =>
      React.createElement('p', stripMotionProps(props), props.children),
  },
  AnimatePresence: ({ children }: any) =>
    React.createElement(React.Fragment, null, children),
}))

vi.mock('./ThemeToggle', () => ({ default: () => null }))
vi.mock('./AssetSelector', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    React.createElement('select', {
      value,
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
    }),
}))

const mockMutateAsync = vi.fn()
vi.mock('../hooks/mutations/usePortfolioMutations', () => ({
  buildRollbackMessage: (error: unknown, action = 'portfolio update') => {
    const detail = error instanceof Error ? error.message : 'server rejected the update'
    return `Your optimistic ${action} was rolled back because the server rejected it. ${detail} Please try again.`
  },
  useCreatePortfolioMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

vi.mock('../hooks/queries/useAssetsQuery', () => ({
  useAssets: () => ({
    data: [
      { symbol: 'USDC', name: 'USD Coin', domain: 'centre.io' },
      { symbol: 'XLM', name: 'Stellar Lumens' },
      { symbol: 'BTC', name: 'Bitcoin' },
      { symbol: 'ETH', name: 'Ethereum' },
    ],
    isLoading: false,
  }),
}))

function renderSetup(publicKey: string | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  const onNavigate = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <PortfolioSetup onNavigate={onNavigate} publicKey={publicKey} />
    </QueryClientProvider>,
  )

  return { onNavigate }
}

describe('PortfolioSetup suggestions integration', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('applies a suggestion to the allocation editor without submitting', () => {
    renderSetup()

    fireEvent.click(screen.getByRole('button', { name: /custom/i }))

    expect(
      screen.getByText(/reduce concentration risk/i),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))

    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(inputs[0].value).toBe('40')
    expect(inputs[1].value).toBe('25')
    expect(inputs[2].value).toBe('20')
    expect(inputs[3].value).toBe('15')
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })

  it('dismisses a suggestion and removes it from the render tree', () => {
    renderSetup()

    fireEvent.click(screen.getByRole('button', { name: /custom/i }))
    expect(screen.getByText(/reduce concentration risk/i)).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', {
        name: /dismiss reduce concentration risk/i,
      }),
    )

    expect(screen.queryByText(/reduce concentration risk/i)).toBeNull()
  })
})
