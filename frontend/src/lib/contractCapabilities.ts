/**
 * Contract capability matrix and lightweight startup detection.
 *
 * Resolves issue #834 / #845: the frontend must be able to detect unsupported or
 * outdated contract deployments *before* attempting writes, and degrade
 * gracefully when an on-chain capability is unavailable.
 *
 * The matrix below is the single source of truth the UI consults for which
 * contract methods exist, what they expect, and which events they emit. It is
 * intentionally static (no contract source needed to read it) and is kept in
 * step with `contracts/src/portfolio.rs`, `contracts/src/events.rs`, and the
 * backend indexer contract in `docs/CONTRACT_EVENTS.md`.
 *
 * See `docs/CONTRACT_CAPABILITY_MATRIX.md` for the human-readable guide.
 */
import { API_CONFIG } from '../config/api'

/**
 * Contract event schema version the frontend is built against. Must match the
 * backend's `BACKEND_CONTRACT_EVENT_SCHEMA_VERSION`
 * (`backend/src/config/contractEventSchema.ts`). Bump together when topic
 * strings or payload tuple shapes change.
 */
export const FRONTEND_CONTRACT_SCHEMA_VERSION = 1

export type ContractCapabilityKind = 'read' | 'write'

export interface ContractCapability {
    /** Contract entrypoint name as invoked on-chain. */
    method: string
    kind: ContractCapabilityKind
    /** Human description of the capability. */
    summary: string
    /** Expected positional arguments (name: type). */
    args: string[]
    /** Event topics emitted on success (topic[1] short names). */
    events: string[]
    /** Schema version in which the capability first appeared. */
    sinceSchemaVersion: number
    /**
     * Deterministic behaviour the UI must follow when this capability is
     * unavailable on the connected deployment.
     */
    fallback: string
}

/**
 * Supported contract capabilities. Ordered read-first, then writes.
 */
export const CONTRACT_CAPABILITY_MATRIX: readonly ContractCapability[] = [
    {
        method: 'get_portfolio',
        kind: 'read',
        summary: 'Fetch a portfolio with balances and target allocations.',
        args: ['portfolio_id: u64'],
        events: [],
        sinceSchemaVersion: 1,
        fallback: 'Read portfolio state from the backend cache (/portfolio/:id).',
    },
    {
        method: 'build_rebalance_preview',
        kind: 'read',
        summary: 'Compute candidate trades, skipped assets, and drift decisions.',
        args: ['portfolio_id: u64'],
        events: [],
        sinceSchemaVersion: 1,
        fallback: 'Fall back to the backend rebalance-plan endpoint.',
    },
    {
        method: 'create_portfolio',
        kind: 'write',
        summary: 'Create a portfolio with target allocations.',
        args: ['user: Address', 'target_allocations: Map<Address, u32>'],
        events: ['created'],
        sinceSchemaVersion: 1,
        fallback: 'Block the write and surface "contract unavailable"; do not optimistically create.',
    },
    {
        method: 'deposit',
        kind: 'write',
        summary: 'Deposit an asset into a portfolio.',
        args: ['portfolio_id: u64', 'asset: Address', 'amount: i128'],
        events: ['deposit'],
        sinceSchemaVersion: 1,
        fallback: 'Block the write and prompt the user to retry once the deployment is supported.',
    },
    {
        method: 'withdraw',
        kind: 'write',
        summary: 'Withdraw an asset from a portfolio.',
        args: ['portfolio_id: u64', 'asset: Address', 'amount: i128'],
        events: ['withdraw'],
        sinceSchemaVersion: 1,
        fallback: 'Block the write and prompt the user to retry once the deployment is supported.',
    },
    {
        method: 'update_allocations',
        kind: 'write',
        summary: 'Update target allocations for a portfolio.',
        args: ['portfolio_id: u64', 'target_allocations: Map<Address, u32>'],
        events: ['alloc_upd'],
        sinceSchemaVersion: 1,
        fallback: 'Block the write; keep the existing allocations visible read-only.',
    },
    {
        method: 'rebalance',
        kind: 'write',
        summary: 'Execute a rebalance for a portfolio.',
        args: ['portfolio_id: u64'],
        events: ['rebalanced'],
        sinceSchemaVersion: 1,
        fallback: 'Disable the rebalance action; show preview-only mode.',
    },
] as const

export type ContractCapabilitySeverity = 'ok' | 'warning' | 'error'

export interface ContractCapabilityReport {
    severity: ContractCapabilitySeverity
    title: string
    message: string
    /** Whether write entrypoints may be attempted against the deployment. */
    writesEnabled: boolean
    /** Schema version the frontend expects. */
    expectedSchemaVersion: number
    /** Capabilities considered usable given the current deployment state. */
    availableMethods: string[]
    details?: string
}

