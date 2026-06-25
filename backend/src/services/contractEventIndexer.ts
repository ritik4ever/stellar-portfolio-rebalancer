import { Address, SorobanRpc, scValToNative } from "@stellar/stellar-sdk";
import { databaseService, type IndexerCursorState } from "./databaseService.js";
import { logger } from "../utils/logger.js";
import {
  BACKEND_CONTRACT_EVENT_SCHEMA_VERSION,
  checkContractEventSchemaVersion,
} from "../config/contractEventSchema.js";

type IndexedEventKind = "portfolio_created" | "deposit" | "rebalance_executed";

interface IndexedOnChainEvent {
  kind: IndexedEventKind;
  portfolioId: string;
  trigger: string;
  timestamp: string;
  trades: number;
  txHash: string;
  ledger: number;
  contractId: string;
  pagingToken: string;
  userAddress?: string;
}

interface ContractEventIndexerStatus {
    enabled: boolean
    running: boolean
    contractAddress?: string
    rpcUrl?: string
    pollIntervalMs: number
    lastRunAt?: string
    lastSuccessfulRunAt?: string
    lastFailedRunAt?: string
    lastError?: string
    lastIngestedCount: number
    cursor?: string
    latestLedger?: number
    consecutiveFailures: number
    recentErrors: string[]
    expectedEventSchemaVersion: number
    declaredEventSchemaVersion?: number
    contractEventSchemaOk: boolean
    replayValidation?: {
        lastReplayedLedger: number | undefined
        eventCount: number
        integrityHash: string | undefined
    }
}

interface ReplayValidationResult {
    valid: boolean
    eventsReplayed: number
    totalEvents: number
    ledgerRange: { start: number; end: number }
    integrityHash: string
    errors: string[]
}

const INDEXER_STATE_NAME = "soroban_event_indexer";

const MAX_RECENT_ERRORS = 10;
const MAX_RPC_RETRIES = 3;
const RPC_BASE_DELAY_MS = 1000;
const RPC_MAX_DELAY_MS = 30000;
const MAX_CONSECUTIVE_FAILURES_BEFORE_BACKOFF = 5;

export class ContractEventIndexerService {
  private readonly contractAddress = (
    process.env.CONTRACT_ADDRESS ||
    process.env.STELLAR_CONTRACT_ADDRESS ||
    ""
  ).trim();
  private readonly stellarNetwork = (process.env.STELLAR_NETWORK || "testnet")
    .trim()
    .toLowerCase();
  private readonly defaultRpcUrl =
    this.stellarNetwork === "mainnet"
      ? "https://soroban-rpc.mainnet.stellar.gateway.fm"
      : "https://soroban-testnet.stellar.org";
  private readonly rpcUrl = (
    process.env.SOROBAN_RPC_URL ||
    process.env.STELLAR_RPC_URL ||
    this.defaultRpcUrl
  ).trim();
  private readonly pollIntervalMs = this.readNumberEnv(
    "SOROBAN_EVENT_INDEXER_INTERVAL_MS",
    15000,
    3000,
    300000,
  );
  private readonly pageLimit = this.readNumberEnv(
    "SOROBAN_EVENT_INDEXER_LIMIT",
    100,
    1,
    200,
  );
  private readonly bootstrapWindowLedgers = this.readNumberEnv(
    "SOROBAN_EVENT_INDEXER_BOOTSTRAP_WINDOW",
    500,
    1,
    50000,
  );
  private readonly maxPagesPerSync = this.readNumberEnv(
    "SOROBAN_EVENT_INDEXER_MAX_PAGES",
    10,
    1,
    100,
  );
  private readonly rpcServer = new SorobanRpc.Server(this.rpcUrl, {
    allowHttp: this.rpcUrl.startsWith("http://"),
  });

