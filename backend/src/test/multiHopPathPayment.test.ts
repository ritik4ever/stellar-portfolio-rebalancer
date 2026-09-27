import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StellarDEXService } from '../services/dex.js'

describe('Multi-hop path-payment support (#1176)', () => {
    let dexService: StellarDEXService

    beforeEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
        dexService = new StellarDEXService()
    })

    it('discovers multi-hop path when no direct trading pair exists', async () => {
        // Mock Horizon path-finding endpoint to return a two-hop path
        const mockServer = {
            strictSendPaths: vi.fn().mockReturnValue({
                call: vi.fn().mockResolvedValue({
                    records: [
                        {
                            source_amount: '100',
                            destination_amount: '95',
                            destination_asset_type: 'credit_alphanum4',
                            destination_asset_code: 'ETH',
                            destination_asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
                            path: [
                                {
                                    asset_type: 'credit_alphanum4',
                                    asset_code: 'USDC',
                                    asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
                                }
                            ]
                        }
                    ]
                })
            })
        }

        // Replace the server instance with mock
        dexService['server'] = mockServer as any

        const fromAsset = dexService['getAssetObject']('XLM')
        const toAsset = dexService['getAssetObject']('ETH')

        const discoveredPath = await dexService['discoverPath'](fromAsset, toAsset, 100, 3)

        expect(discoveredPath).toBeDefined()
        expect(discoveredPath?.pathLength).toBe(1)
        expect(discoveredPath?.intermediateAssets).toContain('USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
        expect(discoveredPath?.estimatedDestinationAmount).toBe(95)
    })

    it('enforces max-hops limit during path discovery', async () => {
        const mockServer = {
            strictSendPaths: vi.fn().mockReturnValue({
                call: vi.fn().mockResolvedValue({
                    records: [
                        {
                            source_amount: '100',
                            destination_amount: '90',
                            destination_asset_type: 'credit_alphanum4',
                            destination_asset_code: 'ETH',
                            destination_asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
                            path: [
                                { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'ISSUER1' },
                                { asset_type: 'credit_alphanum4', asset_code: 'BTC', asset_issuer: 'ISSUER2' },
                                { asset_type: 'credit_alphanum4', asset_code: 'LTC', asset_issuer: 'ISSUER3' }
                            ]
                        }
                    ]
                })
            })
        }

        dexService['server'] = mockServer as any

        const fromAsset = dexService['getAssetObject']('XLM')
        const toAsset = dexService['getAssetObject']('ETH')

        // With maxHops=2, a 3-hop path should be rejected
        const discoveredPath = await dexService['discoverPath'](fromAsset, toAsset, 100, 2)

        expect(discoveredPath).toBeUndefined()
    })

    it('selects best path when multiple options available', async () => {
        const mockServer = {
            strictSendPaths: vi.fn().mockReturnValue({
                call: vi.fn().mockResolvedValue({
                    records: [
                        {
                            source_amount: '100',
                            destination_amount: '90',
                            destination_asset_type: 'credit_alphanum4',
                            destination_asset_code: 'ETH',
                            destination_asset_issuer: 'ISSUER',
                            path: [
                                { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'ISSUER' }
                            ]
                        },
                        {
                            source_amount: '100',
                            destination_amount: '95',
                            destination_asset_type: 'credit_alphanum4',
                            destination_asset_code: 'ETH',
                            destination_asset_issuer: 'ISSUER',
                            path: [
                                { asset_type: 'credit_alphanum4', asset_code: 'BTC', asset_issuer: 'ISSUER' }
                            ]
                        }
                    ]
                })
            })
        }

        dexService['server'] = mockServer as any

        const fromAsset = dexService['getAssetObject']('XLM')
        const toAsset = dexService['getAssetObject']('ETH')

        const discoveredPath = await dexService['discoverPath'](fromAsset, toAsset, 100, 3)

        // Should select the path with higher destination amount (95 vs 90)
        expect(discoveredPath?.estimatedDestinationAmount).toBe(95)
        expect(discoveredPath?.intermediateAssets).toContain('BTC:ISSUER')
    })

    it('returns undefined when no viable path found', async () => {
        const mockServer = {
            strictSendPaths: vi.fn().mockReturnValue({
                call: vi.fn().mockResolvedValue({
                    records: []
                })
            })
        }

        dexService['server'] = mockServer as any

        const fromAsset = dexService['getAssetObject']('XLM')
        const toAsset = dexService['getAssetObject']('ETH')

        const discoveredPath = await dexService['discoverPath'](fromAsset, toAsset, 100, 3)

        expect(discoveredPath).toBeUndefined()
    })

    it('handles Horizon path-finding errors gracefully', async () => {
        const mockServer = {
            strictSendPaths: vi.fn().mockReturnValue({
                call: vi.fn().mockRejectedValue(new Error('Horizon unavailable'))
            })
        }

        dexService['server'] = mockServer as any

        const fromAsset = dexService['getAssetObject']('XLM')
        const toAsset = dexService['getAssetObject']('ETH')

        const discoveredPath = await dexService['discoverPath'](fromAsset, toAsset, 100, 3)

        expect(discoveredPath).toBeUndefined()
    })

    it('configurable max-hops limit is respected from config', () => {
        const config = dexService.getDefaultExecutionConfig()
        expect(config.maxHops).toBeGreaterThan(0)
        expect(config.maxHops).toBeLessThanOrEqual(6)
    })
})
