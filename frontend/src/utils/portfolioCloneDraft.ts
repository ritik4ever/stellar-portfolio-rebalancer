export interface PortfolioCloneAllocation {
    asset: string
    percentage: number
}

export interface PortfolioCloneDraft {
    sourcePortfolioId: string
    sourceLabel?: string
    allocations: PortfolioCloneAllocation[]
    threshold: number
    slippageTolerance: number
    strategy: string
    strategyConfig: Record<string, number>
    createdAt: string
}

const CLONE_DRAFT_KEY = 'portfolio-clone-draft'

export function savePortfolioCloneDraft(draft: PortfolioCloneDraft): void {
    sessionStorage.setItem(CLONE_DRAFT_KEY, JSON.stringify(draft))
}

export function loadPortfolioCloneDraft(): PortfolioCloneDraft | null {
    try {
        const raw = sessionStorage.getItem(CLONE_DRAFT_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as PortfolioCloneDraft
        if (!parsed?.sourcePortfolioId || !Array.isArray(parsed.allocations)) return null
        return parsed
    } catch {
        return null
    }
}

export function clearPortfolioCloneDraft(): void {
    sessionStorage.removeItem(CLONE_DRAFT_KEY)
}

function normalizeAllocations(portfolio: Record<string, unknown>): PortfolioCloneAllocation[] {
    const raw = portfolio.allocations
    if (Array.isArray(raw)) {
        return raw
            .map((row) => {
                const entry = row as Record<string, unknown>
                const asset = String(entry.asset ?? entry.name ?? '')
                const percentage = Number(entry.target ?? entry.percentage ?? entry.value ?? 0)
                if (!asset) return null
                return { asset, percentage }
            })
            .filter((row): row is PortfolioCloneAllocation => row !== null)
    }
    if (raw && typeof raw === 'object') {
        return Object.entries(raw as Record<string, number>).map(([asset, percentage]) => ({
            asset,
            percentage: Number(percentage),
        }))
    }
    return []
}

export function buildPortfolioCloneDraft(portfolio: Record<string, unknown>): PortfolioCloneDraft | null {
    const id = typeof portfolio.id === 'string' ? portfolio.id : null
    if (!id || id === 'demo') return null

    const allocations = normalizeAllocations(portfolio)
    if (allocations.length === 0) return null

    const threshold = Number(portfolio.threshold ?? portfolio.rebalanceThreshold ?? 5)
    const slippageTolerance = Number(
        portfolio.slippageTolerance ??
            portfolio.slippageTolerancePercent ??
            1,
    )
    const strategy = typeof portfolio.strategy === 'string' ? portfolio.strategy : 'threshold'
    const strategyConfig =
        portfolio.strategyConfig && typeof portfolio.strategyConfig === 'object'
            ? (portfolio.strategyConfig as Record<string, number>)
            : {}

    return {
        sourcePortfolioId: id,
        sourceLabel: typeof portfolio.name === 'string' ? portfolio.name : id.slice(0, 8),
        allocations,
        threshold: Number.isFinite(threshold) ? threshold : 5,
        slippageTolerance: Number.isFinite(slippageTolerance) ? slippageTolerance : 1,
        strategy,
        strategyConfig,
        createdAt: new Date().toISOString(),
    }
}
