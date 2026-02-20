import { beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
