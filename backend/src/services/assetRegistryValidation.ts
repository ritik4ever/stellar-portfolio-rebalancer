import { StrKey } from '@stellar/stellar-sdk'

const SYMBOL_PATTERN = /^[A-Z0-9]{1,12}$/

const COINGECKO_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export class AssetRegistryValidationError extends Error {
    override readonly name = 'AssetRegistryValidationError'
    constructor(message: string) {
        super(message)
    }
}

export class AssetRegistryConflictError extends Error {
    override readonly name = 'AssetRegistryConflictError'
    constructor(message: string) {
        super(message)
    }
}

export interface ParsedAssetCreatePayload {
    symbol: string
    name: string
    contractAddress?: string
    issuerAccount?: string
    coingeckoId?: string
}

function optionalTrimmed(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string') {
        throw new AssetRegistryValidationError('optional string fields must be strings when provided')
    }
    const t = value.trim()
    return t === '' ? undefined : t
}

export function parseAssetCreatePayload(
    symbol: unknown,
    name: unknown,
    options: {
        contractAddress?: unknown
        issuerAccount?: unknown
        coingeckoId?: unknown
    } = {}
): ParsedAssetCreatePayload {
    if (typeof symbol !== 'string' || typeof name !== 'string') {
        throw new AssetRegistryValidationError('symbol and name are required strings')
    }
    const sym = symbol.trim()
    if (!SYMBOL_PATTERN.test(sym)) {
        throw new AssetRegistryValidationError(
            'symbol must be 1-12 characters using uppercase A-Z and digits only'
        )
    }
    const displayName = name.trim()
    if (!displayName) {
        throw new AssetRegistryValidationError('name is required')
    }
    if (displayName.length > 256) {
        throw new AssetRegistryValidationError('name must be at most 256 characters')
    }
    const contractAddress = optionalTrimmed(options.contractAddress)
    const issuerAccount = optionalTrimmed(options.issuerAccount)
    const coingeckoId = optionalTrimmed(options.coingeckoId)

    if (contractAddress && issuerAccount) {
        throw new AssetRegistryValidationError(
            'use either contractAddress (Soroban contract) or issuerAccount (classic issuer), not both'
        )
    }
    if (contractAddress && !StrKey.isValidContract(contractAddress)) {
        throw new AssetRegistryValidationError(
            'contractAddress must be a valid Soroban contract strkey (C...)'
        )
    }
    if (issuerAccount && !StrKey.isValidEd25519PublicKey(issuerAccount)) {
        throw new AssetRegistryValidationError(
            'issuerAccount must be a valid Stellar Ed25519 public key (G...)'
        )
    }
    if (coingeckoId !== undefined) {
        if (!COINGECKO_ID_PATTERN.test(coingeckoId)) {
            throw new AssetRegistryValidationError(
                'coingeckoId must be a CoinGecko coin id (lowercase letters, digits, hyphen-separated segments)'
            )
        }
        if (coingeckoId.length > 128) {
            throw new AssetRegistryValidationError('coingeckoId must be at most 128 characters')
        }
    }

    return {
        symbol: sym,
        name: displayName,
        contractAddress,
        issuerAccount,
        coingeckoId
    }
}

export function isSqliteAssetPrimaryKeyConflict(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    )
}
