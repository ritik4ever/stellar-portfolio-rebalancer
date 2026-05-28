import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const assetKeys = {
    all: ['assets'] as const,
}

interface Asset {
    symbol: string
    name?: string
    issuer?: string
    domain?: string
    type?: 'native' | 'credit_alphanum4' | 'credit_alphanum12'
}

interface AssetWithIssuer extends Asset {
    displayName: string
    searchText: string
}

export const useAssets = () => {
    return useQuery({
        queryKey: assetKeys.all,
        queryFn: async (): Promise<AssetWithIssuer[]> => {
            try {
                const res = await api.get<{ assets: Asset[] }>(ENDPOINTS.ASSETS)
                
                if (res?.assets?.length) {
                    return res.assets.map((asset): AssetWithIssuer => ({
                        ...asset,
                        displayName: asset.name 
                            ? `${asset.symbol} (${asset.name})`
                            : asset.symbol,
                        searchText: [
                            asset.symbol,
                            asset.name,
                            asset.issuer,
                            asset.domain
                        ].filter(Boolean).join(' ').toLowerCase()
                    }))
                }
            } catch (error) {
                console.warn('Failed to fetch assets from API, using fallback', error)
            }
            
            // Fallback to default assets with enhanced information
            return [
                {
                    symbol: 'XLM',
                    name: 'Stellar Lumens',
                    type: 'native',
                    displayName: 'XLM (Stellar Lumens)',
                    searchText: 'xlm stellar lumens native'
                },
                {
                    symbol: 'USDC',
                    name: 'USD Coin',
                    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
                    domain: 'centre.io',
                    type: 'credit_alphanum4',
                    displayName: 'USDC (USD Coin)',
                    searchText: 'usdc usd coin centre.io ga5zsejyb37jrc5avcia5mop4rhtm335x2kgx3ihojapp5re34k4kzvn'
                },
                {
                    symbol: 'BTC',
                    name: 'Bitcoin',
                    issuer: 'GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF',
                    domain: 'apay.io',
                    type: 'credit_alphanum4',
                    displayName: 'BTC (Bitcoin)',
                    searchText: 'btc bitcoin apay.io gautuyy2thlf7sgitdfmxjvyh3lhdsmgeaksbu267m2k7a3w543ckuef'
                },
                {
                    symbol: 'ETH',
                    name: 'Ethereum',
                    issuer: 'GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR',
                    domain: 'apay.io',
                    type: 'credit_alphanum4',
                    displayName: 'ETH (Ethereum)',
                    searchText: 'eth ethereum apay.io gbdevu63y6nthjqqzikvtc23nwlqvp3wj2ri2otsjtnyoigicst6duxr'
                }
            ]
        },
        staleTime: 300000, // 5 minutes — asset list rarely changes
        placeholderData: [
            {
                symbol: 'XLM',
                name: 'Stellar Lumens',
                type: 'native' as const,
                displayName: 'XLM (Stellar Lumens)',
                searchText: 'xlm stellar lumens native'
            },
            {
                symbol: 'USDC',
                name: 'USD Coin',
                issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
                domain: 'centre.io',
                type: 'credit_alphanum4' as const,
                displayName: 'USDC (USD Coin)',
                searchText: 'usdc usd coin centre.io'
            }
        ],
    })
}