  private pollingTimer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private consecutiveFailures = 0;
  private recentErrors: string[] = [];
  private status: ContractEventIndexerStatus = {
    enabled: false,
    running: false,
    pollIntervalMs: this.pollIntervalMs,
    lastIngestedCount: 0,
    consecutiveFailures: 0,
    recentErrors: [],
    expectedEventSchemaVersion: BACKEND_CONTRACT_EVENT_SCHEMA_VERSION,
    contractEventSchemaOk: true,
  };

  private readonly seenEventKeys = new Set<string>();

  constructor() {
    this.status.enabled = this.isEnabled();
    this.status.contractAddress = this.contractAddress || undefined;
    this.status.rpcUrl = this.rpcUrl || undefined;
    const declared = process.env.CONTRACT_EVENT_SCHEMA_VERSION?.trim();
    if (declared) {
      const n = parseInt(declared, 10);
      if (/^\d+$/.test(declared)) this.status.declaredEventSchemaVersion = n;
    }
  }

  isEnabled(): boolean {
    return this.contractAddress.length > 0 && this.rpcUrl.length > 0;
  }

  getStatus(): ContractEventIndexerStatus {
    const storedState = this.loadPersistedState();
    return {
      ...this.status,
      running: this.pollingTimer !== null,
      cursor: storedState.cursor ?? this.status.cursor,
      latestLedger: storedState.latestLedger ?? this.status.latestLedger,
      lastSuccessfulRunAt:
        storedState.lastSuccessfulSyncAt ?? this.status.lastSuccessfulRunAt,
      lastFailedRunAt: storedState.lastFailedSyncAt ?? this.status.lastFailedRunAt,
      lastError: storedState.lastError ?? this.status.lastError,
      consecutiveFailures: this.consecutiveFailures,
      recentErrors: [...this.recentErrors],
    };
  }

  getCursorInfo(): {
    cursor: string | undefined;
    latestLedger: number | undefined;
    lastSuccessfulSyncAt: string | undefined;
    lastFailedSyncAt: string | undefined;
    lastError: string | undefined;
    pollIntervalMs: number;
    bootstrapWindowLedgers: number;
    consecutiveFailures: number;
    recentErrors: string[];
  } {
    const storedState = this.loadPersistedState();

    return {
      cursor: storedState.cursor,
      latestLedger: storedState.latestLedger,
      lastSuccessfulSyncAt:
        storedState.lastSuccessfulSyncAt ?? this.status.lastSuccessfulRunAt,
      lastFailedSyncAt:
        storedState.lastFailedSyncAt ?? this.status.lastFailedRunAt,
      lastError: storedState.lastError ?? this.status.lastError,
      pollIntervalMs: this.pollIntervalMs,
      bootstrapWindowLedgers: this.bootstrapWindowLedgers,
      consecutiveFailures: this.consecutiveFailures,
      recentErrors: [...this.recentErrors],
    };
  }

  resetCursor(fromLedger?: number): void {
    const resetState = databaseService.resetContractEventIndexerState(
      fromLedger,
      INDEXER_STATE_NAME,
    );
    this.status.cursor = resetState.cursor;
    this.status.latestLedger = resetState.latestLedger;
    this.status.lastSuccessfulRunAt = resetState.lastSuccessfulSyncAt;
    this.status.lastFailedRunAt = resetState.lastFailedSyncAt;
    this.status.lastError = resetState.lastError;
    logger.info("[CHAIN-INDEXER] Cursor reset", { fromLedger });
  }

