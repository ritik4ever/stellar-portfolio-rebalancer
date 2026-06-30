import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRunStartupSelfTest, mockFormatStartupSelfTestReport } = vi.hoisted(() => ({
    mockRunStartupSelfTest: vi.fn(),
    mockFormatStartupSelfTestReport: vi.fn(),
}))

vi.mock('../monitoring/startupSelfTest.js', () => ({
    runStartupSelfTest: mockRunStartupSelfTest,
    formatStartupSelfTestReport: mockFormatStartupSelfTestReport,
}))

import { main } from '../index.js'

const REQUIRED_STARTUP_ENV = {
    NODE_ENV: 'development',
    PORT: '3001',
    STELLAR_NETWORK: 'testnet',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    STELLAR_REBALANCE_SECRET: `S${'A'.repeat(55)}`,
}

describe('index startup self-test flag', () => {
    let envBackup: NodeJS.ProcessEnv
    let exitCodeBackup: number | undefined

    beforeEach(() => {
        vi.clearAllMocks()
        envBackup = { ...process.env }
        exitCodeBackup = process.exitCode
        process.env = { ...process.env, ...REQUIRED_STARTUP_ENV }
        delete process.env.CONTRACT_ADDRESS

        mockRunStartupSelfTest.mockResolvedValue({
            ok: true,
            timestamp: new Date().toISOString(),
            durationMs: 12,
            summary: {
                totalChecks: 1,
                passedChecks: 1,
                failedChecks: 0,
            },
            config: {},
            checks: [],
        })
        mockFormatStartupSelfTestReport.mockReturnValue('startup self-test output')
    })

    afterEach(() => {
        process.env = envBackup
        process.exitCode = exitCodeBackup
        vi.restoreAllMocks()
    })

    it('runs the startup self-test branch without validating the server config first', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

        await main(['node', 'index.ts', '--startup-self-test'])

        expect(mockRunStartupSelfTest).toHaveBeenCalledOnce()
        expect(mockFormatStartupSelfTestReport).toHaveBeenCalledOnce()
        expect(logSpy).toHaveBeenCalledWith('startup self-test output')
        expect(process.exitCode).toBe(0)
    })
})
