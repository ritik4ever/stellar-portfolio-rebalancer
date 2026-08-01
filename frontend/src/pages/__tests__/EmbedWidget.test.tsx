import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import EmbedWidget, { parseWidgetParams } from '../EmbedWidget'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockEndpoints = vi.hoisted(() => ({ PORTFOLIO_SHARE_VIEW: (id: string) => `/share/${id}`, PORTFOLIO_PERFORMANCE_SUMMARY: (id: string) => `/perf/${id}` }))

vi.mock('../../config/api', () => ({
  api: { get: mockApiGet },
  ENDPOINTS: mockEndpoints,
}))

const sampleData = {
  portfolio: {
    id: 'portfolio-123',
    allocations: { BTC: 50, ETH: 30, XLM: 20 },
    totalValue: 100000,
    threshold: 5,
    lastRebalance: '2024-06-15T00:00:00Z',
    createdAt: '2024-01-10T00:00:00Z',
  },
  owner: { address: 'GA-test-owner-key' },
  sharedAt: '2024-07-01T00:00:00Z',
}

describe('parseWidgetParams', () => {
  it('returns defaults for no params', () => {
    const result = parseWidgetParams('')
    expect(result).toEqual({ size: 'medium', theme: 'light' })
  })

  it('parses size=small', () => {
    const result = parseWidgetParams('?size=small')
    expect(result.size).toBe('small')
    expect(result.theme).toBe('light')
  })

  it('parses size=large', () => {
    const result = parseWidgetParams('?size=large')
    expect(result.size).toBe('large')
  })

  it('parses theme=dark', () => {
    const result = parseWidgetParams('?theme=dark')
    expect(result.theme).toBe('dark')
  })

  it('falls back to default for invalid size', () => {
    const result = parseWidgetParams('?size=invalid')
    expect(result.size).toBe('medium')
  })

  it('falls back to default for invalid theme', () => {
    const result = parseWidgetParams('?theme=invalid')
    expect(result.theme).toBe('light')
  })

  it('handles both params together', () => {
    const result = parseWidgetParams('?size=small&theme=dark')
    expect(result).toEqual({ size: 'small', theme: 'dark' })
  })
})

describe('EmbedWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiGet.mockResolvedValue(sampleData)
  })

  it('renders portfolio data', async () => {
    render(<EmbedWidget id="test-id" />)

    await waitFor(() => {
      expect(screen.getByText('Portfolio Value')).toBeTruthy()
      expect(screen.getByText('Top Assets')).toBeTruthy()
      expect(screen.getByText('BTC')).toBeTruthy()
      expect(screen.getByText('ETH')).toBeTruthy()
      expect(screen.getByText('XLM')).toBeTruthy()
    })
  })
})
