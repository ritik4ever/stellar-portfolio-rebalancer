import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ioredis
const mockGet = vi.fn()
const mockSetex = vi.fn()
const mockDel = vi.fn()
const mockExpire = vi.fn()
const mockConnect = vi.fn()

vi.mock('ioredis', () => ({
    default: vi.fn().mockImplementation(() => ({
        get: mockGet,
        setex: mockSetex,
        del: mockDel,
        expire: mockExpire,
        connect: mockConnect,
    })),
}))

vi.mock('../queue/connection.js', () => ({ REDIS_URL: 'redis://localhost:6379' }))

// Re-import after mocks
const { getDemoSession, saveDemoSession, deleteDemoSession, touchDemoSession } = await import('../demo/demoSessionStore.js')

describe('Demo session store (#889)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockConnect.mockResolvedValue(undefined)
    })

    it('getDemoSession returns null when key does not exist', async () => {
        mockGet.mockResolvedValue(null)
        const session = await getDemoSession('missing-token')
        expect(session).toBeNull()
    })

    it('getDemoSession returns parsed session when key exists', async () => {
        const data = { createdAt: '2024-01-01T00:00:00.000Z', portfolio: { XLM: 100 } }
        mockGet.mockResolvedValue(JSON.stringify(data))
        const session = await getDemoSession('my-token')
        expect(session).toEqual(data)
    })

    it('saveDemoSession writes JSON with 1-hour TTL', async () => {
        mockSetex.mockResolvedValue('OK')
        const session = { createdAt: '2024-01-01T00:00:00.000Z' }
        await saveDemoSession('my-token', session)
        expect(mockSetex).toHaveBeenCalledWith(
            'demo:session:my-token',
            3600,
            JSON.stringify(session),
        )
    })

    it('deleteDemoSession removes the key', async () => {
        mockDel.mockResolvedValue(1)
        await deleteDemoSession('my-token')
        expect(mockDel).toHaveBeenCalledWith('demo:session:my-token')
    })

    it('touchDemoSession refreshes TTL and returns true when key exists', async () => {
        mockExpire.mockResolvedValue(1)
        const result = await touchDemoSession('my-token')
        expect(result).toBe(true)
        expect(mockExpire).toHaveBeenCalledWith('demo:session:my-token', 3600)
    })

    it('touchDemoSession returns false when key does not exist', async () => {
        mockExpire.mockResolvedValue(0)
        const result = await touchDemoSession('nonexistent')
        expect(result).toBe(false)
    })
})
