import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StrKey } from '@stellar/stellar-sdk'
import { Buffer } from 'node:buffer'

import { 
  parseAssetCreatePayload, 
  AssetRegistryValidationError,
  validateAssetRegistryEntry,
  isValidStellarAsset 
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
      const p = parseAssetCreatePayload('YZ1', 'Y Z One', { contractAddress: VALID_CONTRACT })
      expect(p.contractAddress).toBe(VALID_CONTRACT)
      expect(p.issuerAccount).toBeUndefined()
    })

    it('accepts issuer without contract', () => {
      const p = parseAssetCreatePayload('YZ2', 'Y Z Two', { issuerAccount: VALID_ISSUER })
      expect(p.issuerAccount).toBe(VALID_ISSUER)
      expect(p.contractAddress).toBeUndefined()
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

    it('rejects lowercase symbol', () => {
      expect(() => parseAssetCreatePayload('btc', 'Bitcoin', {})).toThrow(AssetRegistryValidationError)
    })

    it('rejects symbol longer than 12 characters', () => {
      expect(() => parseAssetCreatePayload('ABCDEFGHIJKLM', 'Too long', {})).toThrow(AssetRegistryValidationError)
    })

    it('rejects empty name', () => {
      expect(() => parseAssetCreatePayload('X', '  ', {})).toThrow(AssetRegistryValidationError)
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
        parseAssetCreatePayload('X', 'Y', { contractAddress: VALID_ISSUER })
      ).toThrow(AssetRegistryValidationError)
    })

    it('rejects invalid issuer strkey', () => {
      expect(() =>
        parseAssetCreatePayload('X', 'Y', { issuerAccount: 'not-a-g-address' })
      ).toThrow(AssetRegistryValidationError)
    })

    it('rejects malformed coingeckoId', () => {
      expect(() => parseAssetCreatePayload('X', 'Y', { coingeckoId: 'Bad_Id' })).toThrow(
        AssetRegistryValidationError
      )
    })

    it('rejects non-string optional field when provided', () => {
      expect(() =>
        parseAssetCreatePayload('X', 'Y', { coingeckoId: 1 as unknown as string })
      ).toThrow(AssetRegistryValidationError)
    })
  })

  // ==================== NEW TESTS FOR #303 ====================

  describe('validateAssetRegistryEntry & Stellar asset format', () => {
    it('accepts valid Stellar asset format (CODE:ISSUER)', () => {
      const validEntries = [
        {
          assets: ['USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN']
        },
        {
          assets: [
            'USDT:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            'BTC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQZ3K6Z4Z3B'
          ]
        }
      ]

      validEntries.forEach(entry => {
        expect(() => validateAssetRegistryEntry(entry)).not.toThrow()
      })
    })

    it('rejects native XLM as a non-contract asset', () => {
      const entryWithXLM = {
        assets: ['XLM', 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN']
      }

      expect(() => validateAssetRegistryEntry(entryWithXLM))
        .toThrow(/native XLM|native asset|xlm/i)
    })

    it('rejects duplicate assets in a single registry entry', () => {
      const entryWithDuplicate = {
        assets: [
          'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          'BTC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQZ3K6Z4Z3B',
          'USDC:GA5