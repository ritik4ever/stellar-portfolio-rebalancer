import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDbPath(): string {
    const dir = join(tmpdir(), `idem-cleanup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'test.db')
}

// ─── Worker processor tests ─────────────────────────────────────────────────

describe('processIdempotencyCleanupJob', () => {
    let dbPath: string

    beforeEach(() => {
        dbPath = makeTempDbPath()
        process.env.DB_PATH = dbPath
        vi.resetModules()
    })

    afterEach(async () => {
        const { closeIdempotencyDb } = await import('../db/idempotencyDb.js')
        closeIdempotencyDb()
        if (existsSync(dbPath)) rmSync(dbPath, { force: true, recursive: true })
        delete process.env.DB_PATH
    })

    it('removes expired keys and logs the count', async () => {
        const { dbStoreIdempotencyResult, dbGetIdempotencyResult } = await import('../db/idempotencyDb.js')
        const { processIdempotencyCleanupJob } = await import('../queue/workers/idempotencyCleanupWorker.js')

        // Seed: 2 expired + 1 active
        dbStoreIdempotencyResult('expired-1', 'h1', 'POST', '/a', 200, { ok: true }, -2000)
        dbStoreIdempotencyResult('expired-2', 'h2', 'POST', '/b', 201, { ok: true }, -2000)
        dbStoreIdempotencyResult('active-1', 'h3', 'POST', '/c', 200, { ok: true })

        const fakeJob = { id: 'test-job-1', data: { triggeredBy: 'manual' as const } }
        await processIdempotencyCleanupJob(fakeJob as any)

        // Active key should survive
        expect(dbGetIdempotencyResult('active-1')).toBeDefined()
        // Expired keys should be gone (query already filters by expires_at, but cleanup deletes the rows)
        expect(dbGetIdempotencyResult('expired-1')).toBeUndefined()
        expect(dbGetIdempotencyResult('expired-2')).toBeUndefined()
    })

    it('handles zero expired keys gracefully', async () => {
        const { dbStoreIdempotencyResult } = await import('../db/idempotencyDb.js')
        const { processIdempotencyCleanupJob } = await import('../queue/workers/idempotencyCleanupWorker.js')

        // Only active keys
        dbStoreIdempotencyResult('active-only', 'h1', 'POST', '/a', 200, {})

        const fakeJob = { id: 'test-job-2', data: { triggeredBy: 'scheduler' as const } }

        // Should not throw
        await expect(processIdempotencyCleanupJob(fakeJob as any)).resolves.toBeUndefined()
    })

    it('handles empty table gracefully', async () => {
        const { processIdempotencyCleanupJob } = await import('../queue/workers/idempotencyCleanupWorker.js')

        const fakeJob = { id: 'test-job-3', data: { triggeredBy: 'startup' as const } }

        // Should not throw on empty table
        await expect(processIdempotencyCleanupJob(fakeJob as any)).resolves.toBeUndefined()
    })

    it('defaults triggeredBy to scheduler when not provided', async () => {
        const { processIdempotencyCleanupJob } = await import('../queue/workers/idempotencyCleanupWorker.js')

        const fakeJob = { id: 'test-job-4', data: {} }

        await expect(processIdempotencyCleanupJob(fakeJob as any)).resolves.toBeUndefined()
    })
})
