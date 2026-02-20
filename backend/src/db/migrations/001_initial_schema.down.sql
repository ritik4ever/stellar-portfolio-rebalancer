-- Migration: 001_initial_schema (down)
-- Rollback: Drop tables in reverse dependency order to respect foreign keys.

DROP INDEX IF EXISTS idx_notification_preferences_user;
DROP TABLE IF EXISTS notification_preferences;

DROP INDEX IF EXISTS idx_analytics_portfolio_time;
DROP TABLE IF EXISTS analytics_snapshots;

DROP INDEX IF EXISTS idx_rebalance_events_timestamp;
DROP INDEX IF EXISTS idx_rebalance_events_portfolio;
DROP TABLE IF EXISTS rebalance_events;

DROP INDEX IF EXISTS idx_portfolios_user;
DROP TABLE IF EXISTS portfolios;
