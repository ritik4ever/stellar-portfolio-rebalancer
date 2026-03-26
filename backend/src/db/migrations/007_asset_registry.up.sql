-- Migration: 007_asset_registry (up)
-- Description: Asset registry for configurable assets (symbol, name, contract/issuer, coingecko_id). No contract redeploy needed for new assets.
-- Rollback: See 007_asset_registry.down.sql

CREATE TABLE IF NOT EXISTS assets (
    symbol          VARCHAR(32) PRIMARY KEY,
    name            VARCHAR(256) NOT NULL,
    contract_address VARCHAR(256),
    issuer_account  VARCHAR(256),
    coingecko_id    VARCHAR(128),
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_enabled ON assets(enabled) WHERE enabled = TRUE;

COMMENT ON TABLE assets IS 'Configurable asset registry; supports custom Stellar tokens via contract_address/issuer_account';
COMMENT ON COLUMN assets.contract_address IS 'Stellar contract address for Soroban tokens; empty for native XLM';
COMMENT ON COLUMN assets.issuer_account IS 'Stellar issuer account for classic assets';
COMMENT ON COLUMN assets.coingecko_id IS 'CoinGecko API id for price feed';

INSERT INTO assets (symbol, name, contract_address, issuer_account, coingecko_id, enabled) VALUES
    ('XLM', 'Stellar Lumens', NULL, NULL, 'stellar', TRUE),
    ('USDC', 'USD Coin', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', NULL, 'usd-coin', TRUE),
    ('BTC', 'Bitcoin', 'GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF', NULL, 'bitcoin', TRUE),
    ('ETH', 'Ethereum', NULL, NULL, 'ethereum', TRUE)
ON CONFLICT (symbol) DO NOTHING;
