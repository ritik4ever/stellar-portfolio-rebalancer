import Database from 'better-sqlite3'

export interface NotificationPreferencesRow {
    user_id: string
    email_enabled: number
    email_address: string | null
    webhook_enabled: number
    webhook_url: string | null
    event_rebalance: number
    event_circuit_breaker: number
    event_price_movement: number
    event_risk_change: number
    created_at: string
    updated_at: string
}

export interface NotificationPreferences {
    userId: string
    emailEnabled: boolean
    emailAddress?: string
    webhookEnabled: boolean
    webhookUrl?: string
    events: {
        rebalance: boolean
        circuitBreaker: boolean
        priceMovement: boolean
        riskChange: boolean
    }
}

// Get or create the SQLite database instance for notifications
let notificationDb: Database.Database | null = null

function getDb(): Database.Database {
    if (!notificationDb) {
        const dbPath = process.env.DB_PATH || './data/portfolio.db'
        notificationDb = new Database(dbPath)
    }
    return notificationDb
}

// Initialize notification_preferences table if it doesn't exist
function ensureNotificationTable() {
    const db = getDb()
    db.exec(`
        CREATE TABLE IF NOT EXISTS notification_preferences (
            user_id TEXT PRIMARY KEY,
            email_enabled INTEGER NOT NULL DEFAULT 0,
            email_address TEXT,
            webhook_enabled INTEGER NOT NULL DEFAULT 0,
            webhook_url TEXT,
            event_rebalance INTEGER NOT NULL DEFAULT 1,
            event_circuit_breaker INTEGER NOT NULL DEFAULT 1,
            event_price_movement INTEGER NOT NULL DEFAULT 1,
            event_risk_change INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notification_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            event_type TEXT NOT NULL,
            status TEXT NOT NULL,
            error_message TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_notification_logs_user ON notification_logs(user_id);
    `)
}

function rowToPreferences(r: NotificationPreferencesRow): NotificationPreferences {
    return {
        userId: r.user_id,
        emailEnabled: r.email_enabled === 1,
        emailAddress: r.email_address || undefined,
        webhookEnabled: r.webhook_enabled === 1,
        webhookUrl: r.webhook_url || undefined,
        events: {
            rebalance: r.event_rebalance === 1,
            circuitBreaker: r.event_circuit_breaker === 1,
            priceMovement: r.event_price_movement === 1,
            riskChange: r.event_risk_change === 1
        }
    }
}

export function dbSaveNotificationPreferences(preferences: NotificationPreferences): void {
    ensureNotificationTable()
    const db = getDb()
    
    const now = new Date().toISOString()

    db.prepare(`
        INSERT INTO notification_preferences 
            (user_id, email_enabled, email_address, webhook_enabled, webhook_url, 
             event_rebalance, event_circuit_breaker, event_price_movement, event_risk_change,
             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
            email_enabled = excluded.email_enabled,
            email_address = excluded.email_address,
            webhook_enabled = excluded.webhook_enabled,
            webhook_url = excluded.webhook_url,
            event_rebalance = excluded.event_rebalance,
            event_circuit_breaker = excluded.event_circuit_breaker,
            event_price_movement = excluded.event_price_movement,
            event_risk_change = excluded.event_risk_change,
            updated_at = excluded.updated_at
    `).run(
        preferences.userId,
        preferences.emailEnabled ? 1 : 0,
        preferences.emailAddress || null,
        preferences.webhookEnabled ? 1 : 0,
        preferences.webhookUrl || null,
        preferences.events.rebalance ? 1 : 0,
        preferences.events.circuitBreaker ? 1 : 0,
        preferences.events.priceMovement ? 1 : 0,
        preferences.events.riskChange ? 1 : 0,
        now,
        now
    )
}

export function dbGetNotificationPreferences(userId: string): NotificationPreferences | undefined {
    ensureNotificationTable()
    const db = getDb()

    const row = db.prepare<[string], NotificationPreferencesRow>(
        'SELECT * FROM notification_preferences WHERE user_id = ?'
    ).get(userId)

    return row ? rowToPreferences(row) : undefined
}

export function dbGetAllNotificationPreferences(): NotificationPreferences[] {
    ensureNotificationTable()
    const db = getDb()

    const rows = db.prepare<[], NotificationPreferencesRow>(
        'SELECT * FROM notification_preferences ORDER BY created_at ASC'
    ).all()

    return rows.map(rowToPreferences)
}

export function dbDeleteNotificationPreferences(userId: string): boolean {
    ensureNotificationTable()
    const db = getDb()
    
    const result = db.prepare('DELETE FROM notification_preferences WHERE user_id = ?').run(userId)
    return result.changes > 0
}

/**
 * Represents a log entry for a notification delivery attempt.
 * Used for tracking provider success/failure and troubleshooting.
 */
export interface NotificationLog {
    id: number
    userId: string
    provider: 'email' | 'webhook'
    eventType: string
    status: 'sent' | 'failed' | 'retried' | 'skipped'
    errorMessage?: string
    createdAt: string
}

/**
 * Logs the outcome of a notification delivery attempt (e.g., sent, failed) 
 * and automatically prunes any log entries older than 30 days to save space.
 * @param userId - The user receiving the notification
 * @param provider - 'email' or 'webhook'
 * @param eventType - The type of event (e.g., 'rebalance', 'circuitBreaker')
 * @param status - Success/failure state of the delivery attempt
 * @param errorMessage - Optional error details if the delivery failed or was skipped
 */
export function dbLogNotificationOutcome(
    userId: string,
    provider: 'email' | 'webhook',
    eventType: string,
    status: 'sent' | 'failed' | 'retried' | 'skipped',
    errorMessage?: string
): void {
    ensureNotificationTable()
    const db = getDb()
    const now = new Date().toISOString()
    
    db.prepare(`
        INSERT INTO notification_logs 
            (user_id, provider, event_type, status, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, provider, eventType, status, errorMessage || null, now)

    // Run 30-day retention cleanup. Note: SQLite uses 'now', '-30 days' for datetime math.
    // This effectively self-cleans old logs continuously during insertions.
    db.prepare(`
        DELETE FROM notification_logs 
        WHERE created_at < datetime('now', '-30 days')
    `).run();
}

/**
 * Retrieves recent notification delivery logs for a given user.
 * Useful for exposing operational visibility and debugging delivery issues.
 * @param userId - ID of the user to fetch logs for
 * @param limit - Max number of logs to return (default: 50)
 */
export function dbGetNotificationLogs(userId: string, limit: number = 50): NotificationLog[] {
    ensureNotificationTable()
    const db = getDb()

    const rows = db.prepare<[string, number], any>(`
        SELECT * FROM notification_logs 
        WHERE user_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
    `).all(userId, limit)

    return rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        provider: r.provider,
        eventType: r.event_type,
        status: r.status,
        errorMessage: r.error_message || undefined,
        createdAt: r.created_at
    }))
}
