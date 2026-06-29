CREATE TABLE IF NOT EXISTS user_alerts (
    id VARCHAR(64) PRIMARY KEY,
    user_address VARCHAR(256) NOT NULL,
    portfolio_id VARCHAR(64) REFERENCES portfolios(id) ON DELETE CASCADE,
    asset_id VARCHAR(64),
    alert_type VARCHAR(32) NOT NULL CHECK (alert_type IN (
        'portfolio_value_above', 
        'portfolio_value_below', 
        'asset_price_above', 
        'asset_price_below'
    )),
    threshold_value NUMERIC NOT NULL,
    is_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_alerts_address ON user_alerts(user_address);
CREATE INDEX IF NOT EXISTS idx_user_alerts_status ON user_alerts(is_triggered);