import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('RebalanceLockService (memory fallback)', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    it('acquires, rejects concurrent lock, and releases', async () => {
        vi.doMock('../queue/connection.js', () => ({
            REDIS_URL: 'redis://localhost:6379',
            isRedisAvailable: vi.fn(async () => false)
        }))

        const { RebalanceLockService } = await import('../services/rebalanceLock.js')
        const service = RebalanceLockService.getInstance()

        const first = await service.acquireLock('p1', 10_000)
        const second = await service.acquireLock('p1', 10_000)
        const locked = await service.isLocked('p1')

        expect(first).toBe(true)
        expect(second).toBe(false)
        expect(locked).toBe(true)

        await service.releaseLock('p1')
        expect(await service.isLocked('p1')).toBe(false)

        await service.stop()
    })

    it('allows lock re-acquisition after ttl expires', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

        vi.doMock('../queue/connection.js', () => ({
            REDIS_URL: 'redis://localhost:6379',
            isRedisAvailable: vi.fn(async () => false)
        }))

        const { RebalanceLockService } = await import('../services/rebalanceLock.js')
        const service = RebalanceLockService.getInstance()

        expect(await service.acquireLock('p2', 1000)).toBe(true)
        expect(await service.acquireLock('p2', 1000)).toBe(false)

        vi.advanceTimersByTime(1001)
        expect(await service.acquireLock('p2', 1000)).toBe(true)

        await service.stop()
        vi.useRealTimers()
    })
})
