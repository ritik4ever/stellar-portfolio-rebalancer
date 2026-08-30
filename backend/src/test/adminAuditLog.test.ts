import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeTempDbPath(): string {
    const dir = join(tmpdir(), `audit-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'test.db')
}

describe('adminAuditLog', () => {
    let dbPath: string

    beforeEach(() => {
        dbPath = makeTempDbPath()
        process.env.DB_PATH = dbPath
        vi.resetModules()
    })

    afterEach(async () => {
        const { databaseService } = await import('../services/databaseService.js')
        databaseService.close()
        if (existsSync(dbPath)) rmSync(dbPath, { force: true, recursive: true })
        delete process.env.DB_PATH
    })

    it('records an audit entry and retrieves it', async () => {
        const { databaseService } = await import('../services/databaseService.js')

        const id = databaseService.recordAdminAuditEntry(
            'GADMIN123',
            'fee_config_change',
            'portfolio-1',
            { fee: 0.5 },
            { fee: 1.0 }
        )

        expect(id).toBeDefined()
        expect(typeof id).toBe('string')

        const result = databaseService.queryAdminAuditLog({})
        expect(result.entries).toHaveLength(1)
        expect(result.total).toBe(1)
        expect(result.entries[0].actor).toBe('GADMIN123')
        expect(result.entries[0].action).toBe('fee_config_change')
        expect(result.entries[0].target).toBe('portfolio-1')
    })

    it('captures actor, action, target, and timestamp', async () => {
        const { databaseService } = await import('../services/databaseService.js')

        databaseService.recordAdminAuditEntry(
            'GADMIN456',
            'force_rebalance',
            'portfolio-2',
            null,
            { triggered: true }
        )

        const result = databaseService.queryAdminAuditLog({})
        expect(result.entries).toHaveLength(1)
        const entry = result.entries[0]
        expect(entry.actor).toBe('GADMIN456')
        expect(entry.action).toBe('force_rebalance')
        expect(entry.target).toBe('portfolio-2')
        expect(entry.timestamp).toBeDefined()
        expect(new Date(entry.timestamp).getTime()).toBeGreaterThan(0)
    })

    it('filters by actor', async () => {
        const { databaseService } = await import('../services/databaseService.js')

        databaseService.recordAdminAuditEntry('admin-A', 'action_1', null, null, null)
        databaseService.recordAdminAuditEntry('admin-B', 'action_2', null, null, null)
        databaseService.recordAdminAuditEntry('admin-A', 'action_3', null, null, null)

        const result = databaseService.queryAdminAuditLog({ actor: 'admin-A' })
        expect(result.entries).toHaveLength(2)
        expect(result.total).toBe(2)
        expect(result.entries.every(e => e.actor === 'admin-A')).toBe(true)
    })

    it('filters by action', async () => {
        const { databaseService } = await import('../services/databaseService.js')

        databaseService.recordAdminAuditEntry('admin-A', 'fee_config_change', null, null, null)
        databaseService.recordAdminAuditEntry('admin-A', 'force_rebalance', null, null, null)
        databaseService.recordAdminAuditEntry('admin-A', 'fee_config_change', null, null, null)

        const result = databaseService.queryAdminAuditLog({ action: 'fee_config_change' })
        expect(result.entries).toHaveLength(2)
        expect(result.entries.every(e => e.action === 'fee_config_change')).toBe(true)
    })

    it('filters by date range', async () => {
        const { databaseService } = await import('../services/databaseService.js')

        databaseService.recordAdminAuditEntry('admin-A', 'action_1', null, null, null)
        databaseService.recordAdminAuditEntry('admin-A', 'action_2', null, null, null)

        const now = new Date()
        const past = new Date(now.getTime() - 60000).toISOString()
        const future = new Date(now.getTime() + 60000).toISOString()

        const result = databaseService.queryAdminAuditLog({ startDate: past, endDate: future })
        expect(result.entries).toHaveLength(2)

        const result2 = databaseService.queryAdminAuditLog({ startDate: future })
        expect(result2.entries).toHaveLength(0)
    })

    it('supports pagination with limit and offset', async () => {
        const { databaseService } = await import('../services/databaseService.js')

        for (let i = 0; i < 5; i++) {
            databaseService.recordAdminAuditEntry('admin-A', `action_${i}`, null, null, null)
        }

        const page1 = databaseService.queryAdminAuditLog({ limit: 2, offset: 0 })
        expect(page1.entries).toHaveLength(2)
        expect(page1.total).toBe(5)

        const page2 = databaseService.queryAdminAuditLog({ limit: 2, offset: 2 })
        expect(page2.entries).toHaveLength(2)

        const page3 = databaseService.queryAdminAuditLog({ limit: 2, offset: 4 })
        expect(page3.entries).toHaveLength(1)
    })

    it('stores before/after values as JSON', async () => {
        const { databaseService } = await import('../services/databaseService.js')

        databaseService.recordAdminAuditEntry(
            'admin-A',
            'user_management',
            'user-123',
            { role: 'viewer' },
            { role: 'editor' }
        )

        const result = databaseService.queryAdminAuditLog({})
        expect(result.entries).toHaveLength(1)
        const entry = result.entries[0]
        expect(JSON.parse(entry.before_value!)).toEqual({ role: 'viewer' })
        expect(JSON.parse(entry.after_value!)).toEqual({ role: 'editor' })
    })
})
