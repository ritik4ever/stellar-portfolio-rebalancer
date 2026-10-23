import { beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Keypair } from '@stellar/stellar-sdk'

// In @stellar/stellar-sdk v17, Keypair.prototype.sign returns Uint8Array instead of Buffer.
// In Node.js, Uint8Array.prototype.toString('base64') returns comma-separated bytes instead of base64.
// Wrapping the returned Uint8Array in Buffer preserves Uint8Array compatibility while enabling .toString('base64').
const origSign = Keypair.prototype.sign
Keypair.prototype.sign = function(data: any) {
    const res = origSign.call(this, data)
    return Buffer.from(res.buffer, res.byteOffset, res.byteLength) as any
}

beforeAll(() => {
    const testDir = join(tmpdir(), 'stellar-tests')
    mkdirSync(testDir, { recursive: true })
    
    if (!process.env.DB_PATH) {
        process.env.DB_PATH = join(testDir, `test-${Date.now()}.db`)
    }
    
    if (process.env.DEBUG !== 'true') {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    }
})

afterAll(() => {
    vi.restoreAllMocks()
})
