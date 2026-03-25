CREATE TABLE IF NOT EXISTS refresh_tokens (
    id VARCHAR(64) PRIMARY KEY,
    user_address VARCHAR(256) NOT NULL,
    token_hash VARCHAR(256) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_address);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
