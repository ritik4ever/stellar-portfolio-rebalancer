export interface SuggestionAsset {
  symbol: string
  name?: string
  issuer?: string
  domain?: string
  type?: 'native' | 'credit_alphanum4' | 'credit_alphanum12'
  displayName?: string
  searchText?: string
}

export interface SuggestionAllocation {
  asset: string
  percentage: number
}

export interface PortfolioSuggestion {
  id: string
  title: string
  description: string
  rationale: string
  tone: 'info' | 'warning' | 'success'
  allocations: SuggestionAllocation[]
}

export interface SuggestionDismissalState {
  [suggestionId: string]: number
}

export const PORTFOLIO_SUGGESTION_DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PORTFOLIO_SUGGESTION_DISMISS_VERSION = 1

const STABLECOIN_SYMBOLS = new Set([
  'USDC',
  'USDT',
  'DAI',
  'TUSD',
  'USDP',
  'FDUSD',
  'PYUSD',
  'GUSD',
  'RLUSD',
  'USDD',
  'FRAX',
  'EURS',
  'EURC',
  'BUSD',
])

const CORE_ASSET_ORDER = ['USDC', 'XLM', 'BTC', 'ETH']

const storageKey = (userId: string | null | undefined) =>
  `portfolio-suggestions-dismissed-v${PORTFOLIO_SUGGESTION_DISMISS_VERSION}-${userId || 'anonymous'}`

function isStablecoin(asset: string, metadata?: SuggestionAsset): boolean {
  const symbol = asset.toUpperCase()
  const name = `${metadata?.name ?? ''} ${metadata?.displayName ?? ''}`.toLowerCase()
  const domain = metadata?.domain?.toLowerCase() ?? ''

  return (
    STABLECOIN_SYMBOLS.has(symbol) ||
    /stablecoin|usd coin|dollar/.test(name) ||
    (symbol.startsWith('US') && symbol !== 'USDT' ? name.includes('usd') : false) ||
    domain.includes('centre.io') ||
    domain.includes('circle.com')
  )
}

function isGrowthAsset(asset: string): boolean {
  return ['XLM', 'BTC', 'ETH'].includes(asset.toUpperCase())
}

function normalizeAllocations(
  allocations: SuggestionAllocation[],
): SuggestionAllocation[] {
  const filtered = allocations.filter(
    (allocation) =>
      allocation.asset && Number.isFinite(allocation.percentage) && allocation.percentage > 0,
  )
  const total = filtered.reduce((sum, allocation) => sum + allocation.percentage, 0)
  if (filtered.length === 0 || total <= 0) return []

  const normalized = filtered.map((allocation) => ({
    asset: allocation.asset,
    percentage: Number(((allocation.percentage / total) * 100).toFixed(1)),
  }))

  const previous = normalized
    .slice(0, -1)
    .reduce((sum, row) => sum + row.percentage, 0)

  normalized[normalized.length - 1] = {
    ...normalized[normalized.length - 1],
    percentage: Number((100 - previous).toFixed(1)),
  }

  return normalized
}

function buildAllocationPreset(
  desiredOrder: string[],
  weights: number[],
  assets: SuggestionAsset[],
): SuggestionAllocation[] {
  const available = new Set(assets.map((asset) => asset.symbol.toUpperCase()))
  const resolved = desiredOrder.filter(
    (symbol, index, list) => list.indexOf(symbol) === index && available.has(symbol),
  )
  if (resolved.length === 0) return []

  const trimmedWeights = resolved.map((_, index) => weights[index] ?? weights[weights.length - 1] ?? 0)
  const totalWeight = trimmedWeights.reduce((sum, value) => sum + value, 0)
  if (totalWeight <= 0) {
    const even = Number((100 / resolved.length).toFixed(1))
    return resolved.map((asset, index) => ({
      asset,
      percentage: index === resolved.length - 1
        ? Number((100 - even * (resolved.length - 1)).toFixed(1))
        : even,
    }))
  }

  return normalizeAllocations(
    resolved.map((asset, index) => ({
      asset,
      percentage: trimmedWeights[index],
    })),
  )
}

