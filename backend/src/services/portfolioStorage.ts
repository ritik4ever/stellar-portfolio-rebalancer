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

class PortfolioStorage {
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
        threshold: number
    ): Promise<string> {
        const id = randomUUID()
        const portfolio: Portfolio = {
            id,
            userAddress,
            allocations,
            threshold,
            balances: {},
            totalValue: 0,
            createdAt: new Date().toISOString(),
            lastRebalance: new Date().toISOString(),
            version: 1
        }
        if (isDbConfigured()) {
            await portfolioDb.dbCreatePortfolio(id, userAddress, allocations, threshold, {}, 0)
        }
        this.cacheSet(portfolio)
        return id
    }

    async createPortfolioWithBalances(
        userAddress: string,
        allocations: Record<string, number>,
        threshold: number,
        currentBalances: Record<string, number>,
        slippageTolerance: number = 1
    ): Promise<string> {
        const id = randomUUID()
        const totalValue = Object.values(currentBalances).reduce((sum, bal) => sum + bal, 0)
        const portfolio: Portfolio = {
            id,
            userAddress,
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
                portfolio.slippageTolerance ?? 1
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

    async updatePortfolio(id: string, updates: Partial<Portfolio>): Promise<boolean> {
        const portfolio = await this.getPortfolio(id)
        if (!portfolio) return false
        const updated = { ...portfolio, ...updates }
        if (isDbConfigured()) {
            const ok = await portfolioDb.dbUpdatePortfolio(id, {
                balances: updates.balances,
                totalValue: updates.totalValue,
                lastRebalance: updates.lastRebalance
            })
            if (!ok && (updates.balances ?? updates.totalValue ?? updates.lastRebalance)) return false
        }
        this.cacheSet(updated)
        return true
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

    clearAll(): void {
        this.portfolios.clear()
    }
}
export { databaseService as portfolioStorage } from './databaseService.js'
export type { Portfolio } from '../types/index.js'
