-- Migration: 009_price_history (up)
-- Stores oracle price snapshots for analytics. Pruned after 90 days by the daily pruning job.

CREATE TABLE IF NOT EXISTS price_history (
    id SERIAL PRIMARY KEY,
    asset VARCHAR(32) NOT NULL,
    price NUMERIC NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_asset_time ON price_history(asset, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_recorded_at ON price_history(recorded_at);
