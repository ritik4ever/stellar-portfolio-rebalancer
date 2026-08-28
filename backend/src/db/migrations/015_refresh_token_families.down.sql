-- Migration: 015_refresh_token_families (down)
-- Description: Rollback for refresh-token rotation state.
-- Rollback for: 015_refresh_token_families.up.sql

DROP INDEX IF EXISTS idx_refresh_tokens_family;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS generation;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS family_id;

DROP INDEX IF EXISTS idx_refresh_token_rotations_expires;
DROP INDEX IF EXISTS idx_refresh_token_rotations_family;
DROP TABLE IF EXISTS refresh_token_rotations;

DROP INDEX IF EXISTS idx_refresh_token_families_user;
DROP TABLE IF EXISTS refresh_token_families;
