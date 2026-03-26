import { Address, SorobanRpc, scValToNative } from '@stellar/stellar-sdk'
import { databaseService } from './databaseService.js'
import { logger } from '../utils/logger.js'

type IndexedEventKind = 'portfolio_created' | 'deposit' | 'rebalance_executed'

interface IndexedOnChainEvent {
    kind: IndexedEventKind
    portfolioId: string
    trigger: string
    timestamp: string
    trades: number
    txHash: string
    ledger: number
    contractId: string
    pagingToken: string
    userAddress?: string
}

interface ContractEventIndexerStatus {
    enabled: boolean
    running: boolean
    contractAddress?: string
    rpcUrl?: string
    pollIntervalMs: number
    lastRunAt?: string
    lastError?: string
    lastIngestedCount: number
    cursor?: string
    latestLedger?: number
}

const INDEXER_CURSOR_KEY = 'soroban_event_indexer.cursor'
const INDEXER_LATEST_LEDGER_KEY = 'soroban_event_indexer.latest_ledger'

export class ContractEventIndexerService {
    private readonly contractAddress = (process.env.CONTRACT_ADDRESS || process.env.STELLAR_CONTRACT_ADDRESS || '').trim()
    private readonly stellarNetwork = (process.env.STELLAR_NETWORK || 'testnet').trim().toLowerCase()
    private readonly defaultRpcUrl = this.stellarNetwork === 'mainnet'
        ? 'https://soroban-rpc.mainnet.stellar.gateway.fm'
        : 'https://soroban-testnet.stellar.org'
    private readonly rpcUrl = (
        process.env.SOROBAN_RPC_URL
        || process.env.STELLAR_RPC_URL
        || this.defaultRpcUrl
    ).trim()
    private readonly pollIntervalMs = this.readNumberEnv('SOROBAN_EVENT_INDEXER_INTERVAL_MS', 15000, 3000, 300000)
    private readonly pageLimit = this.readNumberEnv('SOROBAN_EVENT_INDEXER_LIMIT', 100, 1, 200)
    private readonly bootstrapWindowLedgers = this.readNumberEnv('SOROBAN_EVENT_INDEXER_BOOTSTRAP_WINDOW', 500, 1, 50000)
    private readonly maxPagesPerSync = this.readNumberEnv('SOROBAN_EVENT_INDEXER_MAX_PAGES', 10, 1, 100)
    private readonly rpcServer = new SorobanRpc.Server(this.rpcUrl, { allowHttp: this.rpcUrl.startsWith('http://') })

    private pollingTimer: NodeJS.Timeout | null = null
    private isSyncing = false
    private status: ContractEventIndexerStatus = {
        enabled: false,
        running: false,
        pollIntervalMs: this.pollIntervalMs,
        lastIngestedCount: 0
    }

    constructor() {
        this.status.enabled = this.isEnabled()
        this.status.contractAddress = this.contractAddress || undefined
        this.status.rpcUrl = this.rpcUrl || undefined
    }

    isEnabled(): boolean {
        return this.contractAddress.length > 0 && this.rpcUrl.length > 0
    }

    getStatus(): ContractEventIndexerStatus {
        return {
            ...this.status,
            running: this.pollingTimer !== null
        }
    }

    async start(): Promise<void> {
        if (!this.isEnabled()) {
            logger.warn('[CHAIN-INDEXER] Disabled (missing contract or RPC URL)')
            return
        }

        if (this.pollingTimer) return

        logger.info('[CHAIN-INDEXER] Starting contract event indexer', {
            contractAddress: this.contractAddress,
            pollIntervalMs: this.pollIntervalMs
        })

        await this.syncOnce()
        this.pollingTimer = setInterval(() => {
            void this.syncOnce()
        }, this.pollIntervalMs)
    }

    async stop(): Promise<void> {
        if (!this.pollingTimer) return
        clearInterval(this.pollingTimer)
        this.pollingTimer = null
        logger.info('[CHAIN-INDEXER] Stopped')
    }

