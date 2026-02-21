-- Migration: 002_seed_demo_data (down)
-- Rollback: Remove demo portfolio and its rebalance events.

DELETE FROM rebalance_events WHERE portfolio_id = 'demo-portfolio-1';
DELETE FROM portfolios WHERE id = 'demo-portfolio-1';
