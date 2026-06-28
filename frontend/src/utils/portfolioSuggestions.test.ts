import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildPortfolioSuggestions,
  dismissPortfolioSuggestion,
  loadDismissedPortfolioSuggestions,
  PORTFOLIO_SUGGESTION_DISMISS_TTL_MS,
  shouldShowPortfolioSuggestion,
} from './portfolioSuggestions'

const assets = [
  { symbol: 'USDC', name: 'USD Coin', domain: 'centre.io' },
  { symbol: 'USDT', name: 'Tether USD', domain: 'tether.to' },
  { symbol: 'XLM', name: 'Stellar Lumens' },
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
]

describe('portfolioSuggestions', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('fires the concentration rule when one asset exceeds 60%', () => {
    const suggestions = buildPortfolioSuggestions(
      [
        { asset: 'BTC', percentage: 70 },
        { asset: 'USDC', percentage: 30 },
      ],
      assets,
    )

    expect(suggestions.map((suggestion) => suggestion.id)).toContain(
      'concentration-diversify',
    )
  })

  it('fires the stablecoin-only rule when the portfolio is fully stablecoins', () => {
    const suggestions = buildPortfolioSuggestions(
      [
        { asset: 'USDC', percentage: 60 },
        { asset: 'USDT', percentage: 40 },
      ],
      assets,
    )

    expect(suggestions.map((suggestion) => suggestion.id)).toContain(
      'stablecoins-add-growth',
    )
  })

  it('fires the stablecoin-heavy rule when stablecoins dominate but are not the only assets', () => {
    const suggestions = buildPortfolioSuggestions(
      [
        { asset: 'USDC', percentage: 75 },
        { asset: 'BTC', percentage: 25 },
      ],
      assets,
    )

    expect(suggestions.map((suggestion) => suggestion.id)).toContain(
      'stablecoin-heavy-balance',
    )
  })

  it('fires the defensive-anchor rule for crypto-heavy portfolios with no stablecoins', () => {
    const suggestions = buildPortfolioSuggestions(
      [
        { asset: 'BTC', percentage: 55 },
        { asset: 'ETH', percentage: 45 },
      ],
      assets,
    )

    expect(suggestions.map((suggestion) => suggestion.id)).toContain(
      'crypto-heavy-defensive-anchor',
    )
  })

  it('fires the simplification rule for fragmented portfolios', () => {
    const suggestions = buildPortfolioSuggestions(
      [
        { asset: 'USDC', percentage: 22 },
        { asset: 'XLM', percentage: 22 },
        { asset: 'BTC', percentage: 22 },
        { asset: 'ETH', percentage: 17 },
        { asset: 'SOL', percentage: 17 },
      ],
      assets,
    )

    expect(suggestions.map((suggestion) => suggestion.id)).toContain(
      'simplify-fragmented-portfolio',
    )
  })

  it('scopes dismissals by user and expires them after seven days', () => {
    const now = Date.now()
    const ttl = PORTFOLIO_SUGGESTION_DISMISS_TTL_MS

    dismissPortfolioSuggestion('user-a', 'stablecoins-add-growth', now)

    expect(loadDismissedPortfolioSuggestions('user-b', now)).toEqual({})
    expect(shouldShowPortfolioSuggestion(
      loadDismissedPortfolioSuggestions('user-a', now),
      'stablecoins-add-growth',
      now,
    )).toBe(false)

    const expired = loadDismissedPortfolioSuggestions('user-a', now + ttl + 1)
    expect(expired).toEqual({})
  })
})
