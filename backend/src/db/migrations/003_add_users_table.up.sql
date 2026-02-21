-- Migration: 003_add_users_table (up)
-- Description: Add a users table to store registered wallet addresses.
-- The seed.e2e.ts script references this table for E2E test setup.

CREATE TABLE IF NOT EXISTS users (
    address     VARCHAR(256) PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_address ON users(address);
