-- Migration: 009_price_history (down)
DROP INDEX IF EXISTS idx_price_history_recorded_at;
DROP INDEX IF EXISTS idx_price_history_asset_time;
DROP TABLE IF EXISTS price_history;