    async syncOnce(): Promise<{ ingested: number; latestLedger?: number }> {
        if (!this.isEnabled()) return { ingested: 0 }
        if (this.isSyncing) return { ingested: 0, latestLedger: this.status.latestLedger }

        this.isSyncing = true
        try {
            const storedCursor = databaseService.getIndexerState(INDEXER_CURSOR_KEY)
            const storedLatestLedger = Number(databaseService.getIndexerState(INDEXER_LATEST_LEDGER_KEY) || 0) || undefined

            let cursor = storedCursor
            let startLedger: number | undefined
            if (!cursor) {
                const latest = await this.rpcServer.getLatestLedger()
                const floorLedger = Math.max(1, latest.sequence - this.bootstrapWindowLedgers)
                startLedger = storedLatestLedger ? Math.max(1, storedLatestLedger - 1) : floorLedger
            }

            let ingested = 0
            let latestLedger = storedLatestLedger
            let pagesRead = 0

            while (pagesRead < this.maxPagesPerSync) {
                const response = await this.rpcServer.getEvents({
                    cursor,
                    startLedger,
                    limit: this.pageLimit,
                    filters: [{ type: 'contract' }]
                })
                pagesRead++
                latestLedger = response.latestLedger

                if (!response.events.length) break

                for (const event of response.events) {
                    const indexed = this.toIndexedOnChainEvent(event)
                    if (!indexed) continue

                    databaseService.ensurePortfolioExists(indexed.portfolioId, indexed.userAddress || 'ONCHAIN-INDEXER')
                    databaseService.recordRebalanceEvent({
                        portfolioId: indexed.portfolioId,
                        timestamp: indexed.timestamp,
                        trigger: indexed.trigger,
                        trades: indexed.trades,
                        gasUsed: 'on-chain',
                        status: 'completed',
                        isAutomatic: false,
                        eventSource: 'onchain',
                        onChainConfirmed: true,
                        onChainEventType: indexed.kind,
                        onChainTxHash: indexed.txHash,
                        onChainLedger: indexed.ledger,
                        onChainContractId: indexed.contractId,
                        onChainPagingToken: indexed.pagingToken,
                        isSimulated: false
                    })
                    ingested++
                }

                const nextCursor = response.events[response.events.length - 1]?.pagingToken
                if (!nextCursor || nextCursor === cursor) break
                cursor = nextCursor
                startLedger = undefined
            }

            if (cursor) databaseService.setIndexerState(INDEXER_CURSOR_KEY, cursor)
            if (latestLedger) databaseService.setIndexerState(INDEXER_LATEST_LEDGER_KEY, String(latestLedger))

            this.status.lastRunAt = new Date().toISOString()
            this.status.lastError = undefined
            this.status.lastIngestedCount = ingested
            this.status.cursor = cursor
            this.status.latestLedger = latestLedger
            this.status.enabled = true

            return { ingested, latestLedger }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            this.status.lastRunAt = new Date().toISOString()
            this.status.lastError = message
            logger.error('[CHAIN-INDEXER] Sync failed', { error: message })
            return { ingested: 0, latestLedger: this.status.latestLedger }
        } finally {
            this.isSyncing = false
        }
    }

