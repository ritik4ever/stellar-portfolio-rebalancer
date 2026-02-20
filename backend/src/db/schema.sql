CREATE TABLE IF NOT EXISTS portfolios (
    id VARCHAR(64) PRIMARY KEY,
    user_address VARCHAR(256) NOT NULL,
    allocations JSONB NOT NULL DEFAULT '{}',
    threshold INTEGER NOT NULL,
    balances JSONB NOT NULL DEFAULT '{}',
    total_value NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_rebalance TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_address);

CREATE TABLE IF NOT EXISTS rebalance_events (
    id VARCHAR(64) PRIMARY KEY,
    portfolio_id VARCHAR(64) NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trigger VARCHAR(512) NOT NULL,
    trades INTEGER NOT NULL DEFAULT 0,
    gas_used VARCHAR(64) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL CHECK (status IN ('completed', 'failed', 'pending')),
    is_automatic BOOLEAN NOT NULL DEFAULT FALSE,
    risk_alerts JSONB,
    error TEXT,
    details JSONB
);

CREATE INDEX IF NOT EXISTS idx_rebalance_events_portfolio ON rebalance_events(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_rebalance_events_timestamp ON rebalance_events(timestamp DESC);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id SERIAL PRIMARY KEY,
    portfolio_id VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_value NUMERIC NOT NULL,
    allocations JSONB NOT NULL DEFAULT '{}',
    balances JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_analytics_portfolio_time ON analytics_snapshots(portfolio_id, timestamp DESC);
