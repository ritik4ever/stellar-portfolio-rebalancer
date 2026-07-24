-- Migration: 012_portfolio_search (up)
-- Description: Add name, description, and full-text search capability to portfolios.
-- Rollback: See 012_portfolio_search.down.sql

ALTER TABLE portfolios ADD COLUMN name VARCHAR(256);
ALTER TABLE portfolios ADD COLUMN description TEXT;

-- Add a generated tsvector column for fast full-text search
ALTER TABLE portfolios
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX idx_portfolios_search_vector ON portfolios USING GIN (search_vector);
