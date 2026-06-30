import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express, { type Express } from 'express'
import request from 'supertest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}))

const createTempDbPath = (): string => {
    const dir = join(tmpdir(), `events-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'events.db')
}

describe('Events API Integration Tests', () => {
    let app: Express
    let dbPath: string
    let db: import('../services/databaseService.js').DatabaseService

    beforeEach(async () => {
        vi.resetModules()
        dbPath = createTempDbPath()
        process.env.DB_PATH = dbPath
        process.env.ENABLE_DEMO_DB_SEED = 'false'
        process.env.DEMO_MODE = 'false'

        const databaseModule = await import('../services/databaseService.js')
        db = databaseModule.databaseService
        const { eventsRouter } = await import('../api/events.routes.js')

        app = express()
        app.use(express.json())
        app.use('/api', eventsRouter)

        db.ensurePortfolioExists('stream-a', 'GUSERA')
        db.ensurePortfolioExists('stream-b', 'GUSERB')

        db.recordRebalanceEvent({
            portfolioId: 'stream-a',
            trigger: 'rebalance.started',
            trades: 0,
            gasUsed: '0 XLM',
            status: 'pending',
            actor: 'user',
            timestamp: '2026-01-01T10:00:00.000Z'
        })
        db.recordRebalanceEvent({
            portfolioId: 'stream-a',
            trigger: 'rebalance.completed',
            trades: 2,
            gasUsed: '0.02 XLM',
            status: 'completed',
            actor: 'system',
            timestamp: '2026-01-02T10:00:00.000Z'
        })
        db.recordRebalanceEvent({
            portfolioId: 'stream-b',
            trigger: 'rebalance.failed',
            trades: 1,
            gasUsed: '0.01 XLM',
            status: 'failed',
            actor: 'scheduler',
            timestamp: '2026-01-03T10:00:00.000Z'
        })
    })

    afterEach(() => {
        db.close()
        delete process.env.DB_PATH
        delete process.env.ENABLE_DEMO_DB_SEED
        delete process.env.DEMO_MODE
        if (existsSync(dbPath)) {
            try {
                rmSync(dbPath, { force: true })
            } catch {
                // Windows may briefly hold the file; the next test uses a new path.
            }
        }
    })

    it('returns all events sorted by timestamp descending', async () => {
        const res = await request(app)
            .get('/api/events')
            .expect(200)

        expect(res.body.success).toBe(true)
        expect(res.body.data.total).toBe(3)
        expect(res.body.data.data.map((event: { eventType: string }) => event.eventType)).toEqual([
            'rebalance.failed',
            'rebalance.completed',
            'rebalance.started'
        ])
        expect(res.body.data.data[0].streamId).toBe('stream-b')
    })

    it('applies eventType, streamId, actor, and date range filters together', async () => {
        const res = await request(app)
            .get('/api/events')
            .query({
                eventType: 'rebalance.completed',
                streamId: 'stream-a',
                actor: 'system',
                from: '2026-01-02T00:00:00.000Z',
                to: '2026-01-02T23:59:59.999Z'
            })
            .expect(200)

        expect(res.body.data.total).toBe(1)
        expect(res.body.data.data).toHaveLength(1)
        expect(res.body.data.data[0]).toMatchObject({
            eventType: 'rebalance.completed',
            streamId: 'stream-a',
            actor: 'system'
        })
    })

    it('paginates with page and limit', async () => {
        const res = await request(app)
            .get('/api/events')
            .query({ page: 2, limit: 1 })
            .expect(200)

        expect(res.body.data.total).toBe(3)
        expect(res.body.data.page).toBe(2)
        expect(res.body.data.limit).toBe(1)
        expect(res.body.data.data).toHaveLength(1)
        expect(res.body.data.data[0].eventType).toBe('rebalance.completed')
    })

    it('returns an empty feed payload instead of 404 when filters match no events', async () => {
        const res = await request(app)
            .get('/api/events')
            .query({ actor: 'admin' })
            .expect(200)

        expect(res.body.success).toBe(true)
        expect(res.body.data.data).toEqual([])
        expect(res.body.data.total).toBe(0)
    })

    it('rejects invalid date ranges', async () => {
        const res = await request(app)
            .get('/api/events')
            .query({ from: '2026-01-03T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' })
            .expect(400)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
})
