-- Migration: 007_asset_registry (down)
DROP INDEX IF EXISTS idx_assets_enabled;
DROP TABLE IF EXISTS assets;
