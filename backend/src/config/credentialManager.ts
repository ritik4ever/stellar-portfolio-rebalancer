import { logger } from '../utils/logger.js';

export interface DbCredentials {
    user?: string;
    password?: string;
    host?: string;
    port?: number;
    database?: string;
    connectionString?: string;
    source: 'env' | 'secrets_manager';
    lastRefreshed: Date;
}

export interface RedisCredentials {
    url: string;
    host?: string;
    port?: number;
    authToken?: string;
    tls?: boolean;
    source: 'env' | 'secrets_manager';
    lastRefreshed: Date;
}

class CredentialManager {
    private dbCredsCache: DbCredentials | null = null;
    private redisCredsCache: RedisCredentials | null = null;
    private cacheTtlMs = 300_000; // 5 minutes default
    private lastDbRefresh = 0;
    private lastRedisRefresh = 0;

    constructor() {}

    public clearCache(): void {
        this.dbCredsCache = null;
        this.redisCredsCache = null;
        this.lastDbRefresh = 0;
        this.lastRedisRefresh = 0;
        logger.info('[CREDENTIALS] In-memory credential cache cleared');
    }

    public isDbConfigured(): boolean {
        const creds = this.getDbCredentialsSync(true);
        if (creds.connectionString) return true;
        if (creds.host && creds.database && creds.user) return true;
        return false;
    }

    public getDbCredentialsSync(forceRefresh = false): DbCredentials {
        const now = Date.now();
        if (!forceRefresh && this.dbCredsCache && now - this.lastDbRefresh < this.cacheTtlMs) {
            return this.dbCredsCache;
        }

        // Synchronous resolution from environment variables
        const host = (process.env.PGHOST || process.env.DB_HOST)?.trim();
        const database = (process.env.PGDATABASE || process.env.DB_NAME || 'stellar_portfolio')?.trim();
        const user = (process.env.PGUSER || process.env.DB_USER)?.trim();
        const password = (process.env.PGPASSWORD || process.env.DB_PASSWORD || '')?.trim();
        const rawPort = process.env.PGPORT || process.env.DB_PORT || '5432';
        const port = Number.parseInt(rawPort, 10);
        const url = process.env.DATABASE_URL?.trim();

        const result: DbCredentials = {
            user,
            password,
            host,
            port: Number.isFinite(port) ? port : 5432,
            database,
            connectionString: url,
            source: 'env',
            lastRefreshed: new Date(now),
        };

        this.dbCredsCache = result;
        this.lastDbRefresh = now;
        return result;
    }

    public async getDbCredentials(forceRefresh = false): Promise<DbCredentials> {
        const now = Date.now();
        if (!forceRefresh && this.dbCredsCache && now - this.lastDbRefresh < this.cacheTtlMs) {
            return this.dbCredsCache;
        }

        const secretArn = (process.env.DB_SECRET_ARN || process.env.AWS_DB_SECRET_ID)?.trim();
        const useSecretsManager = process.env.USE_AWS_SECRETS_MANAGER === 'true' || Boolean(secretArn);

        if (useSecretsManager && secretArn) {
            try {
                const secretValue = await this.fetchSecretFromAWS(secretArn);
                if (secretValue) {
                    const parsed = JSON.parse(secretValue);
                    const creds: DbCredentials = {
                        user: parsed.username || parsed.user || '',
                        password: parsed.password || '',
                        host: parsed.host || '',
                        port: Number.parseInt(parsed.port || '5432', 10) || 5432,
                        database: parsed.dbname || parsed.database || 'stellar_portfolio',
                        source: 'secrets_manager',
                        lastRefreshed: new Date(now),
                    };
                    this.dbCredsCache = creds;
                    this.lastDbRefresh = now;
                    logger.info('[CREDENTIALS] Refreshed DB credentials from AWS Secrets Manager');
                    return creds;
                }
            } catch (err) {
                logger.warn('[CREDENTIALS] Failed to fetch DB credentials from AWS Secrets Manager, falling back to environment', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }

        return this.getDbCredentialsSync(forceRefresh);
    }

    public getRedisUrl(forceRefresh = false): string {
        const creds = this.getRedisCredentialsSync(forceRefresh);
        return creds.url;
    }

    public getRedisCredentialsSync(forceRefresh = false): RedisCredentials {
        const now = Date.now();
        if (!forceRefresh && this.redisCredsCache && now - this.lastRedisRefresh < this.cacheTtlMs) {
            return this.redisCredsCache;
        }

        const rawUrl = process.env.REDIS_URL?.trim() || 'redis://localhost:6379';
        const authToken = (process.env.REDIS_AUTH_TOKEN || process.env.REDIS_PASSWORD)?.trim();

        let url = rawUrl;
        if (authToken && url && !url.includes('@')) {
            // Inject AUTH token into redis:// or rediss:// URL if not already present
            url = url.replace(/^(rediss?:\/\/)/, `$1:${encodeURIComponent(authToken)}@`);
        }

        const result: RedisCredentials = {
            url,
            authToken,
            source: 'env',
            lastRefreshed: new Date(now),
        };

        this.redisCredsCache = result;
        this.lastRedisRefresh = now;
        return result;
    }

    public async getRedisCredentials(forceRefresh = false): Promise<RedisCredentials> {
        const now = Date.now();
        if (!forceRefresh && this.redisCredsCache && now - this.lastRedisRefresh < this.cacheTtlMs) {
            return this.redisCredsCache;
        }

        const secretArn = (process.env.REDIS_SECRET_ARN || process.env.AWS_REDIS_SECRET_ID)?.trim();
        const useSecretsManager = process.env.USE_AWS_SECRETS_MANAGER === 'true' || Boolean(secretArn);

        if (useSecretsManager && secretArn) {
            try {
                const secretValue = await this.fetchSecretFromAWS(secretArn);
                if (secretValue) {
                    const parsed = JSON.parse(secretValue);
                    const authToken = parsed.auth_token || parsed.authToken || parsed.password || '';
                    const rawUrl = process.env.REDIS_URL?.trim() || 'redis://localhost:6379';
                    let url = rawUrl;
                    if (authToken && !url.includes('@')) {
                        url = url.replace(/^(rediss?:\/\/)/, `$1:${encodeURIComponent(authToken)}@`);
                    }
                    const creds: RedisCredentials = {
                        url,
                        authToken,
                        source: 'secrets_manager',
                        lastRefreshed: new Date(now),
                    };
                    this.redisCredsCache = creds;
                    this.lastRedisRefresh = now;
                    logger.info('[CREDENTIALS] Refreshed Redis credentials from AWS Secrets Manager');
                    return creds;
                }
            } catch (err) {
                logger.warn('[CREDENTIALS] Failed to fetch Redis credentials from AWS Secrets Manager, falling back to environment', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }

        return this.getRedisCredentialsSync(forceRefresh);
    }

    private async fetchSecretFromAWS(secretId: string): Promise<string | undefined> {
        const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
        const client = new SecretsManagerClient({});
        const command = new GetSecretValueCommand({ SecretId: secretId });
        const response = await client.send(command);
        return response.SecretString;
    }
}

export const credentialManager = new CredentialManager();
