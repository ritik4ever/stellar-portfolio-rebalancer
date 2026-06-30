-- Migration: 013_user_preferences (up)
-- Description: Add user_preferences table for per-user default settings.

CREATE TABLE IF NOT EXISTS user_preferences (
    user_address                  VARCHAR(256) PRIMARY KEY,
    default_threshold             REAL,
    default_cooldown              INTEGER,
    preferred_currency            VARCHAR(32),
    timezone                      VARCHAR(64),
    notification_digest_frequency VARCHAR(32),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_address ON user_preferences(user_address);
