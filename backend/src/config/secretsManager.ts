import { createHash } from 'node:crypto'
import {
    GetSecretValueCommand,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'

let client: SecretsManagerClient | null = null

function getSecretsManagerClient(): SecretsManagerClient {
    if (!client) {
        const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION
        client = new SecretsManagerClient(region ? { region } : {})
    }
    return client
}

export async function fetchSecretString(secretId: string): Promise<string> {
    const response = await getSecretsManagerClient().send(new GetSecretValueCommand({ SecretId: secretId }))

    if (typeof response.SecretString === 'string' && response.SecretString.length > 0) {
        return response.SecretString
    }

    if (response.SecretBinary) {
        return Buffer.from(response.SecretBinary).toString('utf8')
    }

    throw new Error(`Secrets Manager secret ${maskSecretId(secretId)} did not contain SecretString or SecretBinary`)
}

export async function fetchJsonSecret(secretId: string): Promise<Record<string, unknown>> {
    const secretString = await fetchSecretString(secretId)
    const parsed = JSON.parse(secretString) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Secrets Manager secret ${maskSecretId(secretId)} must contain a JSON object`)
    }

    return parsed as Record<string, unknown>
}

export function stableFingerprint(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`
    }

    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
    }

    return JSON.stringify(value)
}

export function maskSecretId(secretId: string): string {
    if (!secretId) return '<unset>'
    if (secretId.length <= 16) return '<hidden>'
    return `${secretId.slice(0, 8)}...${secretId.slice(-8)}`
}

export function __resetSecretsManagerClientForTests(): void {
    client = null
}