function getCurrentTotals(
  allocations: SuggestionAllocation[],
  assets: SuggestionAsset[],
) {
  const assetMap = new Map(
    assets.map((asset) => [asset.symbol.toUpperCase(), asset] as const),
  )

  const resolved = allocations
    .map((allocation) => ({
      asset: allocation.asset.toUpperCase(),
      percentage: allocation.percentage,
      metadata: assetMap.get(allocation.asset.toUpperCase()),
    }))
    .filter((allocation) => allocation.percentage > 0)

  const total = resolved.reduce((sum, allocation) => sum + allocation.percentage, 0)
  const stablecoinTotal = resolved.reduce(
    (sum, allocation) =>
      sum + (isStablecoin(allocation.asset, allocation.metadata) ? allocation.percentage : 0),
    0,
  )
  const growthTotal = resolved.reduce(
    (sum, allocation) =>
      sum + (isGrowthAsset(allocation.asset) ? allocation.percentage : 0),
    0,
  )

  const dominant = [...resolved].sort((a, b) => b.percentage - a.percentage)[0] ?? null
  const stablecoinCount = resolved.filter((allocation) =>
    isStablecoin(allocation.asset, allocation.metadata),
  ).length

  return {
    total,
    stablecoinTotal,
    growthTotal,
    dominant,
    stablecoinCount,
    assetCount: resolved.length,
    allStablecoins: resolved.length > 0 && stablecoinCount === resolved.length,
    noStablecoins: resolved.length > 0 && stablecoinCount === 0,
  }
}

export function loadDismissedPortfolioSuggestions(
  userId: string | null | undefined,
  now = Date.now(),
): SuggestionDismissalState {
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SuggestionDismissalState
    if (!parsed || typeof parsed !== 'object') return {}

    const next: SuggestionDismissalState = {}
    for (const [suggestionId, dismissedAt] of Object.entries(parsed)) {
      if (!Number.isFinite(dismissedAt)) continue
      if (now - dismissedAt < PORTFOLIO_SUGGESTION_DISMISS_TTL_MS) {
        next[suggestionId] = dismissedAt
      }
    }
    if (Object.keys(next).length !== Object.keys(parsed).length) {
      try {
        window.localStorage.setItem(storageKey(userId), JSON.stringify(next))
      } catch {
        // Ignore cleanup write failures; the in-memory result is still usable.
      }
    }
    return next
  } catch {
    return {}
  }
}

export function saveDismissedPortfolioSuggestions(
  userId: string | null | undefined,
  dismissals: SuggestionDismissalState,
): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(dismissals))
  } catch {
    // Storage is best-effort only; keep the UI usable if persistence fails.
  }
}

export function dismissPortfolioSuggestion(
  userId: string | null | undefined,
  suggestionId: string,
  now = Date.now(),
): SuggestionDismissalState {
  const next = loadDismissedPortfolioSuggestions(userId, now)
  next[suggestionId] = now
  saveDismissedPortfolioSuggestions(userId, next)
  return next
}

export function shouldShowPortfolioSuggestion(
  dismissals: SuggestionDismissalState,
  suggestionId: string,
  now = Date.now(),
): boolean {
  const dismissedAt = dismissals[suggestionId]
  if (!dismissedAt) return true
  return now - dismissedAt >= PORTFOLIO_SUGGESTION_DISMISS_TTL_MS
}

