interface Portfolio {
    id: string
    userAddress: string
    allocations: Record<string, number>
    threshold: number
    balances: Record<string, number>
    totalValue: number
    createdAt: string
    lastRebalance: string
}

class PortfolioStorage {
    public portfolios: Map<string, Portfolio> = new Map() // Make public for monitoring

    createPortfolio(userAddress: string, allocations: Record<string, number>, threshold: number): string {
        const id = Date.now().toString()
        const portfolio: Portfolio = {
            id,
            userAddress,
            allocations,
            threshold,
            balances: {},
            totalValue: 0,
            createdAt: new Date().toISOString(),
            lastRebalance: new Date().toISOString()
        }

        this.portfolios.set(id, portfolio)
        return id
    }

    createPortfolioWithBalances(
        userAddress: string,
        allocations: Record<string, number>,
        threshold: number,
        currentBalances: Record<string, number>
    ): string {
        const id = Date.now().toString()
        const portfolio: Portfolio = {
            id,
            userAddress,
            allocations,
            threshold,
            balances: currentBalances,
            totalValue: Object.values(currentBalances).reduce((sum, bal) => sum + bal, 0),
            createdAt: new Date().toISOString(),
            lastRebalance: new Date().toISOString()
        }

        this.portfolios.set(id, portfolio)
        return id
    }

    getPortfolio(id: string): Portfolio | undefined {
        return this.portfolios.get(id)
    }

    getUserPortfolios(userAddress: string): Portfolio[] {
        return Array.from(this.portfolios.values())
            .filter(p => p.userAddress === userAddress)
    }

    updatePortfolio(id: string, updates: Partial<Portfolio>): boolean {
        const portfolio = this.portfolios.get(id)
        if (!portfolio) return false

        this.portfolios.set(id, { ...portfolio, ...updates })
        return true
    }

    /**
     * Get all portfolios
     */
    getAllPortfolios(): Portfolio[] {
        return Array.from(this.portfolios.values())
    }

    /**
     * Get portfolio count
     */
    getPortfolioCount(): number {
        return this.portfolios.size
    }

    /**
     * Delete a portfolio
     */
    deletePortfolio(id: string): boolean {
        return this.portfolios.delete(id)
    }

    /**
     * Clear all portfolios (for testing)
     */
    clearAll(): void {
        this.portfolios.clear()
    }
}

export const portfolioStorage = new PortfolioStorage()
export type { Portfolio }