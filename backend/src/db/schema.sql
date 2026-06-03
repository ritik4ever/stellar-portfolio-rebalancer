
CREATE TABLE IF NOT EXISTS rebalance_events (
    id VARCHAR(64) PRIMARY KEY,
    portfolio_id VARCHAR(64) NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trigger VARCHAR(512) NOT NULL,
    trades INTEGER NOT NULL DEFAULT 0,
    gas_used VARCHAR(64) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL CHECK (status IN ('completed', 'failed', 'pending')),
    is_automatic BOOLEAN NOT NULL DEFAULT FALSE,
    event_source VARCHAR(32) NOT NULL DEFAULT 'offchain',
    on_chain_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    on_chain_event_type VARCHAR(128),
    on_chain_tx_hash VARCHAR(128),
    on_chain_ledger BIGINT,
    on_chain_contract_id VARCHAR(128),
    on_chain_paging_token VARCHAR(256),
    is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
    risk_alerts JSONB,
    error TEXT,
    details JSONB
);

CREATE INDEX IF NOT EXISTS idx_rebalance_events_portfolio ON rebalance_events(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_rebalance_events_timestamp ON rebalance_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_rebalance_events_source ON rebalance_events(event_source, timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rebalance_events_chain_token
    ON rebalance_events(on_chain_paging_token)
    WHERE on_chain_paging_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS contract_event_indexer_state (
    name VARCHAR(128) PRIMARY KEY,
    cursor VARCHAR(512),
    latest_ledger BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_successful_sync_at TIMESTAMPTZ,
    last_failed_sync_at TIMESTAMPTZ,
    last_error TEXT
);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id SERIAL PRIMARY KEY,
    portfolio_id VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_value NUMERIC NOT NULL,
    allocations JSONB NOT NULL DEFAULT '{}',
    balances JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_analytics_portfolio_time ON analytics_snapshots(portfolio_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id VARCHAR(256) PRIMARY KEY,
    email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    email_address VARCHAR(512),
    webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    webhook_url VARCHAR(1024),
    event_rebalance BOOLEAN NOT NULL DEFAULT TRUE,
    event_circuit_breaker BOOLEAN NOT NULL DEFAULT TRUE,
    event_price_movement BOOLEAN NOT NULL DEFAULT TRUE,
    event_risk_change BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id);

CREATE TABLE IF NOT EXISTS notification_logs (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(256) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_user ON notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_drafts (
    id VARCHAR(64) PRIMARY KEY,
    user_address VARCHAR(256) NOT NULL,
    label VARCHAR(256),
    allocations JSONB NOT NULL DEFAULT '{}',
    threshold REAL NOT NULL DEFAULT 5,
    slippage_tolerance_percent REAL NOT NULL DEFAULT 1,
    strategy VARCHAR(32) NOT NULL DEFAULT 'threshold',
    strategy_config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    published_portfolio_id VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_drafts_user ON portfolio_drafts(user_address, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_drafts_expires ON portfolio_drafts(expires_at);
