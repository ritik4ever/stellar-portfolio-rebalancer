import { databaseService } from './databaseService.js'
import { portfolioStorage } from './portfolioStorage.js'

/**
 * Shared lookup behind `GET /portfolio/share/:hash` and its Open Graph card
 * (`.../og.png`), so both surfaces render from exactly the same snapshot and
 * both honour a revoked share link.
 */

export interface PublicShareView {
    portfolio: {
        id: string
        name?: string
        allocations: Record<string, number>
        totalValue: number
        threshold: number
        lastRebalance: string
        createdAt: string
    }
    owner: {
        /** Masked owner address; the full address never leaves the backend. */
        address: string
    }
    sharedAt: string
}

export type PublicShareLookup =
    | { status: 'ok'; view: PublicShareView }
    | { status: 'not_found' }
    | { status: 'revoked' }

export function maskOwnerAddress(address: string): string {
    if (typeof address !== 'string') return ''
    return address.length > 10 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address
}

export async function getPublicShareView(hash: string): Promise<PublicShareLookup> {
    const share = databaseService.getPublicShareByHash(hash)
    if (!share) return { status: 'not_found' }
    if (!share.active) return { status: 'revoked' }

    const portfolio = await portfolioStorage.getPortfolio(share.portfolioId)
    if (!portfolio) return { status: 'not_found' }

    return {
        status: 'ok',
        view: {
            portfolio: {
                id: share.portfolioId,
                name: portfolio.name,
                allocations: portfolio.allocations,
                totalValue: portfolio.totalValue,
                threshold: portfolio.threshold,
                lastRebalance: portfolio.lastRebalance,
                createdAt: portfolio.createdAt,
            },
            owner: { address: maskOwnerAddress(share.userAddress) },
            sharedAt: share.createdAt,
        },
    }
}