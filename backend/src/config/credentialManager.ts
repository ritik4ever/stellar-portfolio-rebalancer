import { logger } from '../utils/logger.js';
import { buildRedisUrl, isRedisTlsEnabled } from './redisConnectionOptions.js';

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

    /**
     * Timer handle for the proactive background refresh loop.
     * Set when startBackgroundRefresh() is called; cleared by stopBackgroundRefresh().
     */
    private backgroundRefreshTimer: ReturnType<typeof setInterval> | null = null;

    constructor() {}

    /**
     * Start a proactive background refresh loop that re-fetches credentials
     * from AWS Secrets Manager before the TTL cache window expires.
     *
     * Call this once at application startup when USE_AWS_SECRETS_MANAGER=true
     * so that a rotation event is picked up within one refresh interval rather
     * than waiting for the first cache miss or an auth error.
     *
     * @param intervalMs  How often to refresh (default: 4 minutes — slightly
     *                    shorter than the 5-minute TTL so the cache never
     *                    serves stale credentials).
     */
    public startBackgroundRefresh(intervalMs = 240_000): void {
        if (this.backgroundRefreshTimer) {
            // Already running — nothing to do.
            return;
        }

        const secretArn = (process.env.DB_SECRET_ARN || process.env.AWS_DB_SECRET_ID)?.trim();
        const useSecretsManager = process.env.USE_AWS_SECRETS_MANAGER === 'true' || Boolean(secretArn);

        if (!useSecretsManager) {
            logger.debug('[CREDENTIALS] Secrets Manager not configured — skipping background refresh');
            return;
        }

        logger.info('[CREDENTIALS] Starting proactive background credential refresh', {
            intervalMs,
        });

        this.backgroundRefreshTimer = setInterval(async () => {
            try {
                await Promise.all([
                    this.getDbCredentials(true),
                    this.getRedisCredentials(true),
                ]);
                logger.debug('[CREDENTIALS] Background credential refresh completed');
            } catch (err) {
                logger.warn('[CREDENTIALS] Background credential refresh failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }, intervalMs);

        // Allow Node.js to exit even if the timer is active (non-blocking).
        if (this.backgroundRefreshTimer?.unref) {
            this.backgroundRefreshTimer.unref();
        }
    }

    /** Stop the proactive background refresh loop. Useful in tests. */
    public stopBackgroundRefresh(): void {
        if (this.backgroundRefreshTimer) {
            clearInterval(this.backgroundRefreshTimer);
            this.backgroundRefreshTimer = null;
            logger.debug('[CREDENTIALS] Background credential refresh stopped');
        }
    }

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

        // REDIS_HOST is the ElastiCache *replication-group* endpoint (host:port)
        // exported by Terraform. Because it is a cluster endpoint rather than a
        // node address, clients keep working unchanged after a Multi-AZ failover.
        const rawHost = process.env.REDIS_HOST?.trim();
        const authToken = (process.env.REDIS_AUTH_TOKEN || process.env.REDIS_PASSWORD)?.trim();
        const tls = isRedisTlsEnabled();

        const url = buildRedisUrl({
            url: process.env.REDIS_URL,
            host: rawHost,
            authToken,
            tls,
        });

        const result: RedisCredentials = {
            url,
            host: rawHost,
            authToken,
            tls,
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
                    const rawHost = process.env.REDIS_HOST?.trim();
                    const tls = isRedisTlsEnabled();
                    const url = buildRedisUrl({
                        url: process.env.REDIS_URL,
                        host: rawHost,
                        authToken,
                        tls,
                    });
                    const creds: RedisCredentials = {
                        url,
                        host: rawHost,
                        authToken,
                        tls,
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
