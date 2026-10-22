import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { PortfolioStorage } from '../services/portfolioStorage.js'
import { portfoliosRouter } from '../api/portfolios.routes.js'
import { encodePortfolioCursor } from '../utils/portfolioPagination.js'
import type { Portfolio } from '../types/index.js'

function buildPortfolio(id: string, createdAt: string, overrides: Partial<Portfolio> = {}): Portfolio {
    return {
        id,
        userAddress: overrides.userAddress ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        name: overrides.name ?? `Portfolio ${id}`,
        description: overrides.description ?? `Description for ${id}`,
        allocations: overrides.allocations ?? { XLM: 60, USDC: 40 },
        threshold: overrides.threshold ?? 5,
        balances: overrides.balances ?? { XLM: 600, USDC: 400 },
        totalValue: overrides.totalValue ?? 1000,
        createdAt,
        lastRebalance: createdAt,
        version: 1,
        ...overrides,
    }
}

describe('Portfolio API pagination boundary handling (SPR-2026-181)', () => {
    let storage: PortfolioStorage

    beforeEach(() => {
        storage = new PortfolioStorage()
        storage.clearAll()
    })

    describe('Service Boundary: PortfolioStorage Keyset Pagination', () => {
        it('first page returns oldest items and provides nextCursor', async () => {
            const p1 = buildPortfolio('p1', '2026-01-01T10:00:00.000Z')
            const p2 = buildPortfolio('p2', '2026-01-02T10:00:00.000Z')
            const p3 = buildPortfolio('p3', '2026-01-03T10:00:00.000Z')

            storage.portfolios.set(p1.id, p1)
            storage.portfolios.set(p2.id, p2)
            storage.portfolios.set(p3.id, p3)

            const page = await storage.searchPortfoliosPage({ limit: 2 })

            expect(page.count).toBe(2)
            expect(page.total).toBe(3)
            expect(page.cursor).toBeNull()
            expect(page.portfolios).toHaveLength(2)
            expect(page.portfolios[0].id).toBe('p1')
            expect(page.portfolios[1].id).toBe('p2')
            expect(page.nextCursor).not.toBeNull()
        })

        it('final page returns newest items with nextCursor: null', async () => {
            const p1 = buildPortfolio('p1', '2026-01-01T10:00:00.000Z')
            const p2 = buildPortfolio('p2', '2026-01-02T10:00:00.000Z')
            const p3 = buildPortfolio('p3', '2026-01-03T10:00:00.000Z')

            storage.portfolios.set(p1.id, p1)
            storage.portfolios.set(p2.id, p2)
            storage.portfolios.set(p3.id, p3)

            const page1 = await storage.searchPortfoliosPage({ limit: 2 })
            expect(page1.nextCursor).toBeTruthy()

            const page2 = await storage.searchPortfoliosPage({
                limit: 2,
                cursor: page1.nextCursor,
            })

            expect(page2.count).toBe(1)
            expect(page2.total).toBe(3)
            expect(page2.portfolios).toHaveLength(1)
            expect(page2.portfolios[0].id).toBe('p3')
            expect(page2.nextCursor).toBeNull()
        })

        it('empty result returns empty array, total 0, and null nextCursor', async () => {
            const page = await storage.searchPortfoliosPage({ limit: 20 })

            expect(page.portfolios).toEqual([])
            expect(page.count).toBe(0)
            expect(page.total).toBe(0)
            expect(page.cursor).toBeNull()
            expect(page.nextCursor).toBeNull()
        })

        it('empty result when cursor is past all items', async () => {
            const p1 = buildPortfolio('p1', '2026-01-01T10:00:00.000Z')
            storage.portfolios.set(p1.id, p1)

            const beyondCursor = encodePortfolioCursor({
                createdAt: '2026-12-31T00:00:00.000Z',
                id: 'p999',
            })

            const page = await storage.searchPortfoliosPage({
                limit: 10,
                cursor: beyondCursor,
            })

            expect(page.portfolios).toEqual([])
            expect(page.count).toBe(0)
            expect(page.total).toBe(1)
            expect(page.nextCursor).toBeNull()
        })

        it('stable cursor: replaying request with same cursor produces identical results', async () => {
            const p1 = buildPortfolio('p1', '2026-01-01T10:00:00.000Z')
            const p2 = buildPortfolio('p2', '2026-01-02T10:00:00.000Z')
            const p3 = buildPortfolio('p3', '2026-01-03T10:00:00.000Z')
            const p4 = buildPortfolio('p4', '2026-01-04T10:00:00.000Z')

            storage.portfolios.set(p1.id, p1)
            storage.portfolios.set(p2.id, p2)
            storage.portfolios.set(p3.id, p3)
            storage.portfolios.set(p4.id, p4)

            const page1 = await storage.searchPortfoliosPage({ limit: 2 })
            const cursor = page1.nextCursor!

            const attempt1 = await storage.searchPortfoliosPage({ limit: 2, cursor })
            const attempt2 = await storage.searchPortfoliosPage({ limit: 2, cursor })

            expect(attempt1).toEqual(attempt2)
            expect(attempt1.portfolios.map(p => p.id)).toEqual(['p3', 'p4'])
        })

        it('reported count is stable across pages and not affected by page size', async () => {
            for (let i = 1; i <= 5; i++) {
                const p = buildPortfolio(`p${i}`, `2026-01-0${i}T10:00:00.000Z`)
                storage.portfolios.set(p.id, p)
            }

            const pageLimit1 = await storage.searchPortfoliosPage({ limit: 1 })
            const pageLimit2 = await storage.searchPortfoliosPage({ limit: 2 })
            const pageLimit5 = await storage.searchPortfoliosPage({ limit: 5 })
            const pageLimit10 = await storage.searchPortfoliosPage({ limit: 10 })

            expect(pageLimit1.total).toBe(5)
            expect(pageLimit2.total).toBe(5)
            expect(pageLimit5.total).toBe(5)
            expect(pageLimit10.total).toBe(5)

            const page2 = await storage.searchPortfoliosPage({
                limit: 2,
                cursor: pageLimit2.nextCursor,
            })
            expect(page2.total).toBe(5)
        })

        it('concurrent inserts during pagination do not skip or duplicate seen items', async () => {
            const p1 = buildPortfolio('p1', '2026-01-01T10:00:00.000Z')
            const p3 = buildPortfolio('p3', '2026-01-03T10:00:00.000Z')
            storage.portfolios.set(p1.id, p1)
            storage.portfolios.set(p3.id, p3)

            const firstPage = await storage.searchPortfoliosPage({ limit: 1 })
            expect(firstPage.portfolios[0].id).toBe('p1')
            const cursor = firstPage.nextCursor!

            // Concurrently insert an item with older date and one with newer date
            const p0 = buildPortfolio('p0', '2025-12-31T10:00:00.000Z')
            const p4 = buildPortfolio('p4', '2026-01-04T10:00:00.000Z')
            storage.portfolios.set(p0.id, p0)
            storage.portfolios.set(p4.id, p4)

            const secondPage = await storage.searchPortfoliosPage({ limit: 2, cursor })

            // Keyset pagination correctly proceeds past p1 without repeating p1 or skipping p3
            expect(secondPage.portfolios.map(p => p.id)).toEqual(['p3', 'p4'])
        })

        it('no duplicate side effects: repeated pagination requests are read-only', async () => {
            const p1 = buildPortfolio('p1', '2026-01-01T10:00:00.000Z')
            storage.portfolios.set(p1.id, p1)

            const sizeBefore = storage.portfolios.size
            await storage.searchPortfoliosPage({ limit: 10 })
            await storage.searchPortfoliosPage({ limit: 10 })
            const sizeAfter = storage.portfolios.size

            expect(sizeBefore).toBe(sizeAfter)
        })
    })

    describe('HTTP API Service Boundary (GET /api/portfolios)', () => {
        let app: express.Express

        beforeEach(() => {
            app = express()
            app.use(express.json())
            app.use('/api', portfoliosRouter)
        })

        it('returns first page with oldest items and envelope metadata', async () => {
            const res = await request(app).get('/api/portfolios?limit=10')

            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data).toHaveProperty('portfolios')
            expect(res.body.data).toHaveProperty('limit')
            expect(res.body.data).toHaveProperty('cursor')
            expect(res.body.data).toHaveProperty('nextCursor')
            expect(res.body.data).toHaveProperty('count')
            expect(res.body.data).toHaveProperty('total')
        })

        it('returns 400 Bad Request on invalid/malformed cursor', async () => {
            const res = await request(app).get('/api/portfolios?cursor=not-a-valid-cursor-token!')

            expect(res.status).toBe(400)
            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('INVALID_CURSOR')
        })

        it('handles limit boundary defaults and clamping', async () => {
            const res = await request(app).get('/api/portfolios?limit=-5')
            expect(res.status).toBe(200)
            expect(res.body.data.limit).toBe(20)

            const resMax = await request(app).get('/api/portfolios?limit=999')
            expect(resMax.status).toBe(200)
            expect(resMax.body.data.limit).toBe(100)
        })
    })
})
