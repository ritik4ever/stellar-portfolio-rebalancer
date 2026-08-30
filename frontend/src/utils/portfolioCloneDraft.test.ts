import { beforeEach, describe, expect, it } from 'vitest'
import {
    buildPortfolioCloneDraft,
    clearPortfolioCloneDraft,
    loadPortfolioCloneDraft,
    savePortfolioCloneDraft,
} from './portfolioCloneDraft'

describe('portfolioCloneDraft', () => {
    beforeEach(() => {
        sessionStorage.clear()
    })

    it('builds a draft from array allocations', () => {
        const draft = buildPortfolioCloneDraft({
            id: 'portfolio-1',
            threshold: 7,
            slippageTolerance: 2,
            strategy: 'periodic',
            allocations: [
                { asset: 'XLM', target: 60 },
                { asset: 'USDC', target: 40 },
            ],
        })

        expect(draft).toMatchObject({
            sourcePortfolioId: 'portfolio-1',
            allocations: [
                { asset: 'XLM', percentage: 60 },
                { asset: 'USDC', percentage: 40 },
            ],
            threshold: 7,
            slippageTolerance: 2,
            strategy: 'periodic',
            strategyConfig: {},
        })
    })

    it('persists and reloads drafts from session storage', () => {
        const draft = buildPortfolioCloneDraft({
            id: 'portfolio-2',
            allocations: { BTC: 100 },
            threshold: 5,
            slippageTolerance: 1,
            strategy: 'threshold',
        })
        expect(draft).not.toBeNull()
        savePortfolioCloneDraft(draft!)
        expect(loadPortfolioCloneDraft()?.sourcePortfolioId).toBe('portfolio-2')
        clearPortfolioCloneDraft()
        expect(loadPortfolioCloneDraft()).toBeNull()
    })
})
