import { describe, it, expect } from 'vitest'
import { StrKey } from '@stellar/stellar-sdk'
import { Buffer } from 'node:buffer'

import {
  parseAssetCreatePayload,
  AssetRegistryValidationError,
  isSqliteAssetPrimaryKeyConflict
} from '../services/assetRegistryValidation.js'

const VALID_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 2))
const VALID_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

describe('assetRegistryValidation', () => {
  describe('parseAssetCreatePayload', () => {
    it('accepts symbol, name, and optional coingeckoId', () => {
      const p = parseAssetCreatePayload('USDT', 'Tether', { coingeckoId: 'tether' })

      expect(p).toEqual({
        symbol: 'USDT',
        name: 'Tether',
        coingeckoId: 'tether'
      })
    })

    it('accepts Soroban contract without issuer', () => {
      const p = parseAssetCreatePayload('YZ1', 'Y Z One', {
        contractAddress: VALID_CONTRACT
      })

      expect(p.contractAddress).toBe(VALID_CONTRACT)
      expect(p.issuerAccount).toBeUndefined()
    })

    it('accepts issuer without contract', () => {
      const p = parseAssetCreatePayload('YZ2', 'Y Z Two', {
        issuerAccount: VALID_ISSUER
      })

      expect(p.issuerAccount).toBe(VALID_ISSUER)
      expect(p.contractAddress).toBeUndefined()
    })

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

    it('rejects contract and issuer together', () => {
      expect(() =>
        parseAssetCreatePayload('X', 'Y', {
          contractAddress: VALID_CONTRACT,
          issuerAccount: VALID_ISSUER
        })
      ).toThrow(AssetRegistryValidationError)
    })

    it('rejects invalid contract strkey', () => {
      expect(() =>
        parseAssetCreatePayload('X', 'Y', {
          contractAddress: VALID_ISSUER
        })
      ).toThrow(AssetRegistryValidationError)
    })

    it('rejects invalid issuer strkey', () => {
      expect(() =>
        parseAssetCreatePayload('X', 'Y', {
          issuerAccount: 'not-a-g-address'
        })
      ).toThrow(AssetRegistryValidationError)
    })

    it('rejects malformed coingeckoId', () => {
      expect(() =>
        parseAssetCreatePayload('X', 'Y', {
          coingeckoId: 'Bad_Id'
        })
      ).toThrow(AssetRegistryValidationError)
    })

    it('rejects coingeckoId longer than 128 characters', () => {
      expect(() =>
        parseAssetCreatePayload('X', 'Y', {
          coingeckoId: 'a'.repeat(129)
        })
      ).toThrow(AssetRegistryValidationError)
    })

    it('rejects non-string optional field when provided', () => {
      expect(() =>
        parseAssetCreatePayload('X', 'Y', {
          coingeckoId: 1 as unknown as string
        })
      ).toThrow(AssetRegistryValidationError)
    })
  })

  describe('isSqliteAssetPrimaryKeyConflict', () => {
    it('returns true for SQLITE_CONSTRAINT_PRIMARYKEY errors', () => {
      expect(isSqliteAssetPrimaryKeyConflict({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })).toBe(true)
    })

    it('returns false for other sqlite errors', () => {
      expect(isSqliteAssetPrimaryKeyConflict({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(false)
    })

    it('returns false for non-error values', () => {
      expect(isSqliteAssetPrimaryKeyConflict(null)).toBe(false)
      expect(isSqliteAssetPrimaryKeyConflict(undefined)).toBe(false)
      expect(isSqliteAssetPrimaryKeyConflict('SQLITE_CONSTRAINT_PRIMARYKEY')).toBe(false)
    })
  })
})