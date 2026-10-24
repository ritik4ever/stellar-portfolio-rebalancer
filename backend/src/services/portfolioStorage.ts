import { isDbConfigured } from '../db/client.js'
import * as portfolioDb from '../db/portfolioDb.js'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import type { Portfolio } from '../types/index.js'
import {
    encodePortfolioCursor,
    decodePortfolioCursor,
    diagnosePaginationChange,
    type PortfolioPageCursor,
    type PortfolioPaginationResult,
} from '../utils/portfolioPagination.js'

const SLIPPAGE_MIN = 0.5
const SLIPPAGE_MAX = 5
function clampSlippageTolerance(p: number): number {
    if (typeof p !== 'number' || Number.isNaN(p)) return 1
    return Math.max(SLIPPAGE_MIN, Math.min(SLIPPAGE_MAX, p))
}

/**
 * Build a stable, opaque cursor for portfolio pagination.
 * The cursor encodes the sort key (createdAt) plus the id as a tiebreaker so
 * that concurrent inserts/deletes cannot shift the window between pages.
 */
function encodeCursor(createdAt: string, id: string): string {
    return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | undefined {
    try {
        const raw = Buffer.from(cursor, 'base64url').toString('utf8')
        const sep = raw.indexOf('|')
        if (sep <= 0) return undefined
        return { createdAt: raw.slice(0, sep), id: raw.slice(sep + 1) }
    } catch {
        return undefined
    }
}



const useCache = process.env.USE_MEMORY_CACHE === 'true'

export class PortfolioStorage {
    public portfolios: Map<string, Portfolio> = new Map()

    private async cacheGet(id: string): Promise<Portfolio | undefined> {
        if (useCache && this.portfolios.has(id)) return this.portfolios.get(id)
        if (!isDbConfigured()) {
            const mem = this.portfolios.get(id)
            if (mem) return mem
            try {
                const { databaseService } = await import('./databaseService.js')
                const fromSqlite = databaseService.getPortfolio(id)
                if (fromSqlite) {
                    this.portfolios.set(id, fromSqlite)
                    return fromSqlite
                }
            } catch {}
            return undefined
        }
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
        } else {
            try {
                const { databaseService } = await import('./databaseService.js')
                databaseService.createPortfolio(userAddress, allocations, threshold, 1, 'threshold', {}, name, description, id)
            } catch {}
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
        } else {
            try {
                const { databaseService } = await import('./databaseService.js')
                databaseService.createPortfolioWithBalances(
                    userAddress,
                    allocations,
                    threshold,
                    currentBalances,
                    portfolio.slippageTolerance ?? 1,
                    'threshold',
                    {},
                    name,
                    description,
                    id
                )
            } catch {}
        }
        this.cacheSet(portfolio)
        return id
    }


    async getPortfolio(id: string): Promise<Portfolio | undefined> {
        return this.cacheGet(id)
    }

    async getUserPortfolios(userAddress: string, includeArchived = false): Promise<Portfolio[]> {
        if (isDbConfigured()) {
            const list = await portfolioDb.dbGetUserPortfolios(userAddress, includeArchived)
            if (useCache) list.forEach(p => this.portfolios.set(p.id, p))
            return list
        }
        return Array.from(this.portfolios.values())
            .filter(p => p.userAddress === userAddress && (includeArchived || !p.archivedAt))
    }

    async updatePortfolio(id: string, updates: Partial<Portfolio>, expectedVersion?: number): Promise<boolean> {
        const portfolio = await this.getPortfolio(id)
        if (!portfolio) return false

        // Check active rebalance boundary guard if allocations are being updated
        if (updates.allocations !== undefined) {
            const { isRebalanceActive } = await import('./portfolioPersistenceBoundary.js')
            if (await isRebalanceActive(id)) {
                const { ConflictError } = await import('../types/index.js')
                throw new ConflictError(
                    portfolio.version ?? -1,
                    `Cannot edit allocations while portfolio ${id} is actively rebalancing`,
                    'rebalancing',
                    'conflict_rebalancing'
                )
            }
        }

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

    /**
     * Edit allocations at the service boundary, documenting committed version,
     * execution state, and a stable result.
     */
    async editAllocations(
        id: string,
        allocations: Record<string, number>,
        expectedVersion?: number
    ): Promise<import('../types/index.js').AllocationEditDecision> {
        const { applyAllocationEdit } = await import('./portfolioPersistenceBoundary.js')
        return applyAllocationEdit({
            portfolioId: id,
            allocations,
            expectedVersion,
            storage: this
        })
    }

    async searchPortfolios(searchQuery: string, limit: number, offset: number, includeArchived = false): Promise<Portfolio[]> {
        if (isDbConfigured()) {
            const list = await portfolioDb.dbSearchPortfolios(searchQuery, limit, offset, includeArchived)
            if (useCache) list.forEach(p => this.portfolios.set(p.id, p))
            return list
        }
        
        let all = Array.from(this.portfolios.values())
        if (!includeArchived) {
            all = all.filter(p => !p.archivedAt)
        }
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

    async searchPortfoliosPage(options: {
        search?: string
        address?: string
        includeArchived?: boolean
        limit?: number
        cursor?: string | PortfolioPageCursor | null
    }): Promise<PortfolioPaginationResult<Portfolio>> {
        const { search = '', address, includeArchived = false, limit = 20, cursor } = options

        let parsedCursor: PortfolioPageCursor | null = null
        let cursorStr: string | null = null
        if (typeof cursor === 'string' && cursor.trim().length > 0) {
            cursorStr = cursor.trim()
            parsedCursor = decodePortfolioCursor(cursorStr)
        } else if (cursor && typeof cursor === 'object' && 'createdAt' in cursor && 'id' in cursor) {
            parsedCursor = cursor
            cursorStr = encodePortfolioCursor(cursor)
        }

        if (isDbConfigured()) {
            const page = await portfolioDb.dbGetPortfolioPage({
                search,
                userAddress: address,
                limit,
                cursor: parsedCursor,
                includeArchived,
            })
            const total = page.total ?? page.count
            const { itemsChanged, changeKind } = diagnosePaginationChange({
                currentTotal: total,
                cursor: parsedCursor,
            })
            return {
                portfolios: page.portfolios as Portfolio[],
                limit,
                cursor: cursorStr,
                nextCursor: page.nextCursor ? encodePortfolioCursor({ ...page.nextCursor, total }) : null,
                count: page.count,
                total,
                itemsChanged,
                changeKind,
            }
        }

        let all = Array.from(this.portfolios.values())
        if (!includeArchived) {
            all = all.filter(p => !p.archivedAt)
        }
        if (address) {
            all = all.filter(p => p.userAddress === address)
        }
        if (search) {
            const q = search.toLowerCase()
            all = all.filter(p =>
                (p.name && p.name.toLowerCase().includes(q)) ||
                (p.description && p.description.toLowerCase().includes(q))
            )
        }

        const total = all.length
        const { itemsChanged, changeKind } = diagnosePaginationChange({
            currentTotal: total,
            cursor: parsedCursor,
        })

        // Ascending ordering: oldest items first by (created_at ASC, id ASC)
        all.sort((a, b) => {
            const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            if (diff !== 0) return diff
            return a.id.localeCompare(b.id)
        })

        let paged = all
        if (parsedCursor) {
            const cursorTime = new Date(parsedCursor.createdAt).getTime()
            const cursorId = parsedCursor.id
            paged = all.filter(p => {
                const itemTime = new Date(p.createdAt).getTime()
                if (itemTime > cursorTime) return true
                if (itemTime === cursorTime) return p.id.localeCompare(cursorId) > 0
                return false
            })
        }

        const hasMore = paged.length > limit
        const pageItems = hasMore ? paged.slice(0, limit) : paged
        const last = pageItems[pageItems.length - 1]
        const nextCursor = hasMore && last
            ? encodePortfolioCursor({ createdAt: last.createdAt, id: last.id, total })
            : null

        return {
            portfolios: pageItems,
            limit,
            cursor: cursorStr,
            nextCursor,
            count: pageItems.length,
            total,
            itemsChanged,
            changeKind,
        }
    }

    async getAllPortfolios(includeArchived = false): Promise<Portfolio[]> {
        if (isDbConfigured()) {
            const list = await portfolioDb.dbGetAllPortfolios(includeArchived)
            if (useCache) list.forEach(p => this.portfolios.set(p.id, p))
            return list
        }
        let all = Array.from(this.portfolios.values())
        if (!includeArchived) {
            all = all.filter(p => !p.archivedAt)
        }
        return all
    }

    /**
     * Paginate portfolios using a stable cursor.
     *
     * Returns the page of portfolios plus the cursor to fetch the next page
     * (undefined when the page is the last one) and the total reported count.
     * The cursor is derived from the last item's (createdAt, id) so that
     * concurrent inserts or deletes do not cause records to be skipped or
     * duplicated between pages.
     */
    async getPortfoliosPage(
        userAddress: string | undefined,
        cursor: string | undefined,
        limit: number,
        includeArchived = false
    ): Promise<{ items: Portfolio[]; nextCursor?: string; total: number }> {
        const safeLimit = Math.max(1, Math.min(100, Math.floor(limit) || 20))
        const decoded = cursor ? decodeCursor(cursor) : undefined
        if (cursor && !decoded) {
            const { ValidationError } = await import('../types/index.js')
            throw new ValidationError('Invalid pagination cursor')
        }

        const all = await this.getAllPortfolios(includeArchived)
        const scoped = userAddress
            ? all.filter(p => p.userAddress === userAddress)
            : all
        const total = scoped.length

        const sorted = scoped.slice().sort((a, b) => {
            const ta = new Date(a.createdAt).getTime()
            const tb = new Date(b.createdAt).getTime()
            if (ta !== tb) return tb - ta
            return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
        })

        let start = 0
        if (decoded) {
            const idx = sorted.findIndex(
                p => p.createdAt === decoded.createdAt && p.id === decoded.id
            )
            // If the anchor was deleted concurrently, resume from the first
            // record strictly older than the anchor key.
            if (idx >= 0) {
                start = idx + 1
            } else {
                const anchorTime = new Date(decoded.createdAt).getTime()
                start = sorted.findIndex(p => {
                    const t = new Date(p.createdAt).getTime()
                    if (t !== anchorTime) return t < anchorTime
                    return p.id < decoded.id
                })
                if (start < 0) start = sorted.length
            }
        }

        const items = sorted.slice(start, start + safeLimit)
        const last = items[items.length - 1]
        const hasMore = start + items.length < sorted.length
        const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : undefined
        return { items, nextCursor, total }
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

    async archivePortfolio(id: string): Promise<boolean> {
        if (isDbConfigured()) {
            const ok = await portfolioDb.dbArchivePortfolio(id)
            if (ok) {
                const p = await this.getPortfolio(id)
                if (p) {
                    p.archivedAt = new Date().toISOString()
                    this.cacheSet(p)
                }
            }
            return ok
        }
        const p = this.portfolios.get(id)
        if (!p) return false
        p.archivedAt = new Date().toISOString()
        return true
    }

    async restorePortfolio(id: string): Promise<boolean> {
        if (isDbConfigured()) {
            const ok = await portfolioDb.dbRestorePortfolio(id)
            if (ok) {
                const p = await this.getPortfolio(id)
                if (p) {
                    p.archivedAt = undefined
                    this.cacheSet(p)
                }
            }
            return ok
        }
        const p = this.portfolios.get(id)
        if (!p) return false
        p.archivedAt = undefined
        return true
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
