-- Migration: 014_portfolio_archiving (down)
-- Description: Rollback for portfolio archiving changes.
-- Rollback for: 014_portfolio_archiving.up.sql

DROP INDEX IF EXISTS idx_portfolios_archived_at;
ALTER TABLE portfolios DROP COLUMN IF EXISTS archived_at;
