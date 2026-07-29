import { describe, it, expect } from 'vitest'
import { parseAssetCreatePayload, AssetRegistryValidationError } from '../services/assetRegistryValidation.js'

describe('asset registry payload validation', () => {
    it('trims symbol and name', () => {
      const p = parseAssetCreatePayload(' ABC ', ' Asset Name ', {})

      expect(p.symbol).toBe('ABC')
      expect(p.name).toBe('Asset Name')
    })

    it('treats blank optional strings as omitted', () => {
      const p = parseAssetCreatePayload('ABC', 'A', {
        contractAddress: '   ',
        issuerAccount: '',
        coingeckoId: '  \t  '
      })

      expect(p.contractAddress).toBeUndefined()
      expect(p.issuerAccount).toBeUndefined()
      expect(p.coingeckoId).toBeUndefined()
    })

    it('rejects non-string symbol and name', () => {
      expect(() => parseAssetCreatePayload(123, 'Bitcoin', {})).toThrow(
        AssetRegistryValidationError
      )

      expect(() => parseAssetCreatePayload('BTC', 123, {})).toThrow(
        AssetRegistryValidationError
      )
    })

    it('rejects lowercase symbol', () => {
      expect(() => parseAssetCreatePayload('btc', 'Bitcoin', {})).toThrow(
        AssetRegistryValidationError
      )
    })

    it('rejects symbol longer than 12 characters', () => {
      expect(() => parseAssetCreatePayload('ABCDEFGHIJKLM', 'Too long', {})).toThrow(
        AssetRegistryValidationError
      )
    })

    it('rejects empty name', () => {
      expect(() => parseAssetCreatePayload('X', '  ', {})).toThrow(
        AssetRegistryValidationError
      )
    })

    it('rejects name longer than 256 characters', () => {
      expect(() => parseAssetCreatePayload('X', 'a'.repeat(257), {})).toThrow(
        AssetRegistryValidationError
      )
    })
})
