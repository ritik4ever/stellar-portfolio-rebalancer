import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import PublicPortfolio from '../PublicPortfolio'
import { DEFAULT_SOCIAL_DESCRIPTION, DEFAULT_SOCIAL_META, removeSocialMeta } from '../../lib/socialMeta'

const mockApiGet = vi.hoisted(() => vi.fn())
const mockEndpoints = vi.hoisted(() => ({
  PORTFOLIO_SHARE_VIEW: (hash: string) => `/api/v1/portfolio/share/${hash}`,
  PORTFOLIO_SHARE_OG_IMAGE: (hash: string) => `/api/v1/portfolio/share/${hash}/og.png`,
}))
const mockApiConfig = vi.hoisted(() => ({ BASE_URL: 'https://api.example.com' }))

vi.mock('../../config/api', () => ({
  api: { get: mockApiGet },
  ENDPOINTS: mockEndpoints,
  API_CONFIG: mockApiConfig,
}))

/** The allocation chart is irrelevant to social tags and slow to render in jsdom. */
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
}))

const sampleData = {
  portfolio: {
    id: 'portfolio-123',
    name: 'Alpha Fund',
    allocations: { BTC: 50, ETH: 30, XLM: 20 },
    totalValue: 100000,
    threshold: 5,
    lastRebalance: '2024-06-15T00:00:00Z',
    createdAt: '2024-01-10T00:00:00Z',
  },
  owner: { address: 'GA-test-owner-key' },
  sharedAt: '2024-07-01T00:00:00Z',
}

function content(property: string): string | null {
  const attribute = property.startsWith('twitter:') ? 'name' : 'property'
  return document.querySelector(`meta[${attribute}="${property}"]`)?.getAttribute('content') ?? null
}

/**
 * Renders and lets the fetch settle inside `act`, so the social-tag effect has
 * run by the time the assertion executes instead of racing the effect queue.
 */
async function renderShare(hash: string, data: unknown = sampleData) {
  mockApiGet.mockResolvedValue(data)
  let view!: ReturnType<typeof render>
  await act(async () => {
    view = render(<PublicPortfolio hash={hash} />)
  })
  return view
}

async function rerenderShare(view: ReturnType<typeof render>, hash: string) {
  await act(async () => {
    view.rerender(<PublicPortfolio hash={hash} />)
  })
}

describe('PublicPortfolio', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.title = 'Stellar Portfolio Rebalancer'
    removeSocialMeta()
  })

  const TEST_TIMEOUT = { timeout: 15000 }

  it('shows loading state initially', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}))
    render(<PublicPortfolio hash="test-hash" />)
    expect(document.querySelector('.animate-spin')).toBeTruthy()
  })

  it('shows error when share link is revoked', TEST_TIMEOUT, async () => {
    mockApiGet.mockRejectedValue({ status: 410 })
    await act(async () => {
      render(<PublicPortfolio hash="test-hash" />)
    })
    expect(screen.getByText('This share link has been revoked by the owner.')).toBeTruthy()
  })

  it('shows error when share link is not found', TEST_TIMEOUT, async () => {
    mockApiGet.mockRejectedValue({ status: 404 })
    await act(async () => {
      render(<PublicPortfolio hash="test-hash" />)
    })
    expect(screen.getByText('Share link not found.')).toBeTruthy()
  })

  it('falls back to generic social tags when the share link cannot be loaded', TEST_TIMEOUT, async () => {
    mockApiGet.mockRejectedValue({ status: 404 })
    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(<PublicPortfolio hash="test-hash" />)
    })

    expect(content('og:description')).toBe(DEFAULT_SOCIAL_DESCRIPTION)
    expect(content('og:image')).toBeNull()
    expect(document.title).toBe(DEFAULT_SOCIAL_META.documentTitle)

    view.unmount()
  })

  it('renders portfolio data and sets per-portfolio OG meta tags', TEST_TIMEOUT, async () => {
    await renderShare('test-hash')

    expect(screen.getByText(/Shared Portfolio/)).toBeTruthy()
    expect(content('og:title')).toBe('Alpha Fund — $100,000')
    expect(content('og:description')).toBe(
      'Shared portfolio with 3 assets. Total value: $100,000. Rebalance threshold: 5%. Largest holding: BTC at 50%.',
    )
    expect(content('og:url')).toBe(window.location.href)
    expect(content('og:type')).toBe('website')
    expect(content('og:site_name')).toBe('Stellar Portfolio Rebalancer')
    expect(document.title).toBe('Alpha Fund — $100,000 | Stellar Portfolio Rebalancer')
  })

  it('points og:image and the twitter card at the server-rendered share card', TEST_TIMEOUT, async () => {
    const image = 'https://api.example.com/api/v1/portfolio/share/test-hash/og.png'
    await renderShare('test-hash')

    expect(content('og:image')).toBe(image)
    expect(content('og:image:secure_url')).toBe(image)
    expect(content('og:image:width')).toBe('1200')
    expect(content('og:image:height')).toBe('630')
    expect(content('og:image:type')).toBe('image/png')
    expect(content('og:image:alt')).toBe('Alpha Fund: $100,000 across 3 assets')
    expect(content('twitter:card')).toBe('summary_large_image')
    expect(content('twitter:image')).toBe(image)
    expect(content('twitter:title')).toBe('Alpha Fund — $100,000')
  })

  it('falls back to a generic title when the portfolio has no name', TEST_TIMEOUT, async () => {
    await renderShare('unnamed-hash', {
      ...sampleData,
      portfolio: { ...sampleData.portfolio, name: undefined, totalValue: 4200, allocations: { XLM: 100 } },
    })

    expect(content('og:title')).toBe('Portfolio Snapshot — $4,200')
    expect(content('og:description')).toBe(
      'Shared portfolio with 1 asset. Total value: $4,200. Rebalance threshold: 5%. Largest holding: XLM at 100%.',
    )
    expect(content('og:image')).toBe('https://api.example.com/api/v1/portfolio/share/unnamed-hash/og.png')
  })

  it('keeps social tags tied to the portfolio being viewed', TEST_TIMEOUT, async () => {
    mockApiGet
      .mockResolvedValueOnce(sampleData)
      .mockResolvedValueOnce({
        ...sampleData,
        portfolio: { ...sampleData.portfolio, name: 'Beta Fund', totalValue: 7500 },
      })

    const view = await renderShare('test-hash')
    expect(content('og:title')).toBe('Alpha Fund — $100,000')

    await rerenderShare(view, 'other-hash')
    expect(content('og:title')).toBe('Beta Fund — $7,500')
    expect(content('og:image')).toBe('https://api.example.com/api/v1/portfolio/share/other-hash/og.png')
  })

  it('restores the generic social tags when the share link is closed', TEST_TIMEOUT, async () => {
    const view = await renderShare('test-hash')
    expect(content('og:title')).toBe('Alpha Fund — $100,000')

    view.unmount()

    expect(content('og:title')).toBe(DEFAULT_SOCIAL_META.title)
    expect(content('og:image')).toBeNull()
    expect(document.title).toBe(DEFAULT_SOCIAL_META.documentTitle)
  })
})