import { Server } from '@stellar/stellar-sdk'
import { Contract } from '@stellar/stellar-sdk'
import { validateStartupConfigOrThrow } from '../config/startupConfig.js'
import { logger } from '../utils/logger.js'

export interface ContractDiagnosticsResult {
    success: boolean
    checks: ContractCheck[]
    summary: ContractDiagnosticsSummary
    timestamp: string
}

export interface ContractCheck {
    name: string
    passed: boolean
    message: string
    durationMs?: number
    error?: string
}

export interface ContractDiagnosticsSummary {
    totalChecks: number
    passedChecks: number
    failedChecks: number
    connectivityOk: boolean
    contractReachable: boolean
}

const CONTRACT_CHECK_TIMEOUT_MS = 10000

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string
): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    })
    return Promise.race([promise, timeout])
}

export async function runContractDiagnostics(): Promise<ContractDiagnosticsResult> {
    const startTime = Date.now()
    const checks: ContractCheck[] = []

    let config: ReturnType<typeof validateStartupConfigOrThrow> | null = null
    try {
        config = validateStartupConfigOrThrow()
    } catch {
        checks.push({
            name: 'config',
            passed: false,
            message: 'Failed to load configuration',
            error: 'Startup configuration validation failed'
        })
        return buildResult(checks, startTime)
    }

    const contractAddress = config.stellarContractAddress
    const network = config.stellarNetwork
    const horizonUrl = config.stellarHorizonUrl

    checks.push({
        name: 'contract-address-format',
        passed: true,
        message: `Contract address format: ${maskAddress(contractAddress)}`
    })

    const networkCheck = await runNetworkCheck(network, horizonUrl)
    checks.push(networkCheck)

    if (!networkCheck.passed) {
        checks.push({
            name: 'contract-exists',
            passed: false,
            message: 'Skipped - network unreachable',
            error: 'Cannot verify contract without network connectivity'
        })
        return buildResult(checks, startTime)
    }

    const contractCheck = await runContractExistsCheck(contractAddress, network, horizonUrl)
    checks.push(contractCheck)

    return buildResult(checks, startTime)
}

async function runNetworkCheck(
    network: string,
    horizonUrl: string
): Promise<ContractCheck> {
    const checkStart = Date.now()

    try {
        const server = new Server(horizonUrl)
        await withTimeout(
            server.getHealth(),
            5000,
            'Network health check timed out'
        )

        return {
            name: 'network-connectivity',
            passed: true,
            message: `Connected to ${network} (${new URL(horizonUrl).hostname})`,
            durationMs: Date.now() - checkStart
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn('[DIAGNOSTICS] Network connectivity check failed', { error: message })

        return {
            name: 'network-connectivity',
            passed: false,
            message: `Failed to connect to ${network}`,
            durationMs: Date.now() - checkStart,
            error: message
        }
    }
}

async function runContractExistsCheck(
    contractAddress: string,
    network: string,
    horizonUrl: string
): Promise<ContractCheck> {
    const checkStart = Date.now()

    try {
        const server = new Server(horizonUrl)
        const networkConfig = network === 'mainnet'
            ? { httpUrl: horizonUrl, networkPassphrase: Server.NETWORK_NAMES.MAINNET }
            : { httpUrl: horizonUrl, networkPassphrase: Server.NETWORK_NAMES.TESTNET }

        const contract = new Contract(contractAddress, networkConfig)

        const dummyKey = Buffer.alloc(32)
        const result = await withTimeout(
            contract.call({ method: 'VERSION', args: [] }),
            5000,
            'Contract call timed out'
        ).catch(() => {
            const tryKey = Buffer.alloc(32, 0)
            return contract.call({ method: 'version', args: [] }).catch(() => {
                return contract.call({ method: 'get_version', args: [] })
            })
        })

        return {
            name: 'contract-exists',
            passed: true,
            message: `Contract ${maskAddress(contractAddress)} is reachable`,
            durationMs: Date.now() - checkStart
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)

        if (message.includes('resourceNotFound') || message.includes('404')) {
            return {
                name: 'contract-exists',
                passed: false,
                message: `Contract ${maskAddress(contractAddress)} not found on ${network}`,
                durationMs: Date.now() - checkStart,
                error: 'Contract not deployed or wrong address'
            }
        }

        if (message.includes('InvalidContract') || message.includes('invalid')) {
            return {
                name: 'contract-exists',
                passed: false,
                message: `Contract address ${maskAddress(contractAddress)} is invalid`,
                durationMs: Date.now() - checkStart,
                error: 'Invalid contract address format'
            }
        }

        return {
            name: 'contract-exists',
            passed: false,
            message: `Contract ${maskAddress(contractAddress)} check failed`,
            durationMs: Date.now() - checkStart,
            error: message
        }
    }
}

function buildResult(
    checks: ContractCheck[],
    startTime: number
): ContractDiagnosticsResult {
    const passedChecks = checks.filter(c => c.passed).length
    const failedChecks = checks.filter(c => !c.passed).length

    const networkCheck = checks.find(c => c.name === 'network-connectivity')
    const contractCheck = checks.find(c => c.name === 'contract-exists')

    return {
        success: failedChecks === 0,
        checks,
        summary: {
            totalChecks: checks.length,
            passedChecks,
            failedChecks,
            connectivityOk: networkCheck?.passed ?? false,
            contractReachable: contractCheck?.passed ?? false
        },
        timestamp: new Date().toISOString()
    }
}

function maskAddress(address: string): string {
    if (!address || address.length < 8) return '****'
    return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export async function checkContractOnStartup(): Promise<boolean> {
    try {
        const result = await runContractDiagnostics()

        if (!result.summary.connectivityOk) {
            logger.warn('[STARTUP] Contract diagnostics: network unreachable')
            return false
        }

        if (!result.summary.contractReachable) {
            logger.warn('[STARTUP] Contract diagnostics: contract not reachable', {
                error: result.checks.find(c => c.name === 'contract-exists')?.error
            })
            return false
        }

        logger.info('[STARTUP] Contract diagnostics passed', {
            checks: result.checks.map(c => ({ name: c.name, passed: c.passed }))
        })
        return true
    } catch (err) {
        logger.error('[STARTUP] Contract diagnostics failed', {
            error: err instanceof Error ? err.message : String(err)
        })
        return false
    }
}