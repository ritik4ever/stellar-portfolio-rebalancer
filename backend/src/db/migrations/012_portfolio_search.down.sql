-- Migration: 012_portfolio_search (down)
-- Description: Rollback for portfolio search changes.
-- Rollback for: 012_portfolio_search.up.sql

DROP INDEX IF EXISTS idx_portfolios_search_vector;
ALTER TABLE portfolios DROP COLUMN IF EXISTS search_vector;
ALTER TABLE portfolios DROP COLUMN IF EXISTS description;
ALTER TABLE portfolios DROP COLUMN IF EXISTS name;
