-- Migration: 015_refresh_token_families (up)
-- Description: Track refresh-token rotation state so a single-use refresh token can be
--              rotated within a family, and reuse of a rotated-out token can be detected
--              and punished by revoking the whole family.

-- A family is one login session's chain of rotated refresh tokens.
CREATE TABLE IF NOT EXISTS refresh_token_families (
    id                 VARCHAR(64)  PRIMARY KEY,
    user_address       VARCHAR(256) NOT NULL,
    current_generation INTEGER      NOT NULL DEFAULT 0,
    revoked            BOOLEAN      NOT NULL DEFAULT FALSE,
    revoked_reason     VARCHAR(64)  NULL,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_families_user ON refresh_token_families(user_address);

-- Hashes of tokens that have already been rotated out. A hit here on a refresh
-- attempt means the token was replayed.
CREATE TABLE IF NOT EXISTS refresh_token_rotations (
    token_hash  VARCHAR(256) PRIMARY KEY,
    family_id   VARCHAR(64)  NOT NULL,
    generation  INTEGER      NOT NULL,
    rotated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_rotations_family  ON refresh_token_rotations(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_rotations_expires ON refresh_token_rotations(expires_at);

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS family_id  VARCHAR(64) NULL;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS generation INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
