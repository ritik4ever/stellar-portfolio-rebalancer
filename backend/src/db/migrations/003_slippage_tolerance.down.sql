-- Migration: 003_slippage_tolerance (down)
ALTER TABLE portfolios DROP COLUMN IF EXISTS slippage_tolerance;