interface ReadinessCheckLike {
    status?: unknown
    message?: unknown
}

function readIndexerCheck(body: unknown): ReadinessCheckLike | null {
    if (!body || typeof body !== 'object') return null
    const checks = (body as Record<string, unknown>).checks
    if (!checks || typeof checks !== 'object') return null
    const indexer = (checks as Record<string, unknown>).contractEventIndexer
    if (!indexer || typeof indexer !== 'object') return null
    return indexer as ReadinessCheckLike
}

function allMethods(): string[] {
    return CONTRACT_CAPABILITY_MATRIX.map((c) => c.method)
}

function readOnlyMethods(): string[] {
    return CONTRACT_CAPABILITY_MATRIX.filter((c) => c.kind === 'read').map((c) => c.method)
}

/**
 * Lightweight, dependency-free capability detection intended for the frontend
 * startup sequence. It reuses the backend readiness probe (which already
 * verifies the contract event schema version, see `docs/CONTRACT_EVENTS.md`)
 * rather than opening a second RPC connection from the browser.
 *
 * Detection is deterministic:
 * - indexer `ready`    -> full capabilities, writes enabled.
 * - indexer `disabled` -> on-chain features off; read-only via backend, writes blocked.
 * - indexer `not_ready`-> outdated/unsupported deployment (e.g. schema mismatch); writes blocked.
 * - probe failure      -> conservative baseline: read-only, writes blocked.
 */
export async function detectContractCapabilities(
    signal?: AbortSignal,
): Promise<ContractCapabilityReport> {
    const base: Pick<ContractCapabilityReport, 'expectedSchemaVersion'> = {
        expectedSchemaVersion: FRONTEND_CONTRACT_SCHEMA_VERSION,
    }
    const probedUrl = `${API_CONFIG.BASE_URL.replace(/\/$/, '')}${API_CONFIG.ENDPOINTS.READINESS}`

    try {
        const response = await fetch(probedUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            mode: 'cors',
            credentials: 'omit',
            signal,
        })

        const body: unknown = await response.json().catch(() => null)
        const indexer = readIndexerCheck(body)
        const status = typeof indexer?.status === 'string' ? indexer.status : undefined
        const message = typeof indexer?.message === 'string' ? indexer.message : undefined

        if (status === 'ready') {
            return {
                ...base,
                severity: 'ok',
                title: 'Contract deployment is compatible',
                message: 'All documented contract capabilities are available.',
                writesEnabled: true,
                availableMethods: allMethods(),
            }
        }

        if (status === 'disabled') {
            return {
                ...base,
                severity: 'warning',
                title: 'On-chain contract features are disabled',
                message:
                    'The connected backend is not indexing the contract. The app will run in read-only mode and route reads through the backend.',
                writesEnabled: false,
                availableMethods: readOnlyMethods(),
                details: message,
            }
        }

        // not_ready (e.g. schema mismatch) or any other/unknown status.
        return {
            ...base,
            severity: 'error',
            title: 'Unsupported or outdated contract deployment',
            message:
                'The deployed contract does not match the schema this frontend expects. Writes are blocked until the deployment is upgraded.',
            writesEnabled: false,
            availableMethods: readOnlyMethods(),
            details: message,
        }
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return {
                ...base,
                severity: 'ok',
                title: 'Contract capability check skipped',
                message: 'Startup probe was cancelled.',
                writesEnabled: false,
                availableMethods: [],
            }
        }

        // Conservative baseline when we cannot reach the probe.
        return {
            ...base,
            severity: 'warning',
            title: 'Could not verify contract capabilities',
            message:
                'Unable to confirm the contract deployment. Defaulting to read-only and blocking writes until verified.',
            writesEnabled: false,
            availableMethods: readOnlyMethods(),
            details: error instanceof Error ? error.message : undefined,
        }
    }
}

/** Whether a capability is usable given a detection report. */
export function isCapabilitySupported(
    report: ContractCapabilityReport | null,
    method: string,
): boolean {
    if (!report) return false
    return report.availableMethods.includes(method)
}

/**
 * Guard a write before it is attempted. Returns the matrix entry's `fallback`
 * string when the write must be skipped, or `null` when it is safe to proceed.
 * Lets call sites degrade deterministically (see the capability matrix doc).
 */
export function blockedWriteFallback(
    report: ContractCapabilityReport | null,
    method: string,
): string | null {
    const capability = CONTRACT_CAPABILITY_MATRIX.find((c) => c.method === method)
    if (!capability || capability.kind !== 'write') return null
    if (report?.writesEnabled && isCapabilitySupported(report, method)) return null
    return capability.fallback
}
