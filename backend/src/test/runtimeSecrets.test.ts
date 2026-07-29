import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMock } = vi.hoisted(() => ({
    sendMock: vi.fn(),
}))

vi.mock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManagerClient: vi.fn().mockImplementation(function SecretsManagerClient() { return { send: sendMock } }),
    GetSecretValueCommand: vi.fn().mockImplementation(function GetSecretValueCommand(input: Record<string, unknown>) { return { input } }),
}))

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('runtime Secrets Manager hydration', () => {
    let envBackup: NodeJS.ProcessEnv

    beforeEach(async () => {
        envBackup = { ...process.env }
        vi.clearAllMocks()
        const runtimeSecrets = await import('../config/runtimeSecrets.js')
        const secretsManager = await import('../config/secretsManager.js')
        runtimeSecrets.__resetRuntimeSecretStateForTests()
        secretsManager.__resetSecretsManagerClientForTests()
    })

    afterEach(async () => {
        const runtimeSecrets = await import('../config/runtimeSecrets.js')
        runtimeSecrets.__resetRuntimeSecretStateForTests()
        process.env = envBackup
    })

    it('hydrates PostgreSQL environment variables from an RDS JSON secret', async () => {
        process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db'
        sendMock.mockResolvedValueOnce({
            SecretString: JSON.stringify({
                username: 'dbadmin',
                password: 'rotated-password',
                host: 'db.example.internal',
                port: 5432,
                dbname: 'stellar_portfolio',
            }),
        })

        const { refreshDatabaseSecret } = await import('../config/runtimeSecrets.js')
        const result = await refreshDatabaseSecret({ force: true })

        expect(result.configured).toBe(true)
        expect(result.refreshed).toBe(true)
        expect(process.env.PGUSER).toBe('dbadmin')
        expect(process.env.PGPASSWORD).toBe('rotated-password')
        expect(process.env.PGHOST).toBe('db.example.internal')
        expect(process.env.PGDATABASE).toBe('stellar_portfolio')
    })

    it('hydrates REDIS_URL with rediss and an encoded AUTH token from a Redis secret', async () => {
        process.env.REDIS_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:redis'
        sendMock.mockResolvedValueOnce({
            SecretString: JSON.stringify({
                primary_endpoint_address: 'redis.example.internal',
                port: 6379,
                auth_token: 'token with symbols +/=',
                tls: true,
            }),
        })

        const { refreshRedisSecret } = await import('../config/runtimeSecrets.js')
        const result = await refreshRedisSecret({ force: true })

        expect(result.configured).toBe(true)
        expect(result.refreshed).toBe(true)
        expect(process.env.REDIS_AUTH_TOKEN).toBe('token with symbols +/=')
        expect(process.env.REDIS_URL).toBe('rediss://:token%20with%20symbols%20%2B%2F%3D@redis.example.internal:6379')
    })
})
