import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import AssetSearch from './AssetSearch'

const mockAssets = vi.hoisted(() => [
  { symbol: 'XLM', name: 'Stellar', type: 'native', contract: 'CAS3J7GYLGXMF6WDJ7FW6HZYX5N7G4NHG5IQ7QJ6IKGFL4BQK2KX8A' },
  { symbol: 'USDC', name: 'USD Coin', type: 'credit_alphanum4', issuer: 'GBBD47IF6LWK7P7MDEVLCWREC47RBY4PKY3OK4X6JOJ4YFJK3G43Y6K' },
  { symbol: 'BTC', name: 'Bitcoin', type: 'credit_alphanum4' },
])

vi.mock('../hooks/queries/useAssetsQuery', () => ({
  useAssets: () => ({ data: mockAssets }),
}))

vi.mock('../config/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ assets: [] }),
  },
  ENDPOINTS: { ASSETS: '/api/v1/assets' },
}))

let mockStore: Record<string, string> = {}
const lsMock = {
  getItem: (key: string) => mockStore[key] ?? null,
  setItem: (key: string, value: string) => { mockStore[key] = value },
  removeItem: (key: string) => { delete mockStore[key] },
  clear: () => { mockStore = {} },
  get length() { return Object.keys(mockStore).length },
  key: (index: number) => Object.keys(mockStore)[index] ?? null,
}
vi.stubGlobal('localStorage', lsMock)

describe('AssetSearch', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    mockStore = {}
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    mockStore = {}
  })

  it('persists recent searches to localStorage after selecting an asset', async () => {
    render(
      <AssetSearch value="" onChange={mockOnChange} supportedContracts={[]} />,
    )

    const input = screen.getByRole('searchbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'XLM' } })

    await waitFor(() => {
      expect(screen.getByText('XLM')).toBeInTheDocument()
    })

    const xlmOption = screen.getByText('XLM').closest('button')
    fireEvent.click(xlmOption!)

    const stored = JSON.parse(lsMock.getItem('asset_recent_searches') || '[]')
    expect(stored).toContain('XLM')
  })

  it('shows recent searches when input is focused and empty', () => {
    lsMock.setItem('asset_recent_searches', JSON.stringify(['XLM', 'USDC']))

    render(
      <AssetSearch value="" onChange={mockOnChange} />,
    )

    const input = screen.getByRole('searchbox')
    fireEvent.focus(input)

    expect(screen.getByText('Recent searches')).toBeInTheDocument()
    expect(screen.getByText('XLM')).toBeInTheDocument()
    expect(screen.getByText('USDC')).toBeInTheDocument()
  })

  it('clears recent searches when clear button is clicked', () => {
    lsMock.setItem('asset_recent_searches', JSON.stringify(['XLM', 'USDC']))

    render(
      <AssetSearch value="" onChange={mockOnChange} />,
    )

    const input = screen.getByRole('searchbox')
    fireEvent.focus(input)

    expect(screen.getByText('Recent searches')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Clear'))

    expect(screen.queryByText('Recent searches')).not.toBeInTheDocument()
    expect(lsMock.getItem('asset_recent_searches')).toBeNull()
  })

  it('recent searches display correctly after multiple simulated searches', () => {
    lsMock.setItem('asset_recent_searches', JSON.stringify(['XLM', 'USDC', 'BTC']))

    render(
      <AssetSearch value="" onChange={mockOnChange} />,
    )

    const input = screen.getByRole('searchbox')
    fireEvent.focus(input)

    expect(screen.getByText('Recent searches')).toBeInTheDocument()
    expect(screen.getByText('XLM')).toBeInTheDocument()
    expect(screen.getByText('USDC')).toBeInTheDocument()
    expect(screen.getByText('BTC')).toBeInTheDocument()
  })

  it('limits recent searches to max 10 items', () => {
    const manySearches = Array.from({ length: 15 }, (_, i) => `ASSET${i}`)
    lsMock.setItem('asset_recent_searches', JSON.stringify(manySearches))

    render(
      <AssetSearch value="" onChange={mockOnChange} />,
    )

    const input = screen.getByRole('searchbox')
    fireEvent.focus(input)

    expect(screen.getByText('Recent searches')).toBeInTheDocument()
    const recentButtons = screen.getAllByRole('option')
    expect(recentButtons.length).toBeLessThanOrEqual(10)
  })
})
