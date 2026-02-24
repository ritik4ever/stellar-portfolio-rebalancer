-- Migration: 003_slippage_tolerance (up)
-- Add slippage_tolerance to portfolios (0.5 - 5 percent, default 1).

ALTER TABLE portfolios
ADD COLUMN IF NOT EXISTS slippage_tolerance NUMERIC NOT NULL DEFAULT 1;

COMMENT ON COLUMN portfolios.slippage_tolerance IS 'Max allowed slippage for rebalance trades, in percent (0.5-5).';
