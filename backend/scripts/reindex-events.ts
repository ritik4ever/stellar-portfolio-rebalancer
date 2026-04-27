import 'dotenv/config'

const ADMIN_KEY = process.env.ADMIN_REINDEX_KEY?.trim()
if (!ADMIN_KEY) {
    console.error('ADMIN_REINDEX_KEY environment variable is required.')
    console.error('Set it to a non-empty secret to confirm you intend to run this operation.')
    process.exit(1)
}

const args = process.argv.slice(2)

const showHelp = args.includes('--help') || args.includes('-h')
if (showHelp) {
    console.log(`
Usage: npx tsx scripts/reindex-events.ts [options]

Options:
  --full              Reset cursor and re-index from the bootstrap window
  --from-ledger <N>   Reset cursor and start indexing from ledger N
  --dry-run           Preview what would happen without writing to the database
  --help, -h          Show this help message

Environment:
  ADMIN_REINDEX_KEY   Required. Must be set to confirm intentional reindex.

Examples:
  npx tsx scripts/reindex-events.ts --full
  npx tsx scripts/reindex-events.ts --from-ledger 50000
  npx tsx scripts/reindex-events.ts --full --dry-run
`)
    process.exit(0)
}

const fullReindex = args.includes('--full')
const dryRun = args.includes('--dry-run')
const fromLedgerIdx = args.indexOf('--from-ledger')
const fromLedger = fromLedgerIdx !== -1 ? Number(args[fromLedgerIdx + 1]) : undefined

if (!fullReindex && fromLedger === undefined) {
    console.error('Specify --full or --from-ledger <N>. Use --help for usage.')
    process.exit(1)
}

if (fromLedger !== undefined && (!Number.isFinite(fromLedger) || fromLedger < 1)) {
    console.error('--from-ledger must be a positive integer.')
    process.exit(1)
}

async function main() {
    const { contractEventIndexerService } = await import('../src/services/contractEventIndexer.js')

    const before = contractEventIndexerService.getCursorInfo()
    console.log('Current indexer state:')
    console.log('  cursor:', before.cursor || '(none)')
    console.log('  latestLedger:', before.latestLedger ?? '(none)')
    console.log('  lastSuccessfulSync:', before.lastSuccessfulSyncAt ?? '(never)')
    console.log()

    if (!contractEventIndexerService.isEnabled()) {
        console.error('Indexer is disabled. Set CONTRACT_ADDRESS/STELLAR_CONTRACT_ADDRESS and an RPC URL.')
        process.exit(1)
    }

    if (dryRun) {
        console.log('[DRY RUN] Would reset cursor and sync events.')
        if (fullReindex) {
            console.log('[DRY RUN] Mode: full reindex (bootstrap from chain tip window)')
        } else {
            console.log(`[DRY RUN] Mode: backfill from ledger ${fromLedger}`)
        }
        console.log('[DRY RUN] No changes made.')
        process.exit(0)
    }

    if (fullReindex) {
        console.log('Resetting cursor for full reindex...')
        contractEventIndexerService.resetCursor()
    } else if (fromLedger !== undefined) {
        console.log(`Resetting cursor to start from ledger ${fromLedger}...`)
        contractEventIndexerService.resetCursor(fromLedger)
    }

    console.log('Running sync...')
    const result = await contractEventIndexerService.syncOnce()
    console.log(`Sync complete: ingested ${result.ingested} events, latestLedger=${result.latestLedger ?? '(unknown)'}`)

    const after = contractEventIndexerService.getCursorInfo()
    console.log()
    console.log('Updated indexer state:')
    console.log('  cursor:', after.cursor || '(none)')
    console.log('  latestLedger:', after.latestLedger ?? '(none)')
    console.log('  lastSuccessfulSync:', after.lastSuccessfulSyncAt ?? '(never)')

    if (after.lastError) {
        console.error('  lastError:', after.lastError)
        process.exit(1)
    }
}

main().catch((err) => {
    console.error('Reindex failed:', err)
    process.exit(1)
})
