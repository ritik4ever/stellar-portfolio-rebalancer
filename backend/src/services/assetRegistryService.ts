import { databaseService } from './databaseService.js'
import {
    AssetRegistryConflictError,
    parseAssetCreatePayload
} from './assetRegistryValidation.js'

export interface AssetRecord {
    symbol: string
    name: string
    contractAddress?: string
    issuerAccount?: string
    coingeckoId?: string
    enabled: boolean
}

export type AssetSortField = 'symbol' | 'name' | 'enabled'
export type AssetSortOrder = 'asc' | 'desc'

export interface AssetQueryOptions {
    enabledOnly?: boolean
    /** Matches symbol or name (case-insensitive substring). */
    search?: string
    /** Matches issuerAccount (case-insensitive substring). */
    issuer?: string
    sortBy?: AssetSortField
    order?: AssetSortOrder
    page?: number
    limit?: number
}

export interface AssetQueryResult {
    assets: AssetRecord[]
    page: number
    limit: number
    total: number
}

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20

export const assetRegistryService = {
    list(enabledOnly: boolean = true): AssetRecord[] {
        return databaseService.listAssets(enabledOnly)
    },

    /**
     * Filter, sort, and paginate the asset catalog. Centralises the catalog
     * browsing logic so routes stay thin and the behaviour is unit-testable.
     */
    query(options: AssetQueryOptions = {}): AssetQueryResult {
        const {
            enabledOnly = true,
            search,
            issuer,
            sortBy = 'symbol',
            order = 'asc',
            page = 1,
            limit = DEFAULT_PAGE_SIZE
        } = options

        let assets = databaseService.listAssets(enabledOnly)

        const term = search?.trim().toUpperCase()
        if (term) {
            assets = assets.filter(asset =>
                asset.symbol.includes(term) || asset.name.toUpperCase().includes(term)
            )
        }

        const issuerTerm = issuer?.trim().toUpperCase()
        if (issuerTerm) {
            assets = assets.filter(asset =>
                (asset.issuerAccount ?? '').toUpperCase().includes(issuerTerm)
            )
        }

        const direction = order === 'desc' ? -1 : 1
        const sorted = [...assets].sort((a, b) => {
            let cmp: number
            if (sortBy === 'name') cmp = a.name.localeCompare(b.name)
            else if (sortBy === 'enabled') cmp = Number(a.enabled) - Number(b.enabled)
            else cmp = a.symbol.localeCompare(b.symbol)
            return cmp * direction
        })

        const total = sorted.length
        const safePage = Math.max(1, Math.trunc(page) || 1)
        const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(limit) || DEFAULT_PAGE_SIZE))
        const start = (safePage - 1) * safeLimit

        return {
            assets: sorted.slice(start, start + safeLimit),
            page: safePage,
            limit: safeLimit,
            total
        }
    },

    getBySymbol(symbol: string): AssetRecord | undefined {
        return databaseService.getAssetBySymbol(symbol)
    },

    getSymbols(enabledOnly: boolean = true): string[] {
        return databaseService.listAssets(enabledOnly).map(a => a.symbol)
    },

    getCoingeckoIdMap(): Record<string, string> {
        const assets = databaseService.listAssets(true)
        const map: Record<string, string> = {}
        for (const a of assets) {
            if (a.coingeckoId) map[a.symbol] = a.coingeckoId
        }
        return map
    },

    add(
        symbol: unknown,
        name: unknown,
        options: {
            contractAddress?: unknown
            issuerAccount?: unknown
            coingeckoId?: unknown
        } = {}
    ): void {
        const parsed = parseAssetCreatePayload(symbol, name, options)
        if (databaseService.getAssetBySymbol(parsed.symbol)) {
            throw new AssetRegistryConflictError(`An asset with symbol ${parsed.symbol} already exists`)
        }
        databaseService.addAsset(parsed.symbol, parsed.name, {
            contractAddress: parsed.contractAddress,
            issuerAccount: parsed.issuerAccount,
            coingeckoId: parsed.coingeckoId
        })
    },

    remove(symbol: string): boolean {
        return databaseService.removeAsset(symbol)
    },

    setEnabled(symbol: string, enabled: boolean): boolean {
        return databaseService.setAssetEnabled(symbol, enabled)
    }
}
