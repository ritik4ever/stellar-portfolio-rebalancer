import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDbPath(): string {
    const dir = join(tmpdir(), `idempotency-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'test.db')
}

interface MockState {
    sentHeaders: Record<string, string>
    sentStatus: number
    sentBody: unknown
    nextCalled: boolean
}

/**
 * Returns a minimal Express req/res/next triple.
 * All observable state lives on the returned `state` object, which is mutated
 * by the res mock and next function. Always access `state.xxx` after calling
 * the middleware — never destructure the reactive properties.
 */
function mockReqRes(opts: {
    method?: string
    path?: string
    body?: unknown
    headers?: Record<string, string>
}): { req: any; res: any; next: () => void; state: MockState } {
    const state: MockState = {
        sentHeaders: {},
        sentStatus: 200,
        sentBody: undefined,
        nextCalled: false
    }

    const req = {
        method: opts.method ?? 'POST',
        path: opts.path ?? '/test',
        body: opts.body ?? {},
        headers: opts.headers ?? {}
    }

    const res: any = {
        statusCode: 200,
        status(code: number) {
            state.sentStatus = code
            this.statusCode = code
            return this
        },
        set(name: string, value: string) {
            state.sentHeaders[name] = value
            return this
        },
        json(body: unknown) {
            state.sentBody = body
            return this
        }
    }

    const next = () => { state.nextCalled = true }

    return { req, res, next, state }
}

// ─── DB layer tests ──────────────────────────────────────────────────────────

describe('idempotencyDb', () => {
    let dbPath: string

    beforeEach(() => {
        dbPath = makeTempDbPath()
        process.env.DB_PATH = dbPath
        vi.resetModules()
    })

    afterEach(() => {
        if (existsSync(dbPath)) rmSync(dbPath, { force: true, recursive: true })
        delete process.env.DB_PATH
    })

    it('stores and retrieves an idempotency result', async () => {
        const { dbStoreIdempotencyResult, dbGetIdempotencyResult } = await import('../db/idempotencyDb.js')

        dbStoreIdempotencyResult('key-1', 'hash-abc', 'POST', '/api/test', 201, { id: 'xyz' })
        const record = dbGetIdempotencyResult('key-1')

        expect(record).toBeDefined()
        expect(record!.key).toBe('key-1')
        expect(record!.requestHash).toBe('hash-abc')
        expect(record!.statusCode).toBe(201)
        expect(JSON.parse(record!.responseBody)).toEqual({ id: 'xyz' })
    })

    it('returns undefined for unknown key', async () => {
        const { dbGetIdempotencyResult } = await import('../db/idempotencyDb.js')
        expect(dbGetIdempotencyResult('nonexistent')).toBeUndefined()
    })

    it('INSERT OR IGNORE — second store for same key does not overwrite', async () => {
        const { dbStoreIdempotencyResult, dbGetIdempotencyResult } = await import('../db/idempotencyDb.js')

        dbStoreIdempotencyResult('key-dup', 'hash-1', 'POST', '/api/test', 200, { v: 1 })
        dbStoreIdempotencyResult('key-dup', 'hash-2', 'POST', '/api/test', 200, { v: 2 })

        const record = dbGetIdempotencyResult('key-dup')
        expect(JSON.parse(record!.responseBody)).toEqual({ v: 1 })
    })

    it('returns undefined for expired key', async () => {
        const { dbStoreIdempotencyResult, dbGetIdempotencyResult } = await import('../db/idempotencyDb.js')

        // SQLite datetime('now') has second precision — use -2 seconds to ensure expiry
        dbStoreIdempotencyResult('key-exp', 'hash', 'POST', '/api/test', 200, {}, -2000)
        expect(dbGetIdempotencyResult('key-exp')).toBeUndefined()
    })

    it('dbCleanupExpiredIdempotencyKeys removes only expired rows', async () => {
        const { dbStoreIdempotencyResult, dbGetIdempotencyResult, dbCleanupExpiredIdempotencyKeys } = await import('../db/idempotencyDb.js')

        dbStoreIdempotencyResult('key-active', 'h1', 'POST', '/a', 200, {})
        dbStoreIdempotencyResult('key-dead', 'h2', 'POST', '/b', 200, {}, -2000)

        const deleted = dbCleanupExpiredIdempotencyKeys()
        expect(deleted).toBe(1)
        expect(dbGetIdempotencyResult('key-active')).toBeDefined()
        expect(dbGetIdempotencyResult('key-dead')).toBeUndefined()
    })
})

// ─── Middleware tests ─────────────────────────────────────────────────────────

describe('idempotencyMiddleware', () => {
    let dbPath: string

    beforeEach(() => {
        dbPath = makeTempDbPath()
        process.env.DB_PATH = dbPath
        vi.resetModules()
    })

    afterEach(() => {
        if (existsSync(dbPath)) rmSync(dbPath, { force: true, recursive: true })
        delete process.env.DB_PATH
    })

    it('passes through when no Idempotency-Key header present', async () => {
        const { idempotencyMiddleware } = await import('../middleware/idempotency.js')
        const mock = mockReqRes({})
        idempotencyMiddleware(mock.req, mock.res, mock.next)
        expect(mock.state.nextCalled).toBe(true)
    })

    it('returns 400 when Idempotency-Key exceeds 255 characters', async () => {
        const { idempotencyMiddleware } = await import('../middleware/idempotency.js')
        const mock = mockReqRes({ headers: { 'idempotency-key': 'x'.repeat(256) } })
        idempotencyMiddleware(mock.req, mock.res, mock.next)
        expect(mock.state.nextCalled).toBe(false)
        expect(mock.state.sentStatus).toBe(400)
        expect((mock.state.sentBody as any).error.message).toMatch(/255 characters/)
    })

    it('first call: calls next, stores result, echoes Idempotency-Key header', async () => {
        const { idempotencyMiddleware } = await import('../middleware/idempotency.js')
        const { dbGetIdempotencyResult } = await import('../db/idempotencyDb.js')

        const key = 'fresh-key-001'
        const body = { portfolioId: 'p1', trigger: 'manual' }
        const mock = mockReqRes({ headers: { 'idempotency-key': key }, body })

        idempotencyMiddleware(mock.req, mock.res, mock.next)
        expect(mock.state.nextCalled).toBe(true)

        // Simulate route handler responding
        mock.res.status(201).json({ success: true, id: 'new-resource' })

        expect(mock.state.sentHeaders['Idempotency-Key']).toBe(key)
        const stored = dbGetIdempotencyResult(key)
        expect(stored).toBeDefined()
        expect(stored!.statusCode).toBe(201)
    })

    it('retry with same key + same body replays stored response', async () => {
        const { idempotencyMiddleware } = await import('../middleware/idempotency.js')

        const key = 'retry-key-001'
        const body = { portfolioId: 'p1', trigger: 'manual' }

        // First request — goes through to route handler
        const first = mockReqRes({ headers: { 'idempotency-key': key }, body })
        idempotencyMiddleware(first.req, first.res, first.next)
        first.res.status(200).json({ success: true, id: 'resource-1' })

        // Second request — same key, same body → replay
        const second = mockReqRes({ headers: { 'idempotency-key': key }, body })
        idempotencyMiddleware(second.req, second.res, second.next)

        expect(second.state.nextCalled).toBe(false)
        expect(second.state.sentStatus).toBe(200)
        expect((second.state.sentBody as any).id).toBe('resource-1')
        expect(second.state.sentHeaders['Idempotency-Replayed']).toBe('true')
    })

    it('same key + different body returns 409 Conflict', async () => {
        const { idempotencyMiddleware } = await import('../middleware/idempotency.js')

        const key = 'conflict-key-001'

        const first = mockReqRes({ headers: { 'idempotency-key': key }, body: { portfolioId: 'p1' } })
        idempotencyMiddleware(first.req, first.res, first.next)
        first.res.status(200).json({ success: true })

        // Different payload → conflict
        const second = mockReqRes({ headers: { 'idempotency-key': key }, body: { portfolioId: 'p-different' } })
        idempotencyMiddleware(second.req, second.res, second.next)

        expect(second.state.nextCalled).toBe(false)
        expect(second.state.sentStatus).toBe(409)
        expect((second.state.sentBody as any).error.message).toMatch(/different request payload/)
        expect((second.state.sentBody as any).error.details.idempotencyKey).toBe(key)
    })

    it('error responses (4xx) are also stored and replayed', async () => {
        const { idempotencyMiddleware } = await import('../middleware/idempotency.js')

        const key = 'error-key-001'
        const body = { bad: 'payload' }

        // Route handler returns 400
        const first = mockReqRes({ headers: { 'idempotency-key': key }, body })
        idempotencyMiddleware(first.req, first.res, first.next)
        first.res.status(400).json({ error: { message: 'Missing required field', code: 'VALIDATION_ERROR' } })

        // Retry — replay the 400
        const second = mockReqRes({ headers: { 'idempotency-key': key }, body })
        idempotencyMiddleware(second.req, second.res, second.next)

        expect(second.state.sentStatus).toBe(400)
        expect((second.state.sentBody as any).error.message).toBe('Missing required field')
        expect(second.state.sentHeaders['Idempotency-Replayed']).toBe('true')
    })
})
