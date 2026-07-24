import { isDbConfigured } from '../db/client.js'
import * as portfolioDb from '../db/portfolioDb.js'
import { randomUUID } from 'node:crypto'
import type { Portfolio } from '../types/index.js'

const SLIPPAGE_MIN = 0.5
const SLIPPAGE_MAX = 5
function clampSlippageTolerance(p: number): number {
    if (typeof p !== 'number' || Number.isNaN(p)) return 1
    return Math.max(SLIPPAGE_MIN, Math.min(SLIPPAGE_MAX, p))
}



const useCache = process.env.USE_MEMORY_CACHE === 'true'

export class PortfolioStorage {
    public portfolios: Map<string, Portfolio> = new Map()

    private async cacheGet(id: string): Promise<Portfolio | undefined> {
        if (useCache && this.portfolios.has(id)) return this.portfolios.get(id)
        if (!isDbConfigured()) return this.portfolios.get(id)
        const p = await portfolioDb.dbGetPortfolio(id)
        if (p && useCache) this.portfolios.set(id, p)
        return p
    }

    private cacheSet(portfolio: Portfolio): void {
        if (useCache || !isDbConfigured()) this.portfolios.set(portfolio.id, portfolio)
    }

    private cacheDelete(id: string): void {
        this.portfolios.delete(id)
    }

    async createPortfolio(
        userAddress: string,
        allocations: Record<string, number>,
        threshold: number,
        name?: string,
        description?: string
    ): Promise<string> {
        const id = randomUUID()
        const portfolio: Portfolio = {
            id,
            userAddress,
            name,
            description,
            allocations,
            threshold,
            balances: {},
            totalValue: 0,
            createdAt: new Date().toISOString(),
            lastRebalance: new Date().toISOString(),
            version: 1
        }
        if (isDbConfigured()) {
            await portfolioDb.dbCreatePortfolio(id, userAddress, allocations, threshold, {}, 0, 1, 'threshold', {}, name, description)
        }
        this.cacheSet(portfolio)
        return id
    }

    async createPortfolioWithBalances(
        userAddress: string,
        allocations: Record<string, number>,
        threshold: number,
        currentBalances: Record<string, number>,
        slippageTolerance: number = 1,
        name?: string,
        description?: string
    ): Promise<string> {
        const id = randomUUID()
        const totalValue = Object.values(currentBalances).reduce((sum, bal) => sum + bal, 0)
        const portfolio: Portfolio = {
            id,
            userAddress,
            name,
            description,
            allocations,
            threshold,
            slippageTolerance: clampSlippageTolerance(slippageTolerance),
            balances: currentBalances,
            totalValue,
            createdAt: new Date().toISOString(),
            lastRebalance: new Date().toISOString(),
            version: 1
        }
        if (isDbConfigured()) {
            await portfolioDb.dbCreatePortfolio(
                id,
                userAddress,
                allocations,
                threshold,
                currentBalances,
                totalValue,
                portfolio.slippageTolerance ?? 1,
                'threshold',
                {},
                name,
                description
            )
        }
        this.cacheSet(portfolio)
        return id
    }

    async getPortfolio(id: string): Promise<Portfolio | undefined> {
        return this.cacheGet(id)
    }

    async getUserPortfolios(userAddress: string): Promise<Portfolio[]> {
        if (isDbConfigured()) {
            const list = await portfolioDb.dbGetUserPortfolios(userAddress)
            if (useCache) list.forEach(p => this.portfolios.set(p.id, p))
            return list
        }
        return Array.from(this.portfolios.values()).filter(p => p.userAddress === userAddress)
    }

    async updatePortfolio(id: string, updates: Partial<Portfolio>, expectedVersion?: number): Promise<boolean> {
        const portfolio = await this.getPortfolio(id)
        if (!portfolio) return false

        if (expectedVersion !== undefined && portfolio.version !== expectedVersion) {
            const { ConflictError } = await import('../types/index.js')
            throw new ConflictError(portfolio.version ?? -1)
        }

        const nextVersion = (portfolio.version ?? 1) + 1
        const updated = { ...portfolio, ...updates, version: nextVersion }
        if (isDbConfigured()) {
            const ok = await portfolioDb.dbUpdatePortfolio(id, {
                userAddress: updates.userAddress,
                name: updates.name,
                description: updates.description,
                allocations: updates.allocations,
                threshold: updates.threshold,
                balances: updates.balances,
                totalValue: updates.totalValue,
                lastRebalance: updates.lastRebalance
            }, expectedVersion)
            if (!ok && (updates.balances ?? updates.totalValue ?? updates.lastRebalance ?? updates.name ?? updates.description)) return false
        }
        this.cacheSet(updated)
        return true
    }

    async searchPortfolios(searchQuery: string, limit: number, offset: number): Promise<Portfolio[]> {
        if (isDbConfigured()) {
            const list = await portfolioDb.dbSearchPortfolios(searchQuery, limit, offset)
            if (useCache) list.forEach(p => this.portfolios.set(p.id, p))
            return list
        }
        
        let all = Array.from(this.portfolios.values())
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            all = all.filter(p => 
                (p.name && p.name.toLowerCase().includes(q)) || 
                (p.description && p.description.toLowerCase().includes(q))
            )
        }
        all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        return all.slice(offset, offset + limit)
    }

    async getAllPortfolios(): Promise<Portfolio[]> {
        if (isDbConfigured()) {
            const list = await portfolioDb.dbGetAllPortfolios()
            if (useCache) list.forEach(p => this.portfolios.set(p.id, p))
            return list
        }
        return Array.from(this.portfolios.values())
    }

    async getPortfolioCount(): Promise<number> {
        if (isDbConfigured()) {
            const list = await portfolioDb.dbGetAllPortfolios()
            return list.length
        }
        return this.portfolios.size
    }

    async deletePortfolio(id: string): Promise<boolean> {
        if (isDbConfigured()) {
            const ok = await portfolioDb.dbDeletePortfolio(id)
            if (ok) this.cacheDelete(id)
            return ok
        }
        return this.portfolios.delete(id)
    }

    /**
     * Clone an existing portfolio, optionally overriding fields.
     * Returns the new portfolio ID.
     */
    async clonePortfolio(sourceId: string, overrides: Partial<Portfolio> = {}): Promise<string> {
        const source = await this.getPortfolio(sourceId)
        if (!source) throw new Error(`Source portfolio ${sourceId} not found`)
        const userAddress = overrides.userAddress ?? source.userAddress
        const allocations = overrides.allocations ?? source.allocations
        const threshold = overrides.threshold ?? source.threshold
        const slippageTolerance = overrides.slippageTolerance ?? source.slippageTolerance ?? 1
        const strategy = overrides.strategy ?? source.strategy
        const strategyConfig = overrides.strategyConfig ?? source.strategyConfig ?? {}
        // Preserve balances if they exist
        if (Object.keys(source.balances).length > 0) {
            const newId = await this.createPortfolioWithBalances(
                userAddress,
                allocations,
                threshold,
                source.balances,
                slippageTolerance,
            )
            // Update strategy if provided
            if (strategy) {
                await this.updatePortfolio(newId, { strategy, strategyConfig })
            }
            return newId
        } else {
            const newId = await this.createPortfolio(userAddress, allocations, threshold)
            if (strategy) {
                await this.updatePortfolio(newId, { strategy, strategyConfig })
            }
            return newId
        }
    }

    clearAll(): void {
        this.portfolios.clear()
    }
}
export { databaseService as portfolioStorage } from './databaseService.js'
export type { Portfolio } from '../types/index.js'
