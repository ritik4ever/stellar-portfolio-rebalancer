import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Keypair } from '@stellar/stellar-sdk'

const failMock = vi.fn()

vi.mock('../utils/apiResponse.js', () => ({
    fail: failMock
}))

describe('requireAdmin middleware', () => {
    beforeEach(() => {
        failMock.mockReset()
        vi.resetModules()
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('returns service unavailable when admin keys are not configured', async () => {
        vi.stubEnv('ADMIN_PUBLIC_KEYS', '')
        const { requireAdmin } = await import('../middleware/auth.js')
        const next = vi.fn()

        requireAdmin({ headers: {} } as any, {} as any, next)

        expect(failMock).toHaveBeenCalledWith(expect.anything(), 503, 'SERVICE_UNAVAILABLE', 'Admin auth not configured')
        expect(next).not.toHaveBeenCalled()
    })

    it('allows valid signed request for configured admin key', async () => {
        const kp = Keypair.random()
        vi.stubEnv('ADMIN_PUBLIC_KEYS', kp.publicKey())
        const { requireAdmin } = await import('../middleware/auth.js')

        const timestamp = Date.now().toString()
        const sig = kp.sign(Buffer.from(timestamp, 'utf8')).toString('base64')
        const next = vi.fn()

        requireAdmin({
            headers: {
                'x-public-key': kp.publicKey(),
                'x-message': timestamp,
                'x-signature': sig
            }
        } as any, {} as any, next)

        expect(next).toHaveBeenCalledOnce()
        expect(failMock).not.toHaveBeenCalled()
    })

    it('rejects invalid signature', async () => {
        const kp = Keypair.random()
        vi.stubEnv('ADMIN_PUBLIC_KEYS', kp.publicKey())
        const { requireAdmin } = await import('../middleware/auth.js')
        const next = vi.fn()

        requireAdmin({
            headers: {
                'x-public-key': kp.publicKey(),
                'x-message': Date.now().toString(),
                'x-signature': Buffer.from('not-a-valid-sig').toString('base64')
            }
        } as any, {} as any, next)

        expect(next).not.toHaveBeenCalled()
        expect(failMock).toHaveBeenCalled()
        expect(failMock.mock.calls[0][2]).toBe('FORBIDDEN')
    })
})
