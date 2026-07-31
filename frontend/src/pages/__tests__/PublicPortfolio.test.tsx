import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import PublicPortfolio from '../PublicPortfolio'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockEndpoints = vi.hoisted(() => ({ PORTFOLIO_SHARE_VIEW: (hash: string) => `/share/${hash}` }))

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

describe('PublicPortfolio', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.title = 'Stellar Portfolio Rebalancer'
    const metaTags = document.querySelectorAll('meta[property^="og:"]')
    metaTags.forEach(el => el.remove())
  })

  it('shows loading state initially', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}))
    render(<PublicPortfolio hash="test-hash" />)
    expect(document.querySelector('.animate-spin')).toBeTruthy()
  })

  it('shows error when share link is revoked', async () => {
    mockApiGet.mockRejectedValue({ status: 410 })
    render(<PublicPortfolio hash="test-hash" />)
    await waitFor(() => {
      expect(screen.getByText('This share link has been revoked by the owner.')).toBeTruthy()
    })
  })

  it('shows error when share link is not found', async () => {
    mockApiGet.mockRejectedValue({ status: 404 })
    render(<PublicPortfolio hash="test-hash" />)
    await waitFor(() => {
      expect(screen.getByText('Share link not found.')).toBeTruthy()
    })
  })

  it('renders portfolio data and sets OG meta tags', async () => {
    mockApiGet.mockResolvedValue(sampleData)
    render(<PublicPortfolio hash="test-hash" />)

    await waitFor(() => {
      expect(screen.getByText(/Shared Portfolio/)).toBeTruthy()
    })

    const ogTitle = document.querySelector('meta[property="og:title"]')
    expect(ogTitle).toBeTruthy()
    expect(ogTitle?.getAttribute('content')).toMatch(/Portfolio Snapshot/)
    expect(ogTitle?.getAttribute('content')).toMatch(/\$[\d,]+/)

    const ogDesc = document.querySelector('meta[property="og:description"]')
    expect(ogDesc).toBeTruthy()
    expect(ogDesc?.getAttribute('content')).toMatch(/3 assets/)
    expect(ogDesc?.getAttribute('content')).toMatch(/\$[\d,]+/)

    const ogUrl = document.querySelector('meta[property="og:url"]')
    expect(ogUrl).toBeTruthy()
  })
})
