import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import express from 'express'
import type { Express } from 'express'
import cors from 'cors'
import request from 'supertest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RiskManagementService } from '../services/riskManagements.js'
import { ReflectorService } from '../services/reflector.js'
import { portfolioRouter } from '../api/routes.js'
import type { PricesMap } from '../types/index.js'

// Helper to build price series
const buildSeries = (
    base: number,
    returns: number[]
): Array<{ price: number, change: number, timestamp: number }> => {
    const series: Array<{ price: number, change: number, timestamp: number }> = []
    let price = base
    for (let i = 0; i < returns.length; i++) {
        price = price * (1 + returns[i])
        series.push({
            price,
            change: returns[i] * 100,
            timestamp: Date.now() - (returns.length - i) * 60000
        })
    }
    return series
}

const feedSeries = (
    service: RiskManagementService,
    dataset: Record<string, Array<{ price: number, change: number, timestamp: number }>>
): PricesMap => {
    const assets = Object.keys(dataset)
    const length = dataset[assets[0]].length
    let latest: PricesMap = {}

    for (let i = 0; i < length; i++) {
        const prices: PricesMap = {}
        assets.forEach(asset => {
            const point = dataset[asset][i]
            prices[asset] = {
                price: point.price,
                change: point.change,
                timestamp: point.timestamp,
                source: 'external'
            }
        })
        latest = prices
        service.updatePriceData(prices)
    }

    return latest
}

describe('RiskManagementService - Heatmap Calculations', () => {
    it('generates low risk heatmap diagnostics for well-diversified stable portfolio', () => {
        const service = new RiskManagementService()
        const size = 50
        // Small stable returns
        const stableReturns = Array.from({ length: size }, () => 0.0)

        const latest = feedSeries(service, {
            BTC: buildSeries(100, stableReturns),
            ETH: buildSeries(80, stableReturns),
            XLM: buildSeries(1, stableReturns),
            USDC: buildSeries(1, stableReturns)
        })

        const heatmap = service.calculateRiskHeatmap(
            { BTC: 25, ETH: 25, XLM: 25, USDC: 25 },
            latest
        )

        expect(heatmap.concentration.level).toBe('low')
        expect(heatmap.volatility.level).toBe('low')
        expect(heatmap.drawdown.level).toBe('low')
        expect(heatmap.concentration.score).toBeLessThanOrEqual(0.4)
        expect(heatmap.volatility.score).toBe(0) // since returns are positive and constant, volatility is 0
        expect(heatmap.drawdown.score).toBe(0)
    })

    it('generates high concentration risk when a single asset dominates', () => {
        const service = new RiskManagementService()
        const latest: PricesMap = {
            BTC: { price: 100, change: 0, timestamp: Date.now() },
            USDC: { price: 1, change: 0, timestamp: Date.now() }
        }

        // 90% in BTC
        const heatmap = service.calculateRiskHeatmap({ BTC: 90, USDC: 10 }, latest)
        expect(heatmap.concentration.level).toBe('high')
        expect(heatmap.concentration.score).toBeGreaterThan(0.8)
    })

    it('generates high volatility level for highly volatile return series', () => {
        const service = new RiskManagementService()
        const size = 45
        // Alternating massive changes
        const volatileReturns = Array.from({ length: size }, (_, i) => (i % 2 === 0 ? 0.25 : -0.25))

        const latest = feedSeries(service, {
            BTC: buildSeries(100, volatileReturns)
        })

        const heatmap = service.calculateRiskHeatmap({ BTC: 100 }, latest)
        expect(heatmap.volatility.level).toBe('high')
        expect(heatmap.volatility.score).toBe(1.0)
    })

    it('generates high drawdown level for a large peak-to-trough drop', () => {
        const service = new RiskManagementService()
        const size = 40
        // Accumulate a severe drawdown (e.g. continuous drop)
        const drawdownReturns = Array.from({ length: size }, () => -0.05)

        const latest = feedSeries(service, {
            BTC: buildSeries(100, drawdownReturns)
        })

        const heatmap = service.calculateRiskHeatmap({ BTC: 100 }, latest)
        expect(heatmap.drawdown.level).toBe('high')
        expect(heatmap.drawdown.score).toBe(1.0)
    })

    it('safely handles empty or malformed allocations input', () => {
        const service = new RiskManagementService()
        const latest: PricesMap = {}
        
        const heatmap1 = service.calculateRiskHeatmap({}, latest)
        expect(heatmap1.concentration.score).toBe(0)
        expect(heatmap1.concentration.level).toBe('low')
        expect(heatmap1.volatility.score).toBe(0)
        expect(heatmap1.volatility.level).toBe('low')

        const heatmap2 = service.calculateRiskHeatmap(null as any, latest)
        expect(heatmap2.concentration.score).toBe(0)
        expect(heatmap2.concentration.level).toBe('low')
        expect(heatmap2.volatility.score).toBe(0)
        expect(heatmap2.volatility.level).toBe('low')
    })
})

