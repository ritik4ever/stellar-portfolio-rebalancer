import { describe, it, expect } from 'vitest'
import { StrKey } from '@stellar/stellar-sdk'
import { Buffer } from 'node:buffer'
import { parseAssetCreatePayload, AssetRegistryValidationError } from '../services/assetRegistryValidation.js'

const VALID_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 2))
const VALID_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

describe('parseAssetCreatePayload', () => {

    it('trims symbol and name', () => {
      const p = parseAssetCreatePayload(' ABC ', ' Asset Name ', {})

      expect(p.symbol).toBe('ABC')
      expect(p.name).toBe('Asset Name')
    })

    it('treats blank optional strings as omitted', () => {

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

    })

    it('rejects contract and issuer together', () => {
        expect(() =>
            parseAssetCreatePayload('X', 'Y', {
                contractAddress: VALID_CONTRACT,
                issuerAccount: VALID_ISSUER
            })
        ).toThrow(AssetRegistryValidationError)
    })
})
