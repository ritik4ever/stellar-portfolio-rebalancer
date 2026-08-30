import { buildStartupSummary, validateStartupConfigOrThrow } from '../config/startupConfig.js'
import { logger } from '../utils/logger.js'
import { probeRedis } from '../queue/connection.js'
import { QUEUE_NAMES } from '../queue/queues.js'

/**
 * `degraded` marks a dependency that is down but does not stop the service from
 * running — the process starts, `report.ok` stays true, and the check is listed
 * separately so operators still see it.
 */
type SelfTestStatus = 'passed' | 'failed' | 'degraded'

export interface StartupSelfTestCheck {
    name: string
    status: SelfTestStatus
    message: string
    remediation?: string
    details?: Record<string, unknown>
}

export interface StartupSelfTestReport {
    ok: boolean
    timestamp: string
    durationMs: number
    summary: {
        totalChecks: number
        passedChecks: number
        failedChecks: number
        degradedChecks: number
    }
    config: Record<string, unknown>
    checks: StartupSelfTestCheck[]
}

const QUEUE_CHECK_TIMEOUT_MS = 3000
const PROVIDER_CHECK_TIMEOUT_MS = 5000
const ORACLE_CHECK_TIMEOUT_MS = 5000

export async function runStartupSelfTest(
    env: NodeJS.ProcessEnv = process.env,
): Promise<StartupSelfTestReport> {
    const startedAt = Date.now()
    const checks: StartupSelfTestCheck[] = []

    let config: ReturnType<typeof validateStartupConfigOrThrow>
    try {
        config = validateStartupConfigOrThrow(env)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const report = buildReport({
            startedAt,
            config: {},
            checks: [
                {
                    name: 'config',
                    status: 'failed',
                    message: 'Startup configuration validation failed',
                    remediation: 'Fix the invalid backend environment variables and rerun the self-test.',
                    details: { error: message },
                },
            ],
        })
        logger.error('[STARTUP] Self-test failed during config validation', {
            error: message,
        })
        return report
    }

    checks.push({
        name: 'config',
        status: 'passed',
        message: 'Startup configuration validated',
        details: buildStartupSummary(config),
    })

    const databaseCheck = await checkDatabase()
    checks.push(databaseCheck)

    const redisAvailable = await probeRedis()
    const queueChecks = await checkQueues(redisAvailable)
    checks.push(...queueChecks)

    const providerChecks = await checkProviders()
    checks.push(...providerChecks)

    const report = buildReport({
        startedAt,
        config: buildStartupSummary(config, redisAvailable),
        checks,
    })

    const degraded = checks.filter((check) => check.status === 'degraded')
    if (degraded.length > 0) {
        logger.warn('[STARTUP] Self-test completed with degraded dependencies', {
            degraded: degraded.map((check) => ({
                name: check.name,
                message: check.message,
                remediation: check.remediation,
            })),
        })
    }

    if (report.ok) {
        logger.info('[STARTUP] Self-test passed', {
            durationMs: report.durationMs,
            checks: report.summary,
        })
    } else {
        logger.warn('[STARTUP] Self-test failed', {
            durationMs: report.durationMs,
            summary: report.summary,
            failures: checks.filter((check) => check.status === 'failed').map((check) => ({
                name: check.name,
                message: check.message,
                remediation: check.remediation,
            })),
        })
    }

    return report
}

export function formatStartupSelfTestReport(report: StartupSelfTestReport): string {
    const lines = [
        `[STARTUP] Self-test ${report.ok ? 'passed' : 'failed'} in ${report.durationMs}ms`,
        `  checks: ${report.summary.passedChecks}/${report.summary.totalChecks} passed` +
            (report.summary.degradedChecks > 0 ? `, ${report.summary.degradedChecks} degraded` : ''),
    ]

    for (const check of report.checks) {
        const statusLabel =
            check.status === 'passed' ? 'PASS' : check.status === 'degraded' ? 'DEGRADED' : 'FAIL'
        lines.push(`  - ${statusLabel} ${check.name}: ${check.message}`)
        if (check.remediation) {
            lines.push(`    remediation: ${check.remediation}`)
        }
    }

    return lines.join('\n')
}