export function buildPortfolioSuggestions(
  allocations: SuggestionAllocation[],
  assets: SuggestionAsset[],
): PortfolioSuggestion[] {
  const current = getCurrentTotals(allocations, assets)
  if (current.assetCount === 0) return []

  const recommendations: PortfolioSuggestion[] = []
  const dominantSymbol = current.dominant?.asset ?? 'XLM'

  if (current.dominant && current.dominant.percentage > 60) {
    const nextAllocations = buildAllocationPreset(
      [dominantSymbol, 'XLM', 'BTC', 'ETH', 'USDC'],
      [40, 25, 20, 15, 10],
      assets,
    )
    if (nextAllocations.length > 0) {
      recommendations.push({
        id: 'concentration-diversify',
        title: 'Reduce concentration risk',
        description: `One asset currently makes up ${current.dominant.percentage.toFixed(0)}% of the portfolio.`,
        rationale: `${current.dominant.asset} is above the 60% concentration threshold.`,
        tone: 'warning',
        allocations: nextAllocations,
      })
    }
  }

  if (current.allStablecoins) {
    const nextAllocations = buildAllocationPreset(['USDC', 'XLM', 'BTC', 'ETH'], [40, 30, 20, 10], assets)
    if (nextAllocations.length > 0) {
      recommendations.push({
        id: 'stablecoins-add-growth',
        title: 'Add growth assets',
        description: 'All selected assets are stablecoins, so the portfolio has very little upside exposure.',
        rationale: 'A growth sleeve can improve long-term return potential while keeping a defensive base.',
        tone: 'info',
        allocations: nextAllocations,
      })
    }
  }

  if (current.stablecoinTotal >= 70 && !current.allStablecoins) {
    const nextAllocations = buildAllocationPreset(['USDC', 'XLM', 'BTC', 'ETH'], [35, 30, 20, 15], assets)
    if (nextAllocations.length > 0) {
      recommendations.push({
        id: 'stablecoin-heavy-balance',
        title: 'Rebalance toward growth',
        description: `${current.stablecoinTotal.toFixed(0)}% of the portfolio is in stablecoins.`,
        rationale: 'A balanced mix can reduce idle cash drag without removing the defensive core.',
        tone: 'success',
        allocations: nextAllocations,
      })
    }
  }

  if (current.noStablecoins && current.growthTotal >= 80) {
    const nextAllocations = buildAllocationPreset(['BTC', 'ETH', 'XLM', 'USDC'], [40, 25, 20, 15], assets)
    if (nextAllocations.length > 0) {
      recommendations.push({
        id: 'crypto-heavy-defensive-anchor',
        title: 'Add a defensive anchor',
        description: 'The portfolio has no stablecoin exposure and is heavily weighted to growth assets.',
        rationale: 'Introducing a cash-like sleeve can lower volatility during sharp market swings.',
        tone: 'warning',
        allocations: nextAllocations,
      })
    }
  }

  if (current.assetCount >= 5 || (current.assetCount >= 4 && (current.dominant?.percentage ?? 0) < 35)) {
    const nextAllocations = buildAllocationPreset(['USDC', 'XLM', 'BTC', 'ETH'], [40, 30, 20, 10], assets)
    if (nextAllocations.length > 0) {
      recommendations.push({
        id: 'simplify-fragmented-portfolio',
        title: 'Simplify the mix',
        description: 'This allocation is spread across many smaller positions.',
        rationale: 'A simpler starter mix can make it easier to monitor drift and execute rebalances.',
        tone: 'info',
        allocations: nextAllocations,
      })
    }
  }

  if (
    !current.allStablecoins &&
    current.stablecoinTotal < 20 &&
    current.assetCount >= 2 &&
    current.assetCount <= 3
  ) {
    const nextAllocations = buildAllocationPreset(['USDC', 'XLM', 'BTC', 'ETH'], [25, 35, 25, 15], assets)
    if (nextAllocations.length > 0) {
      recommendations.push({
        id: 'core-anchor-balance',
        title: 'Add a core anchor',
        description: 'There is little defensive exposure in this portfolio.',
        rationale: 'Mixing in a stablecoin and XLM creates a clearer cash and liquidity anchor.',
        tone: 'success',
        allocations: nextAllocations,
      })
    }
  }

  return recommendations
}
