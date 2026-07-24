import { contractEventIndexerService } from '../src/services/contractEventIndexer.js'
import { databaseService } from '../src/services/databaseService.js'

async function main() {
  const args = process.argv.slice(2)
  const mode = args[0] || 'validate'

  console.log(`[REPLAY] Mode: ${mode}`)

  if (mode === 'validate') {
    const validation = await contractEventIndexerService.validateReplay()
    console.log(`[REPLAY] Validation result:`)
    console.log(`  Valid: ${validation.valid}`)
    console.log(`  Events replayed: ${validation.eventsReplayed}`)
    console.log(`  Total events: ${validation.totalEvents}`)
    console.log(`  Integrity hash: ${validation.integrityHash}`)
    if (validation.errors.length > 0) {
      console.log(`  Errors:`)
      for (const err of validation.errors) {
        console.log(`    - ${err}`)
      }
      process.exit(1)
    }
    console.log(`[REPLAY] Validation passed.`)
  } else if (mode === 'replay') {
    const startLedger = args[1] ? parseInt(args[1], 10) : undefined
    const endLedger = args[2] ? parseInt(args[2], 10) : undefined
    const ledgerRange = startLedger && endLedger ? { start: startLedger, end: endLedger } : undefined

    console.log(`[REPLAY] Replaying events${ledgerRange ? ` (ledgers ${ledgerRange.start}-${ledgerRange.end})` : ''}`)
    const result = await contractEventIndexerService.replayEvents(ledgerRange)
    console.log(`[REPLAY] Ingested: ${result.ingested}`)
    console.log(`[REPLAY] Validation: valid=${result.validation.valid}, events=${result.validation.eventsReplayed}`)
    if (!result.validation.valid) {
      for (const err of result.validation.errors) {
        console.error(`[REPLAY] Error: ${err}`)
      }
      process.exit(1)
    }
    console.log(`[REPLAY] Replay completed successfully.`)
  } else if (mode === 'status') {
    const status = databaseService.getReplayStatus()
    console.log(`[REPLAY] Status:`)
    console.log(`  Last replayed ledger: ${status.lastReplayedLedger ?? 'never'}`)
    console.log(`  Event count: ${status.eventCount}`)
    console.log(`  Integrity hash: ${status.integrityHash ?? 'not set'}`)
  } else {
    console.error(`[REPLAY] Unknown mode: ${mode}`)
    console.error(`Usage: npx tsx scripts/verify-replay.ts [validate|replay|status] [startLedger endLedger]`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[REPLAY] Fatal error:', err)
  process.exit(1)
})