    private toIndexedOnChainEvent(event: SorobanRpc.Api.EventResponse): IndexedOnChainEvent | null {
        const contractId = this.contractIdToString(event.contractId)
        if (!this.isTargetContract(contractId)) return null

        const topics = event.topic.map(topic => this.nativeToString(this.safeScValToNative(topic))).filter(Boolean)
        if (topics.length < 2) return null

        const topicRoot = topics[0].toLowerCase()
        const topicAction = topics[1].toLowerCase()
        if (topicRoot !== 'portfolio') return null

        const payload = this.safeScValToNative(event.value)
        const portfolioId = this.extractPortfolioId(payload)
        if (!portfolioId) return null

        const kind = this.mapTopicToKind(topicAction)
        if (!kind) return null

        let trigger = 'On-chain Event'
        let trades = 0
        if (kind === 'portfolio_created') trigger = 'On-chain Portfolio Created'
        if (kind === 'deposit') trigger = 'On-chain Deposit'
        if (kind === 'rebalance_executed') {
            trigger = 'On-chain Rebalance Executed'
            trades = 1
        }

        return {
            kind,
            portfolioId,
            trigger,
            trades,
            timestamp: event.ledgerClosedAt || new Date().toISOString(),
            txHash: event.txHash,
            ledger: event.ledger,
            contractId,
            pagingToken: event.pagingToken,
            userAddress: this.extractUserAddress(payload)
        }
    }

    private mapTopicToKind(topicAction: string): IndexedEventKind | null {
        if (topicAction === 'created') return 'portfolio_created'
        if (topicAction === 'deposit') return 'deposit'
        if (topicAction === 'rebalanced' || topicAction === 'rebalance_executed' || topicAction === 'executed') {
            return 'rebalance_executed'
        }
        return null
    }

    private extractPortfolioId(payload: unknown): string | undefined {
        if (Array.isArray(payload) && payload.length > 0) {
            const candidate = this.nativeToString(payload[0])
            return candidate || undefined
        }
        if (payload && typeof payload === 'object') {
            const rec = payload as Record<string, unknown>
            const candidate = rec.portfolioId ?? rec.portfolio_id ?? rec.id
            const converted = this.nativeToString(candidate)
            return converted || undefined
        }
        return undefined
    }

    private extractUserAddress(payload: unknown): string | undefined {
        if (Array.isArray(payload) && payload.length > 1) {
            return this.nativeToString(payload[1]) || undefined
        }
        if (payload && typeof payload === 'object') {
            const rec = payload as Record<string, unknown>
            const candidate = rec.user ?? rec.userAddress ?? rec.user_address
            const converted = this.nativeToString(candidate)
            return converted || undefined
        }
        return undefined
    }

    private safeScValToNative(value: any): unknown {
        try {
            return scValToNative(value)
        } catch {
            return undefined
        }
    }

    private nativeToString(value: unknown): string {
        if (value === undefined || value === null) return ''
        if (typeof value === 'string') return value
        if (typeof value === 'number') return String(value)
        if (typeof value === 'bigint') return value.toString()
        if (typeof value === 'object') {
            if (typeof (value as { toString?: () => string }).toString === 'function') {
                const rendered = (value as { toString: () => string }).toString()
                if (rendered !== '[object Object]') return rendered
            }
        }
        return ''
    }

    private contractIdToString(contractId: unknown): string {
        if (!contractId) return ''
        if (typeof contractId === 'string') return contractId

        const maybeContract = contractId as { contractId?: () => string; toString?: () => string }
        if (typeof maybeContract.contractId === 'function') {
            try {
                return maybeContract.contractId()
            } catch {
                // ignore
            }
        }
        if (typeof maybeContract.toString === 'function') {
            try {
                return maybeContract.toString()
            } catch {
                // ignore
            }
        }
        return ''
    }

    private isTargetContract(contractId: string): boolean {
        if (!contractId || !this.contractAddress) return false
        const expectedAddress = this.contractAddress.toLowerCase()
        const actual = contractId.toLowerCase()
        if (actual === expectedAddress) return true
        return actual === this.contractAddressHex().toLowerCase()
    }

    private contractAddressHex(): string {
        try {
            return Address.fromString(this.contractAddress).toBuffer().toString('hex')
        } catch {
            return ''
        }
    }

    private readNumberEnv(name: string, fallback: number, min: number, max: number): number {
        const raw = process.env[name]
        if (!raw) return fallback
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) return fallback
        return Math.max(min, Math.min(max, Math.floor(parsed)))
    }
}

export const contractEventIndexerService = new ContractEventIndexerService()
