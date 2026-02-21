
    })

    it('stores on-chain indexed metadata and supports source/time filters', () => {
        const portfolioId = db.createPortfolio('GCHAIN', { XLM: 100 }, 5)
        const chainTimestamp = '2026-02-20T10:00:00.000Z'

        db.recordRebalanceEvent({
            portfolioId,
            timestamp: chainTimestamp,
            trigger: 'On-chain Rebalance Executed',
            trades: 1,
            gasUsed: 'on-chain',
            status: 'completed',
            eventSource: 'onchain',
            onChainConfirmed: true,
            onChainEventType: 'rebalance_executed',
            onChainLedger: 12345,
            onChainTxHash: 'tx-hash-1',
            onChainContractId: 'CCHAIN123',
            onChainPagingToken: 'cursor-1'
        })


        db.recordRebalanceEvent({
            portfolioId,
            trigger: 'Manual Rebalance',
            trades: 1,
            gasUsed: '0.01 XLM',
            status: 'completed',
            eventSource: 'simulated',
            isSimulated: true
        })

        const onChainOnly = db.getRebalanceHistory(portfolioId, 20, { eventSource: 'onchain' })
        expect(onChainOnly).toHaveLength(1)
        expect(onChainOnly[0].onChainConfirmed).toBe(true)
        expect(onChainOnly[0].onChainLedger).toBe(12345)


    })

    it('deduplicates indexed on-chain events by paging token', () => {
        const portfolioId = db.createPortfolio('GCHAIN-DEDUP', { XLM: 100 }, 5)

        const first = db.recordRebalanceEvent({
            portfolioId,
            trigger: 'On-chain Deposit',
            trades: 0,
            gasUsed: 'on-chain',
            status: 'completed',
            eventSource: 'onchain',
            onChainConfirmed: true,
            onChainPagingToken: 'cursor-dedup-1'
        })

        const second = db.recordRebalanceEvent({
            portfolioId,
            trigger: 'On-chain Deposit',
            trades: 0,
            gasUsed: 'on-chain',
            status: 'completed',
            eventSource: 'onchain',
            onChainConfirmed: true,
            onChainPagingToken: 'cursor-dedup-1'
        })

        expect(second.id).toBe(first.id)
        const all = db.getRebalanceHistory(portfolioId, 20, { eventSource: 'onchain' })
        expect(all).toHaveLength(1)
    })
})

// ─── Demo seed ───────────────────────────────────────────────────────────────

describe('DatabaseService – demo seeding', () => {
    let dbPath: string

    afterEach(() => {
        if (existsSync(dbPath)) rmSync(dbPath, { force: true })
        delete process.env.DB_PATH
    })

    it('seeds a demo portfolio and history on first run', () => {
        const { service: db } = makeTempDb()
        dbPath = process.env.DB_PATH!

        // Demo portfolio should exist
        const count = db.getPortfolioCount()
        expect(count).toBeGreaterThanOrEqual(1)

        // Demo history should exist
        const stats = db.getHistoryStats()
        expect(stats.totalEvents).toBeGreaterThanOrEqual(1)

        db.close()
    })
})
