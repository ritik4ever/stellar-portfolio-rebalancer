-- Migration: 013_api_keys (up)
-- Description: Add api_keys table for programmatic access with scoped permissions.

CREATE TABLE IF NOT EXISTS api_keys (
    id            VARCHAR(64)  PRIMARY KEY,
    user_address  VARCHAR(256) NOT NULL,
    name          VARCHAR(128) NOT NULL,
    key_hash      VARCHAR(256) NOT NULL UNIQUE,
    key_prefix    VARCHAR(16)  NOT NULL,          -- first 8 chars, stored plain for display
    scope         VARCHAR(16)  NOT NULL DEFAULT 'read-only'
                  CHECK (scope IN ('read-only', 'read-write')),
    revoked       BOOLEAN      NOT NULL DEFAULT FALSE,
    grace_expires_at TIMESTAMPTZ NULL,            -- old key still valid until this time on rotation
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ  NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user    ON api_keys(user_address);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash    ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked ON api_keys(revoked) WHERE revoked = FALSE;
