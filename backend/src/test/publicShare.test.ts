import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `getPublicShareView` backs both `GET /portfolio/share/:hash` and the
 * Open Graph card, so the two modules are swapped for scripted fakes and the
 * service is re-imported per test to keep the mocks isolated.
 */

const OWNER = 'GB7BQ5WE2ZQZ5WJH6EHJ5F6KPRKPTZ5YKJQ5ZQZQZQZQZQZQZQZQZQZQZ'

const shareState: { share: unknown } = { share: undefined }
const portfolioState: { portfolio: unknown } = { portfolio: undefined }

async function loadPublicShare(): Promise<typeof import('../services/publicShare.js')> {
    vi.resetModules()
    vi.doMock('../services/databaseService.js', () => ({
        databaseService: {
            getPublicShareByHash: (hash: string) => (hash === 'unknown-hash' ? undefined : shareState.share),
        },
    }))
    vi.doMock('../services/portfolioStorage.js', () => ({
        portfolioStorage: {
            getPortfolio: async (id: string) => (id === 'missing-portfolio' ? null : portfolioState.portfolio),
        },
    }))
    return import('../services/publicShare.js')
}

describe('maskOwnerAddress', () => {
    it('keeps short strings intact and masks long ones', async () => {
        const { maskOwnerAddress } = await loadPublicShare()

        expect(maskOwnerAddress('GABC')).toBe('GABC')
        expect(maskOwnerAddress('GABCDEFGH1234')).toBe('GABC...1234')
    })

    it('tolerates a missing address', async () => {
        const { maskOwnerAddress } = await loadPublicShare()
        expect(maskOwnerAddress(undefined as unknown as string)).toBe('')
    })
})

describe('getPublicShareView', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        shareState.share = {
            hash: 'abc123',
            portfolioId: 'portfolio-1',
            userAddress: OWNER,
            active: true,
            createdAt: '2024-07-01T00:00:00Z',
        }
        portfolioState.portfolio = {
            id: 'portfolio-1',
            name: 'Alpha Fund',
            allocations: { BTC: 60, XLM: 40 },
            totalValue: 42000,
            threshold: 5,
            lastRebalance: '2024-06-15T00:00:00Z',
            createdAt: '2024-01-10T00:00:00Z',
        }
    })

    it('returns the portfolio snapshot with a masked owner', async () => {
        const { getPublicShareView } = await loadPublicShare()
        const result = await getPublicShareView('abc123')

        expect(result.status).toBe('ok')
        if (result.status !== 'ok') return
        expect(result.view.portfolio.name).toBe('Alpha Fund')
        expect(result.view.portfolio.allocations).toEqual({ BTC: 60, XLM: 40 })
        expect(result.view.portfolio.totalValue).toBe(42000)
        expect(result.view.sharedAt).toBe('2024-07-01T00:00:00Z')
        expect(result.view.owner.address).toBe(`${OWNER.slice(0, 4)}...${OWNER.slice(-4)}`)
        expect(JSON.stringify(result.view)).not.toContain(OWNER)
    })

    it('reports an unknown hash as not found', async () => {
        const { getPublicShareView } = await loadPublicShare()
        expect(await getPublicShareView('unknown-hash')).toEqual({ status: 'not_found' })
    })

    it('reports a revoked share as revoked', async () => {
        shareState.share = { ...(shareState.share as object), active: false }
        const { getPublicShareView } = await loadPublicShare()
        expect(await getPublicShareView('abc123')).toEqual({ status: 'revoked' })
    })

    it('reports not found when the shared portfolio disappeared', async () => {
        shareState.share = { ...(shareState.share as object), portfolioId: 'missing-portfolio' }
        const { getPublicShareView } = await loadPublicShare()
        expect(await getPublicShareView('abc123')).toEqual({ status: 'not_found' })
    })
})