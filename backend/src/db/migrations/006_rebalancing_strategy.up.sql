ALTER TABLE portfolios
ADD COLUMN IF NOT EXISTS strategy VARCHAR(32) NOT NULL DEFAULT 'threshold',
ADD COLUMN IF NOT EXISTS strategy_config JSONB DEFAULT '{}';

COMMENT ON COLUMN portfolios.strategy IS 'Rebalancing strategy: threshold, periodic, volatility, custom';
COMMENT ON COLUMN portfolios.strategy_config IS 'Strategy-specific options (intervalDays, volatilityThresholdPct, etc.)';
