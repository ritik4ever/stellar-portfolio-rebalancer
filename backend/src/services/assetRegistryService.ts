import { databaseService } from './databaseService.js'
import { issuerMetadataService } from './issuerMetadataService.js'
import {
    AssetRegistryConflictError,
    parseAssetCreatePayload
} from './assetRegistryValidation.js'
import { IssuerMetadata } from '../types/index.js'
import { getFeatureFlags } from '../config/featureFlags.js'

export interface AssetRecord {
    symbol: string
    name: string
    contractAddress?: string
    issuerAccount?: string
    coingeckoId?: string
    enabled: boolean
    issuerMetadata?: IssuerMetadata
}

export const assetRegistryService = {
    list(enabledOnly: boolean = true): AssetRecord[] {
        return databaseService.listAssets(enabledOnly)
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

    async add(
        symbol: unknown,
        name: unknown,
        options: {
            contractAddress?: unknown
            issuerAccount?: unknown
            coingeckoId?: unknown
        } = {}
    ): Promise<void> {
        const parsed = parseAssetCreatePayload(symbol, name, options)
        if (databaseService.getAssetBySymbol(parsed.symbol)) {
            throw new AssetRegistryConflictError(`An asset with symbol ${parsed.symbol} already exists`)
        }
        const flags = getFeatureFlags()
        const metadata = (flags.enableIssuerMetadata && parsed.issuerAccount)
            ? await issuerMetadataService.getMetadata(parsed.issuerAccount)
            : undefined;
        databaseService.addAsset(parsed.symbol, parsed.name, {
            contractAddress: parsed.contractAddress,
            issuerAccount: parsed.issuerAccount,
            coingeckoId: parsed.coingeckoId,
            issuerMetadata: metadata
        })
    },

    remove(symbol: string): boolean {
        return databaseService.removeAsset(symbol)
    },

    setEnabled(symbol: string, enabled: boolean): boolean {
        return databaseService.setAssetEnabled(symbol, enabled)
    }
}