async function checkDatabase(): Promise<StartupSelfTestCheck> {
    let databaseService: { getReadiness(): { ready: boolean; databasePath: string; error?: string }; close(): void } | undefined
    try {
        const dbModule = await import('../services/databaseService.js')
        databaseService = dbModule.databaseService
        const readiness = databaseService.getReadiness()

        if (!readiness.ready) {
            return {
                name: 'database',
                status: 'failed',
                message: `Database is unavailable at ${readiness.databasePath}`,
                remediation: 'Check DB_PATH, file permissions, and database locks before rerunning the self-test.',
                details: readiness,
            }
        }

        return {
            name: 'database',
            status: 'passed',
            message: 'Database connection is healthy',
            details: readiness,
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
            name: 'database',
            status: 'failed',
            message: 'Database readiness check threw an error',
            remediation: 'Verify the database file or connection settings and rerun the self-test.',
            details: { error: message },
        }
    } finally {
        try {
            databaseService?.close()
        } catch (error) {
            logger.warn('[STARTUP] Failed to close database after self-test', {
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }
}

async function checkQueues(redisAvailable: boolean): Promise<StartupSelfTestCheck[]> {
    if (!redisAvailable) {
        return [
            buildQueueFailureCheck(QUEUE_NAMES.PORTFOLIO_CHECK),
            buildQueueFailureCheck(QUEUE_NAMES.REBALANCE),
            buildQueueFailureCheck(QUEUE_NAMES.ANALYTICS_SNAPSHOT),
            buildQueueFailureCheck(QUEUE_NAMES.IDEMPOTENCY_CLEANUP),
        ]
    }

    const { getPortfolioCheckQueue, getRebalanceQueue, getAnalyticsSnapshotQueue, getIdempotencyCleanupQueue, closeAllQueues } = await import('../queue/queues.js')
    const queueEntries = [
        [QUEUE_NAMES.PORTFOLIO_CHECK, getPortfolioCheckQueue()],
        [QUEUE_NAMES.REBALANCE, getRebalanceQueue()],
        [QUEUE_NAMES.ANALYTICS_SNAPSHOT, getAnalyticsSnapshotQueue()],
        [QUEUE_NAMES.IDEMPOTENCY_CLEANUP, getIdempotencyCleanupQueue()],
    ] as const

    const results = await Promise.all(queueEntries.map(async ([name, queue]) => {
        if (!queue) {
            return {
                name,
                status: 'failed' as const,
                message: `${name} queue could not be created`,
                remediation: 'Confirm REDIS_URL is correct and that BullMQ can connect before rerunning the self-test.',
            }
        }

        try {
            await withTimeout(
                queue.waitUntilReady(),
                QUEUE_CHECK_TIMEOUT_MS,
                `${name} queue readiness timed out`,
            )
            return {
                name,
                status: 'passed' as const,
                message: `${name} queue is ready`,
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return {
                name,
                status: 'failed' as const,
                message: `${name} queue is unavailable`,
                remediation: 'Restart Redis and rerun the self-test after confirming REDIS_URL points to the correct instance.',
                details: { error: message },
            }
        }
    }))

    await closeAllQueues().catch((error: unknown) => {
        logger.warn('[STARTUP] Failed to close queues after self-test', {
            error: error instanceof Error ? error.message : String(error),
        })
    })

    return results
}

async function checkProviders(): Promise<StartupSelfTestCheck[]> {
    const providerChecks: StartupSelfTestCheck[] = []

    try {
        const { runContractDiagnostics } = await import('../services/contractDiagnostics.js')
        const diagnostics = await withTimeout(
            runContractDiagnostics(),
            PROVIDER_CHECK_TIMEOUT_MS,
            'Contract diagnostics timed out',
        )

        providerChecks.push({
            name: 'provider.stellar',
            status: diagnostics.summary.connectivityOk && diagnostics.summary.contractReachable ? 'passed' : 'failed',
            message: diagnostics.summary.connectivityOk && diagnostics.summary.contractReachable
                ? 'Stellar network and contract are reachable'
                : 'Stellar network or contract check failed',
            remediation: diagnostics.summary.connectivityOk && diagnostics.summary.contractReachable
                ? undefined
                : 'Verify STELLAR_HORIZON_URL, STELLAR_NETWORK, and CONTRACT_ADDRESS before rerunning the self-test.',
            details: diagnostics.summary,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        providerChecks.push({
            name: 'provider.stellar',
            status: 'failed',
            message: 'Stellar provider diagnostics failed',
            remediation: 'Verify Stellar Horizon connectivity and the configured contract address, then rerun the self-test.',
            details: { error: message },
        })
    }

    try {
        const { ReflectorService } = await import('../services/reflector.js')
        const reflector = new ReflectorService()
        const connectivity = await withTimeout(
            reflector.testApiConnectivity(),
            PROVIDER_CHECK_TIMEOUT_MS,
            'Price provider connectivity timed out',
        )

        providerChecks.push({
            name: 'provider.price-feed',
            status: connectivity.success ? 'passed' : 'failed',
            message: connectivity.success
                ? 'Price provider connectivity is healthy'
                : 'Price provider connectivity failed',
            remediation: connectivity.success
                ? undefined
                : 'Verify outbound network access to CoinGecko or the configured reflector endpoint and rerun the self-test.',
            details: connectivity.success
                ? connectivity.data
                : { error: connectivity.error ?? 'Unknown price provider failure' },
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        providerChecks.push({
            name: 'provider.price-feed',
            status: 'failed',
            message: 'Price provider diagnostics failed',
            remediation: 'Verify outbound network access to CoinGecko and any API keys or proxy settings, then rerun the self-test.',
            details: { error: message },
        })
    }

    providerChecks.push(await checkReflectorOracle())

    return providerChecks
}

/**
 * Reflector oracle reachability (#1405).
 *
 * The oracle is the *primary* price source; CoinGecko is the fallback, so an
 * unreachable oracle degrades the service rather than stopping it. This check is
 * deliberately separate from `provider.price-feed` so the diagnostic points at
 * the oracle instead of the fallback, and carries the probe's `reason` code so
 * an unconfigured oracle reads differently from a broken one.
 */
async function checkReflectorOracle(): Promise<StartupSelfTestCheck> {
    const name = 'provider.reflector-oracle'

    try {
        const { ReflectorService } = await import('../services/reflector.js')
        const reflector = new ReflectorService()
        const result = await withTimeout(
            reflector.testOracleReachability({ timeoutMs: ORACLE_CHECK_TIMEOUT_MS }),
            ORACLE_CHECK_TIMEOUT_MS + 1000,
            'Reflector oracle reachability check timed out',
        )

        if (result.reason === 'ok') {
            return {
                name,
                status: 'passed',
                message: `Reflector oracle is reachable and serving fresh quotes (${result.latencyMs}ms)`,
                details: { ...result },
            }
        }

        return {
            name,
            status: 'degraded',
            message: ORACLE_MESSAGES[result.reason],
            remediation: ORACLE_REMEDIATIONS[result.reason],
            details: { ...result },
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
            name,
            status: 'degraded',
            message: 'Reflector oracle reachability probe threw an error',
            remediation:
                'Inspect the Reflector oracle client configuration; the service will keep running on fallback prices.',
            details: { error: message, reason: 'unreachable' },
        }
    }
}

const ORACLE_MESSAGES: Record<string, string> = {
    not_configured: 'Reflector oracle is not configured — running on fallback price sources only',
    unreachable: 'Reflector oracle is unreachable — running on fallback price sources',
    timeout: 'Reflector oracle did not respond in time — running on fallback price sources',
    http_error: 'Reflector oracle returned an error response — running on fallback price sources',
    no_data: 'Reflector oracle returned no price data — running on fallback price sources',
    stale: 'Reflector oracle is reachable but serving stale quotes',
}

const ORACLE_REMEDIATIONS: Record<string, string> = {
    not_configured: 'Set REFLECTOR_API_URL to enable oracle-sourced prices.',
    unreachable: 'Verify REFLECTOR_API_URL and outbound network access to the oracle host, then rerun the self-test.',
    timeout: 'Check oracle latency and network path; raise the timeout only if the oracle is known to be slow.',
    http_error: 'Check the oracle endpoint path and any auth requirements for the configured REFLECTOR_API_URL.',
    no_data: 'Confirm the probed asset is published by the configured oracle instance.',
    stale: 'Investigate the oracle publisher — quotes are older than PRICE_DATA_MAX_AGE.',
}

function buildQueueFailureCheck(name: string): StartupSelfTestCheck {
    return {
        name,
        status: 'failed',
        message: `${name} is unavailable because Redis is offline`,
        remediation: 'Start Redis, confirm REDIS_URL is set correctly, and rerun the self-test.',
        details: { redisAvailable: false },
    }
}

function buildReport(input: {
    startedAt: number
    config: Record<string, unknown>
    checks: StartupSelfTestCheck[]
}): StartupSelfTestReport {
    const passedChecks = input.checks.filter((check) => check.status === 'passed').length
    const failedChecks = input.checks.filter((check) => check.status === 'failed').length
    const degradedChecks = input.checks.filter((check) => check.status === 'degraded').length

    return {
        // Degraded checks are reported but do not block startup.
        ok: failedChecks === 0,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - input.startedAt,
        summary: {
            totalChecks: input.checks.length,
            passedChecks,
            failedChecks,
            degradedChecks,
        },
        config: input.config,
        checks: input.checks,
    }
}

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
            }),
        ])
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId)
        }
    }
}
