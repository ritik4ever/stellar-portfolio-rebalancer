-- Migration: 011_rebalance_cost_metrics (up)
-- Description: Store realized fee and slippage metrics on rebalance events.
-- Rollback: See 011_rebalance_cost_metrics.down.sql

ALTER TABLE rebalance_events
ADD COLUMN IF NOT EXISTS fee_paid NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE rebalance_events
ADD COLUMN IF NOT EXISTS slippage_bps NUMERIC NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_rebalance_events_portfolio_cost
    ON rebalance_events(portfolio_id, timestamp DESC);

