import { databaseService } from './databaseService.js'

export interface AssetRecord {
    symbol: string
    name: string
    contractAddress?: string
    issuerAccount?: string
    coingeckoId?: string
    enabled: boolean
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

    add(symbol: string, name: string, options: { contractAddress?: string; issuerAccount?: string; coingeckoId?: string } = {}): void {
        databaseService.addAsset(symbol, name, options)
    },

    remove(symbol: string): boolean {
        return databaseService.removeAsset(symbol)
    },

    setEnabled(symbol: string, enabled: boolean): boolean {
        return databaseService.setAssetEnabled(symbol, enabled)
    }
}
