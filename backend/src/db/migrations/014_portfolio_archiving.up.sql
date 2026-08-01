-- Migration: 014_portfolio_archiving (up)
-- Description: Add soft-delete / archive support to portfolios.
-- Rollback: See 014_portfolio_archiving.down.sql

ALTER TABLE portfolios ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX idx_portfolios_archived_at ON portfolios(archived_at)
    WHERE archived_at IS NOT NULL;