describe('Portfolio Risk Heatmap API Integration Tests', () => {
    let app: Express
    let testDbPath: string
    let createdPortfolioId: string

    beforeAll(async () => {
        process.env.NODE_ENV = 'test'
        const testDir = join(tmpdir(), `stellar-risk-heatmap-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(testDir, { recursive: true })
        testDbPath = join(testDir, 'test.db')
        process.env.DB_PATH = testDbPath

        app = express()
        app.use(cors())
        app.use(express.json())
        app.use('/api', portfolioRouter)

        // Pre-create a portfolio for testing
        const createRes = await request(app)
            .post('/api/portfolio')
            .send({
                userAddress: 'GPORTFOWNER123456789ABCDEF',
                allocations: { XLM: 60, USDC: 40 },
                threshold: 5
            })
        createdPortfolioId = createRes.body.data.portfolioId
    })

    afterAll(() => {
        if (existsSync(testDbPath)) {
            try { rmSync(testDbPath, { force: true }) } catch {}
        }
        delete process.env.DB_PATH
    })

    beforeEach(() => {
        vi.restoreAllMocks()
    })

    describe('GET /api/portfolio/:id - Extended response', () => {
        it('includes riskHeatmap in data when prices fetch succeeds', async () => {
            const spy = vi.spyOn(ReflectorService.prototype, 'getCurrentPrices').mockResolvedValue({
                XLM: { price: 0.12, change: 0.5, timestamp: Date.now() },
                USDC: { price: 1.0, change: 0.0, timestamp: Date.now() }
            })

            const res = await request(app)
                .get(`/api/portfolio/${createdPortfolioId}`)
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.portfolio.id).toBe(createdPortfolioId)
            expect(res.body.data.riskHeatmap).toBeDefined()
            expect(res.body.data.riskHeatmap.concentration).toHaveProperty('score')
            expect(res.body.data.riskHeatmap.concentration).toHaveProperty('level')
            expect(spy).toHaveBeenCalled()
        })

        it('falls back gracefully without riskHeatmap when prices fetch fails', async () => {
            const spy = vi.spyOn(ReflectorService.prototype, 'getCurrentPrices').mockRejectedValue(new Error('Reflector service unavailable'))

            const res = await request(app)
                .get(`/api/portfolio/${createdPortfolioId}`)
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.portfolio.id).toBe(createdPortfolioId)
            expect(res.body.data.riskHeatmap).toBeUndefined()
            expect(spy).toHaveBeenCalled()
        })
    })

    describe('GET /api/portfolio/:id/risk-diagnostics', () => {
        it('returns riskHeatmap for valid portfolio ID', async () => {
            const spy = vi.spyOn(ReflectorService.prototype, 'getCurrentPrices').mockResolvedValue({
                XLM: { price: 0.12, change: 0.5, timestamp: Date.now() },
                USDC: { price: 1.0, change: 0.0, timestamp: Date.now() }
            })

            const res = await request(app)
                .get(`/api/portfolio/${createdPortfolioId}/risk-diagnostics`)
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.riskHeatmap).toBeDefined()
            expect(res.body.data.riskHeatmap.concentration.level).toBeDefined()
            expect(res.body.data.riskHeatmap.volatility.level).toBeDefined()
            expect(res.body.data.riskHeatmap.drawdown.level).toBeDefined()
            expect(spy).toHaveBeenCalled()
        })

        it('returns 404 for non-existent portfolio ID', async () => {
            const res = await request(app)
                .get('/api/portfolio/99999999-9999-9999-9999-999999999999/risk-diagnostics')
                .expect(404)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('NOT_FOUND')
            expect(res.body.error.message).toBe('Portfolio not found')
        })

        it('returns 500 when prices fetch fails', async () => {
            const spy = vi.spyOn(ReflectorService.prototype, 'getCurrentPrices').mockRejectedValue(new Error('Oracle timeout'))

            const res = await request(app)
                .get(`/api/portfolio/${createdPortfolioId}/risk-diagnostics`)
                .expect(500)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('INTERNAL_ERROR')
            expect(res.body.error.message).toContain('Oracle timeout')
            expect(spy).toHaveBeenCalled()
        })
    })
})
