-- Migration: 002_seed_demo_data (up)
-- Description: Optional demo/seed data for development and staging. Safe to skip in production.
-- Rollback: See 002_seed_demo_data.down.sql
-- Idempotent: Uses ON CONFLICT DO NOTHING so re-run is safe.

INSERT INTO portfolios (id, user_address, allocations, threshold, balances, total_value, created_at, last_rebalance)
VALUES (
    'demo-portfolio-1',
    'DEMO-USER',
    '{"XLM": 40, "BTC": 30, "ETH": 20, "USDC": 10}',
    5,
    '{"XLM": 11173.18, "BTC": 0.02697, "ETH": 0.68257, "USDC": 1000}',
    10000,
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO rebalance_events (id, portfolio_id, timestamp, trigger, trades, gas_used, status, is_automatic, risk_alerts, error, details)
VALUES
    (
        'demo-evt-1',
        'demo-portfolio-1',
        NOW() - INTERVAL '2 hours',
        'Threshold exceeded (8.2%)',
        3,
        '0.0234 XLM',
        'completed',
        FALSE,
        NULL,
        NULL,
        '{"fromAsset": "XLM", "toAsset": "ETH", "amount": 1200, "reason": "Portfolio allocation drift exceeded rebalancing threshold", "riskLevel": "medium", "priceDirection": "down", "performanceImpact": "neutral"}'::jsonb
    ),
    (
        'demo-evt-2',
        'demo-portfolio-1',
        NOW() - INTERVAL '12 hours',
        'Automatic Rebalancing',
        2,
        '0.0156 XLM',
        'completed',
        TRUE,
        NULL,
        NULL,
        '{"reason": "Automated scheduled rebalancing executed", "riskLevel": "low", "priceDirection": "up", "performanceImpact": "positive"}'::jsonb
    ),
    (
        'demo-evt-3',
        'demo-portfolio-1',
        NOW() - INTERVAL '3 days',
        'Volatility circuit breaker',
        1,
        '0.0089 XLM',
        'completed',
        TRUE,
        NULL,
        NULL,
        '{"reason": "High market volatility detected, protective rebalance executed", "volatilityDetected": true, "riskLevel": "high", "priceDirection": "down", "performanceImpact": "negative"}'::jsonb
    )
ON CONFLICT (id) DO NOTHING;