  async start(): Promise<void> {
    if (!this.isEnabled()) {
      logger.warn("[CHAIN-INDEXER] Disabled (missing contract or RPC URL)");
      return;
    }

    if (this.pollingTimer) return;

    logger.info("[CHAIN-INDEXER] Starting contract event indexer", {
      contractAddress: this.contractAddress,
      pollIntervalMs: this.pollIntervalMs,
    });

    await this.syncOnce();
    this.pollingTimer = setInterval(() => {
      void this.syncWithBackoff();
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (!this.pollingTimer) return;
    clearInterval(this.pollingTimer);
    this.pollingTimer = null;
    logger.info("[CHAIN-INDEXER] Stopped");
  }

  private async syncWithBackoff(): Promise<void> {
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_BEFORE_BACKOFF) {
      const backoffMs = Math.min(
        RPC_BASE_DELAY_MS *
          Math.pow(
            2,
            this.consecutiveFailures - MAX_CONSECUTIVE_FAILURES_BEFORE_BACKOFF,
          ),
        RPC_MAX_DELAY_MS,
      );
      logger.warn("[CHAIN-INDEXER] Backing off due to consecutive failures", {
        consecutiveFailures: this.consecutiveFailures,
        backoffMs,
      });
      await this.sleep(backoffMs);
    }
    await this.syncOnce();
  }

  async syncOnce(): Promise<{ ingested: number; latestLedger?: number }> {
    if (!this.isEnabled()) return { ingested: 0 };
    if (this.isSyncing)
      return { ingested: 0, latestLedger: this.status.latestLedger };

    const schemaCheck = checkContractEventSchemaVersion();
    if (!schemaCheck.ok) {
      this.status.lastRunAt = new Date().toISOString();
      this.status.lastError = schemaCheck.message;
      this.status.contractEventSchemaOk = false;
      logger.error("[CHAIN-INDEXER] Contract event schema mismatch", {
        message: schemaCheck.message,
      });
      return { ingested: 0, latestLedger: this.status.latestLedger };
    }
    this.status.contractEventSchemaOk = true;

    this.isSyncing = true;
    try {
      const storedState = this.loadPersistedState();
      const storedCursor = storedState.cursor;
      const storedLatestLedger = storedState.latestLedger;

      let cursor = storedCursor;
      let startLedger: number | undefined;
      if (!cursor) {
        const latest = await this.rpcCallWithRetry(() =>
          this.rpcServer.getLatestLedger(),
        );
        const floorLedger = Math.max(
          1,
          latest.sequence - this.bootstrapWindowLedgers,
        );
        startLedger = storedLatestLedger
          ? Math.max(1, storedLatestLedger - 1)
          : floorLedger;
      }

      let ingested = 0;
      let latestLedger = storedLatestLedger;
      let pagesRead = 0;

      while (pagesRead < this.maxPagesPerSync) {
        const response = await this.rpcCallWithRetry(() =>
          this.rpcServer.getEvents({
            cursor,
            startLedger,
            limit: this.pageLimit,
            filters: [{ type: "contract" }],
          }),
        );
        pagesRead++;
        latestLedger = response.latestLedger;

        if (!response.events.length) {
          if (latestLedger) this.persistCursorState({ latestLedger });
          break;
        }

        for (const event of response.events) {
          let indexed: ReturnType<typeof this.toIndexedOnChainEvent>;
          try {
            indexed = this.toIndexedOnChainEvent(event);
          } catch (err) {
            logger.warn("[CHAIN-INDEXER] Skipping malformed event", {
              error: String(err),
              txHash: event.txHash,
            });
            continue;
          }
          if (!indexed) continue;

          const dedupKey = `${indexed.ledger}:${indexed.txHash}:${indexed.kind}:${indexed.portfolioId}`;
          if (this.seenEventKeys.has(dedupKey)) {
            continue;
          }
          this.seenEventKeys.add(dedupKey);

          // Prevent unbounded memory growth
          if (this.seenEventKeys.size > 10000) {
            const iterator = this.seenEventKeys.values();
            for (let i = 0; i < 1000; i++) {
              const val = iterator.next().value;
              if (val !== undefined) {
                this.seenEventKeys.delete(val);
              }
            }
          }

          databaseService.ensurePortfolioExists(
            indexed.portfolioId,
            indexed.userAddress || "ONCHAIN-INDEXER",
          );
          databaseService.recordRebalanceEvent({
            portfolioId: indexed.portfolioId,
            timestamp: indexed.timestamp,
            trigger: indexed.trigger,
            trades: indexed.trades,
            gasUsed: "on-chain",
            status: "completed",
            isAutomatic: false,
            eventSource: "onchain",
            onChainConfirmed: true,
            onChainEventType: indexed.kind,
            onChainTxHash: indexed.txHash,
            onChainLedger: indexed.ledger,
            onChainContractId: indexed.contractId,
            onChainPagingToken: indexed.pagingToken,
            isSimulated: false,
          });
          ingested++;
        }

        const previousCursor = cursor;
        const nextCursor =
          response.events[response.events.length - 1]?.pagingToken;
        if (nextCursor) {
          cursor = nextCursor;
          this.persistCursorState({ cursor, latestLedger });
          logger.debug("[CHAIN-INDEXER] Persisted page cursor", {
            cursor,
            latestLedger,
            pagesRead,
          });
        } else if (latestLedger) {
          this.persistCursorState({ latestLedger });
        }

        if (!nextCursor || nextCursor === previousCursor) break;
        startLedger = undefined;
      }

      this.status.lastRunAt = new Date().toISOString();
      this.status.lastSuccessfulRunAt = this.status.lastRunAt;
      this.persistCursorState({
        cursor,
        latestLedger,
        lastSuccessfulSyncAt: this.status.lastSuccessfulRunAt,
        lastError: undefined,
      });
      this.status.lastError = undefined;
      this.status.lastIngestedCount = ingested;
      this.status.cursor = cursor;
      this.status.latestLedger = latestLedger;
      this.status.enabled = true;
      this.consecutiveFailures = 0;

      return { ingested, latestLedger };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now = new Date().toISOString();
      this.status.lastRunAt = now;
      this.status.lastFailedRunAt = now;
      this.status.lastError = message;
      this.consecutiveFailures++;
      this.pushRecentError(`[${now}] ${message}`);
      this.persistCursorState({
        lastFailedSyncAt: now,
        lastError: message,
      });
      logger.error("[CHAIN-INDEXER] Sync failed", {
        error: message,
        consecutiveFailures: this.consecutiveFailures,
        cursor: this.status.cursor,
        latestLedger: this.status.latestLedger,
      });
      return { ingested: 0, latestLedger: this.status.latestLedger };
    } finally {
      this.isSyncing = false;
    }
  }

  private loadPersistedState(): IndexerCursorState {
    try {
      return databaseService.getContractEventIndexerState(INDEXER_STATE_NAME);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[CHAIN-INDEXER] Failed to read persisted cursor state", {
        error: message,
      });
      return { name: INDEXER_STATE_NAME };
    }
  }

  private persistCursorState(
    state: Partial<Omit<IndexerCursorState, "name">>,
  ): void {
    const persisted = databaseService.saveContractEventIndexerState(
      state,
      INDEXER_STATE_NAME,
    );
    this.status.cursor = persisted.cursor;
    this.status.latestLedger = persisted.latestLedger;
    this.status.lastSuccessfulRunAt = persisted.lastSuccessfulSyncAt;
    this.status.lastFailedRunAt = persisted.lastFailedSyncAt;
    this.status.lastError = persisted.lastError;
  }

  private async rpcCallWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RPC_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RPC_RETRIES) {
          const delay = Math.min(
            RPC_BASE_DELAY_MS * Math.pow(2, attempt),
            RPC_MAX_DELAY_MS,
          );
          logger.warn("[CHAIN-INDEXER] RPC call failed, retrying", {
            attempt: attempt + 1,
            maxRetries: MAX_RPC_RETRIES,
            delayMs: delay,
            error: lastError.message,
          });
          await this.sleep(delay);
        }
      }
    }
    throw lastError;
  }

    computeIngestedEventsHash(): string {
        const hash = createHash('sha256')
        const events = databaseService.getRebalanceHistory(undefined, 1000)
        for (const ev of events) {
            hash.update(ev.id)
            hash.update(ev.portfolioId)
            hash.update(ev.timestamp)
            hash.update(ev.status)
        }
        return hash.digest('hex')
    }

    async validateReplay(ledgerRange?: { start: number; end: number }): Promise<ReplayValidationResult> {
        const errors: string[] = []
        const checkpoint = databaseService.getReplayStatus()
        const currentHash = this.computeIngestedEventsHash()

        const storedHash = databaseService.getReplayIntegrityHash()
        if (storedHash && storedHash !== currentHash) {
            errors.push(`Integrity hash mismatch: stored=${storedHash}, current=${currentHash}`)
        }

        const events = databaseService.getRebalanceHistory(undefined, 5000)
        const onChainEvents = events.filter((e) => e.eventSource === 'onchain')
        const eventIds = new Set<string>()
        for (const ev of onChainEvents) {
            if (eventIds.has(ev.id)) {
                errors.push(`Duplicate event ID detected: ${ev.id}`)
            }
            eventIds.add(ev.id)
        }

        let lastLedger = 0
        for (const ev of onChainEvents) {
            const ledger = ev.onChainLedger ?? 0
            if (ledger > 0 && ledger < lastLedger) {
                errors.push(`Out-of-order event: ${ev.id} ledger ${ledger} < previous ${lastLedger}`)
            }
            if (ledger > 0) lastLedger = ledger
        }

        if (ledgerRange) {
            const inRange = onChainEvents.filter((ev) => {
                const l = ev.onChainLedger ?? 0
                return l >= ledgerRange.start && l <= ledgerRange.end
            })
            if (inRange.length === 0) {
                errors.push(`No events found in ledger range ${ledgerRange.start}-${ledgerRange.end}`)
            }
        }

        return {
            valid: errors.length === 0,
            eventsReplayed: onChainEvents.length,
            totalEvents: events.length,
            ledgerRange: ledgerRange ?? { start: 0, end: lastLedger },
            integrityHash: currentHash,
            errors,
        }
    }

    async replayEvents(ledgerRange?: { start: number; end: number }): Promise<{
        ingested: number
        validation: ReplayValidationResult
    }> {
        if (!this.isEnabled()) {
            return { ingested: 0, validation: await this.validateReplay(ledgerRange) }
        }

        if (!ledgerRange) {
            const latest = await this.rpcCallWithRetry(() => this.rpcServer.getLatestLedger())
            ledgerRange = {
                start: Math.max(1, latest.sequence - this.bootstrapWindowLedgers),
                end: latest.sequence,
            }
        }

        const result = await this.syncOnce()
        const validation = await this.validateReplay(ledgerRange)

        if (validation.valid) {
            const hash = this.computeIngestedEventsHash()
            databaseService.setReplayIntegrityHash(hash)
            databaseService.setLastReplayedLedger(ledgerRange.end)
            databaseService.setReplayEventCount(validation.eventsReplayed)

            const replayId = `replay_${ledgerRange.start}_${ledgerRange.end}_${Date.now()}`
            databaseService.setReplayCheckpoint(replayId, {
                startLedger: ledgerRange.start,
                endLedger: ledgerRange.end,
                eventCount: validation.eventsReplayed,
                integrityHash: hash,
                timestamp: new Date().toISOString(),
            })
        }

        this.status.replayValidation = {
            lastReplayedLedger: ledgerRange.end,
            eventCount: validation.eventsReplayed,
            integrityHash: validation.integrityHash,
        }

        return { ingested: result.ingested, validation }
    }

    async syncOnce(): Promise<{ ingested: number; latestLedger?: number }> {
        if (!this.isEnabled()) return { ingested: 0 }
        if (this.isSyncing) return { ingested: 0, latestLedger: this.status.latestLedger }

        const schemaCheck = checkContractEventSchemaVersion()
        if (!schemaCheck.ok) {
            this.status.lastRunAt = new Date().toISOString()
            this.status.lastError = schemaCheck.message
            this.status.contractEventSchemaOk = false
            logger.error('[CHAIN-INDEXER] Contract event schema mismatch', { message: schemaCheck.message })
            return { ingested: 0, latestLedger: this.status.latestLedger }
        }
        this.status.contractEventSchemaOk = true

        this.isSyncing = true
        try {
            const storedCursor = databaseService.getIndexerState(INDEXER_CURSOR_KEY)
            const storedLatestLedger = Number(databaseService.getIndexerState(INDEXER_LATEST_LEDGER_KEY) || 0) || undefined

            let cursor = storedCursor
            let startLedger: number | undefined
            if (!cursor) {
                const latest = await this.rpcCallWithRetry(() => this.rpcServer.getLatestLedger())
                const floorLedger = Math.max(1, latest.sequence - this.bootstrapWindowLedgers)
                startLedger = storedLatestLedger ? Math.max(1, storedLatestLedger - 1) : floorLedger
            }

            let ingested = 0
            let latestLedger = storedLatestLedger
            let pagesRead = 0

            while (pagesRead < this.maxPagesPerSync) {
                const response = await this.rpcCallWithRetry(() =>
                    this.rpcServer.getEvents({
                        cursor,
                        startLedger,
                        limit: this.pageLimit,
                        filters: [{ type: 'contract' }]
                    })
                )
                pagesRead++
                latestLedger = response.latestLedger

                if (!response.events.length) break

                for (const event of response.events) {
                    let indexed: ReturnType<typeof this.toIndexedOnChainEvent>
                    try {
                        indexed = this.toIndexedOnChainEvent(event)
                    } catch (err) {
                        logger.warn('[CHAIN-INDEXER] Skipping malformed event', { error: String(err), txHash: event.txHash })
                        continue
                    }
                    if (!indexed) continue

                    const dedupKey = `${indexed.ledger}:${indexed.txHash}:${indexed.kind}:${indexed.portfolioId}`
                    if (this.seenEventKeys.has(dedupKey)) {
                        continue
                    }
                    this.seenEventKeys.add(dedupKey)
                    
                    // Prevent unbounded memory growth
                    if (this.seenEventKeys.size > 10000) {
                        const iterator = this.seenEventKeys.values()
                        for (let i = 0; i < 1000; i++) {
                            const val = iterator.next().value
                            if (val !== undefined) {
                                this.seenEventKeys.delete(val)
                            }
                        }
                    }

                    databaseService.ensurePortfolioExists(indexed.portfolioId, indexed.userAddress || 'ONCHAIN-INDEXER')
                    databaseService.recordRebalanceEvent({
                        portfolioId: indexed.portfolioId,
                        timestamp: indexed.timestamp,
                        trigger: indexed.trigger,
                        reasonCode: 'ON_CHAIN_SYNC',
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
            this.status.lastSuccessfulRunAt = this.status.lastRunAt
            this.status.lastError = undefined
            this.status.lastIngestedCount = ingested
            this.status.cursor = cursor
            this.status.latestLedger = latestLedger
            this.status.enabled = true
            this.consecutiveFailures = 0

            return { ingested, latestLedger }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const now = new Date().toISOString()
            this.status.lastRunAt = now
            this.status.lastFailedRunAt = now
            this.status.lastError = message
            this.consecutiveFailures++
            this.pushRecentError(`[${now}] ${message}`)
            logger.error('[CHAIN-INDEXER] Sync failed', {
                error: message,
                consecutiveFailures: this.consecutiveFailures
            })
            return { ingested: 0, latestLedger: this.status.latestLedger }
        } finally {
            this.isSyncing = false
        }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private toIndexedOnChainEvent(
    event: SorobanRpc.Api.EventResponse,
  ): IndexedOnChainEvent | null {
    const contractId = this.contractIdToString(event.contractId);
    if (!this.isTargetContract(contractId)) return null;

    const topics = event.topic
      .map((topic) => this.nativeToString(this.safeScValToNative(topic)))
      .filter(Boolean);
    if (topics.length < 2) return null;

    const topicRoot = topics[0].toLowerCase();
    const topicAction = topics[1].toLowerCase();
    if (topicRoot !== "portfolio") return null;

    const payload = this.safeScValToNative(event.value);
    const portfolioId = this.extractPortfolioId(payload);
    if (!portfolioId) return null;

    const kind = this.mapTopicToKind(topicAction);
    if (!kind) return null;

    let trigger = "On-chain Event";
    let trades = 0;
    if (kind === "portfolio_created") trigger = "On-chain Portfolio Created";
    if (kind === "deposit") trigger = "On-chain Deposit";
    if (kind === "rebalance_executed") {
      trigger = "On-chain Rebalance Executed";
      trades = 1;
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
      userAddress: this.extractUserAddress(payload),
    };
  }

  private mapTopicToKind(topicAction: string): IndexedEventKind | null {
    if (topicAction === "created") return "portfolio_created";
    if (topicAction === "deposit") return "deposit";
    if (
      topicAction === "rebalanced" ||
      topicAction === "rebalance_executed" ||
      topicAction === "executed"
    ) {
      return "rebalance_executed";
    }
    return null;
  }

  private extractPortfolioId(payload: unknown): string | undefined {
    if (Array.isArray(payload) && payload.length > 0) {
      const candidate = this.nativeToString(payload[0]);
      return candidate || undefined;
    }
    if (payload && typeof payload === "object") {
      const rec = payload as Record<string, unknown>;
      const candidate = rec.portfolioId ?? rec.portfolio_id ?? rec.id;
      const converted = this.nativeToString(candidate);
      return converted || undefined;
    }
    return undefined;
  }

  private extractUserAddress(payload: unknown): string | undefined {
    if (Array.isArray(payload) && payload.length > 1) {
      return this.nativeToString(payload[1]) || undefined;
    }
    if (payload && typeof payload === "object") {
      const rec = payload as Record<string, unknown>;
      const candidate = rec.user ?? rec.userAddress ?? rec.user_address;
      const converted = this.nativeToString(candidate);
      return converted || undefined;
    }
    return undefined;
  }

  private safeScValToNative(value: any): unknown {
    try {
      return scValToNative(value);
    } catch {
      return undefined;
    }
  }

  private nativeToString(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "object") {
      if (
        typeof (value as { toString?: () => string }).toString === "function"
      ) {
        const rendered = (value as { toString: () => string }).toString();
        if (rendered !== "[object Object]") return rendered;
      }
    }
    return "";
  }

  private contractIdToString(contractId: unknown): string {
    if (!contractId) return "";
    if (typeof contractId === "string") return contractId;

    const maybeContract = contractId as {
      contractId?: () => string;
      toString?: () => string;
    };
    if (typeof maybeContract.contractId === "function") {
      try {
        return maybeContract.contractId();
      } catch {
        // ignore
      }
    }
    if (typeof maybeContract.toString === "function") {
      try {
        return maybeContract.toString();
      } catch {
        // ignore
      }
    }
    return "";
  }

  private isTargetContract(contractId: string): boolean {
    if (!contractId || !this.contractAddress) return false;
    const expectedAddress = this.contractAddress.toLowerCase();
    const actual = contractId.toLowerCase();
    if (actual === expectedAddress) return true;
    return actual === this.contractAddressHex().toLowerCase();
  }

  private contractAddressHex(): string {
    try {
      return Address.fromString(this.contractAddress)
        .toBuffer()
        .toString("hex");
    } catch {
      return "";
    }
  }

  private readNumberEnv(
    name: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  }
}

export const contractEventIndexerService = new ContractEventIndexerService();
