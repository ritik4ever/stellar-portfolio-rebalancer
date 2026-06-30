-- Migration: 011_rebalance_cost_metrics (down)
-- Description: Remove realized fee and slippage metrics from rebalance events.

DROP INDEX IF EXISTS idx_rebalance_events_portfolio_cost;

ALTER TABLE rebalance_events
DROP COLUMN IF EXISTS slippage_bps;

ALTER TABLE rebalance_events
DROP COLUMN IF EXISTS fee_paid;

