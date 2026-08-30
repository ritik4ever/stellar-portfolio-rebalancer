import { contractEventIndexerService } from './contractEventIndexer.js'
import { logger } from '../utils/logger.js'

export interface ReplayResult {
    success: boolean
    fromLedger: number
    ingested: number
    latestLedger?: number
    cursorAfter?: string
    message: string
}

/**
 * Service for replaying contract events from a given ledger.
 *
 * Wraps the existing {@link ContractEventIndexerService} reset + sync
 * workflow into an HTTP-callable replay operation.  Deduplication is
 * handled at two levels:
 *   1. In-memory `seenEventKeys` set in the indexer (within process lifetime)
 *   2. Database-level unique event IDs per insert
 *
 * Resumability is inherent: the indexer persists its cursor after every
 * page, so an interrupted replay can be resumed by calling replay again
 * with the same `from_ledger` — already-ingested pages are skipped via
 * the stored cursor.
 */
export class ContractEventsService {
    /**
     * Replay (re-index) contract events starting from the given ledger.
     *
     * @param fromLedger - The ledger sequence number to start replaying from (≥ 1).
     * @returns Structured replay result with ingested count and cursor state.
     */
    async replayFromLedger(fromLedger: number): Promise<ReplayResult> {
        if (!Number.isInteger(fromLedger) || fromLedger < 1) {
            return {
                success: false,
                fromLedger,
                ingested: 0,
                message: 'from_ledger must be a positive integer'
            }
        }

        if (!contractEventIndexerService.isEnabled()) {
            return {
                success: false,
                fromLedger,
                ingested: 0,
                message: 'Contract event indexer is disabled. Set CONTRACT_ADDRESS and an RPC URL.'
            }
        }

        logger.info('[CONTRACT-EVENTS] Starting event replay', { fromLedger })

        // Reset cursor to the requested ledger so syncOnce() re-fetches from there
        contractEventIndexerService.resetCursor(fromLedger)

        logger.info('[CONTRACT-EVENTS] Cursor reset, beginning sync from ledger', {
            fromLedger
        })

        const result = await contractEventIndexerService.syncOnce()

        const cursorInfo = contractEventIndexerService.getCursorInfo()

        logger.info('[CONTRACT-EVENTS] Replay completed', {
            fromLedger,
            ingested: result.ingested,
            latestLedger: result.latestLedger,
            cursorAfter: cursorInfo.cursor
        })

        return {
            success: true,
            fromLedger,
            ingested: result.ingested,
            latestLedger: result.latestLedger,
            cursorAfter: cursorInfo.cursor,
            message: result.ingested > 0
                ? `Replay complete: ingested ${result.ingested} event(s) from ledger ${fromLedger}`
                : `Replay complete: no new events found from ledger ${fromLedger}`
        }
    }
}

export const contractEventsService = new ContractEventsService()
