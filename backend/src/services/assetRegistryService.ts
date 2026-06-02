import { databaseService } from './databaseService.js'
import {
    AssetRegistryConflictError,
    parseAssetCreatePayload
} from './assetRegistryValidation.js'
import { logger } from '../utils/logger.js'

export interface AssetRecord {
    symbol: string
    name: string
    contractAddress?: string
    issuerAccount?: string
    coingeckoId?: string
    enabled: boolean
    lastRefreshedAt?: string
    isQuarantined: boolean
    stale: boolean
}



export const assetRegistryService = {
    isAssetStale(lastRefreshedAt?: string): boolean {
        if (!lastRefreshedAt) return true
        const elapsed = Date.now() - new Date(lastRefreshedAt).getTime()
        return elapsed > STALE_POLICY_MS
    },

    isAssetQuarantineExpired(lastRefreshedAt?: string): boolean {
        if (!lastRefreshedAt) return true
        const elapsed = Date.now() - new Date(lastRefreshedAt).getTime()
        return elapsed > QUARANTINE_POLICY_MS
    },

    checkAndApplyAutoQuarantine(asset: any): AssetRecord {
        const stale = this.isAssetStale(asset.lastRefreshedAt)
        let isQuarantined = asset.isQuarantined

        if (!isQuarantined && this.isAssetQuarantineExpired(asset.lastRefreshedAt)) {
            logger.warn(`[QUARANTINE] Asset ${asset.symbol} has not been refreshed since ${asset.lastRefreshedAt ?? 'never'}. Automatically quarantining.`);
            databaseService.setAssetFreshness(asset.symbol, asset.lastRefreshedAt ?? new Date(0).toISOString(), true);
            isQuarantined = true;
        }

        return {
            symbol: asset.symbol,
            name: asset.name,
            contractAddress: asset.contractAddress,
            issuerAccount: asset.issuerAccount,
            coingeckoId: asset.coingeckoId,
            enabled: asset.enabled,
            lastRefreshedAt: asset.lastRefreshedAt,
            isQuarantined,
            stale
        }
    },

    list(enabledOnly: boolean = true): AssetRecord[] {
        const rawAssets = databaseService.listAssets(false)
        const mapped = rawAssets.map(a => this.checkAndApplyAutoQuarantine(a))
        
        if (enabledOnly) {
            return mapped.filter(a => a.enabled && !a.isQuarantined)
        }
        return mapped
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
        const asset = databaseService.getAssetBySymbol(symbol)
        if (!asset) return undefined
        return this.checkAndApplyAutoQuarantine(asset)
    },

    getSymbols(enabledOnly: boolean = true): string[] {
        return this.list(enabledOnly).map(a => a.symbol)
    },

    getCoingeckoIdMap(): Record<string, string> {
        const assets = this.list(true)
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
    },

    setQuarantined(symbol: string, quarantined: boolean): boolean {
        return databaseService.setAssetQuarantined(symbol, quarantined)
    },

    async refreshAssetSource(symbol: string): Promise<boolean> {
        const asset = databaseService.getAssetBySymbol(symbol)
        if (!asset) {
            logger.error(`[ASSET-REGISTRY] Cannot refresh non-existent asset: ${symbol}`)
            return false
        }

        try {
            logger.info(`[ASSET-REGISTRY] Refreshing source for asset: ${symbol}`)

            if (asset.coingeckoId) {
                const apiKey = process.env.COINGECKO_API_KEY || ''
                const baseUrl = apiKey && apiKey.trim()
                    ? 'https://pro-api.coingecko.com/api/v3'
                    : 'https://api.coingecko.com/api/v3'
                
                const headers: Record<string, string> = {
                    'Accept': 'application/json',
                    'User-Agent': 'StellarPortfolioRebalancer/1.0'
                }
                if (apiKey && apiKey.trim()) {
                    headers['x-cg-pro-api-key'] = apiKey.trim()
                }

                const url = `${baseUrl}/simple/price?ids=${asset.coingeckoId}&vs_currencies=usd`
                const response = await fetch(url, { headers, method: 'GET' })

                if (!response.ok) {
                    throw new Error(`CoinGecko ping failed: ${response.status} ${response.statusText}`)
                }

                const data = (await response.json()) as Record<string, any>
                if (!data || !data[asset.coingeckoId]) {
                    throw new Error(`CoinGecko ID ${asset.coingeckoId} not found in response`)
                }
            }

            databaseService.setAssetFreshness(symbol, new Date().toISOString(), false)
            logger.info(`[ASSET-REGISTRY] Successfully refreshed source for asset: ${symbol}`)
            return true
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            logger.error(`[ASSET-REGISTRY] Failed to refresh source for ${symbol}: ${errorMsg}`)

            const lastRefreshed = asset.lastRefreshedAt
            const isQuarantineExpired = this.isAssetQuarantineExpired(lastRefreshed)

            if (isQuarantineExpired) {
                logger.warn(`[ASSET-REGISTRY] Quarantining asset ${symbol} due to failed refresh and expired freshness policy.`)
                databaseService.setAssetFreshness(symbol, lastRefreshed ?? new Date(0).toISOString(), true)
            }

            return false
        }
    },

    async refreshAllAssetSources(): Promise<Record<string, { success: boolean; error?: string }>> {
        const assets = databaseService.listAssets(false)
        const results: Record<string, { success: boolean; error?: string }> = {}

        for (const a of assets) {
            try {
                const ok = await this.refreshAssetSource(a.symbol)
                results[a.symbol] = { success: ok }
            } catch (err) {
                results[a.symbol] = { 
                    success: false, 
                    error: err instanceof Error ? err.message : String(err) 
                }
            }
        }

        return results
    }
}
