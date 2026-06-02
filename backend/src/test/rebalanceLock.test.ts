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

    it('simulates concurrent lock contention between multiple workers', async () => {
        vi.doMock('../queue/connection.js', () => ({
            REDIS_URL: 'redis://localhost:6379',
            isRedisAvailable: vi.fn(async () => false)
        }))

        const { RebalanceLockService } = await import('../services/rebalanceLock.js')
        const service = RebalanceLockService.getInstance()

        // Simulate 5 workers trying to acquire the lock at the exact same time
        const promises = Array.from({ length: 5 }).map(() => service.acquireLock('p_concurrent', 5000))
        const results = await Promise.all(promises)

        const successes = results.filter(r => r === true).length
        const failures = results.filter(r => r === false).length

        // Only exactly one worker should acquire the lock
        expect(successes).toBe(1)
        expect(failures).toBe(4)

        // Ensure no deadlock: lock can still be released and acquired again
        await service.releaseLock('p_concurrent')
        expect(await service.acquireLock('p_concurrent', 5000)).toBe(true)

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

    it('releases lock via TTL if worker crashes without releasing', async () => {
        vi.useFakeTimers()

        vi.doMock('../queue/connection.js', () => ({
            REDIS_URL: 'redis://localhost:6379',
            isRedisAvailable: vi.fn(async () => false)
        }))

        const { RebalanceLockService } = await import('../services/rebalanceLock.js')
        const service = RebalanceLockService.getInstance()

        // Worker 1 acquires lock and "crashes" (never calls releaseLock)
        expect(await service.acquireLock('p_crash', 5000)).toBe(true)

        // Worker 2 tries immediately and fails
        expect(await service.acquireLock('p_crash', 5000)).toBe(false)

        // Time passes beyond TTL (5 seconds)
        vi.advanceTimersByTime(5001)

        // Worker 2 tries again and succeeds (TTL cleanup)
        expect(await service.acquireLock('p_crash', 5000)).toBe(true)

        await service.stop()
        vi.useRealTimers()
    })
})
