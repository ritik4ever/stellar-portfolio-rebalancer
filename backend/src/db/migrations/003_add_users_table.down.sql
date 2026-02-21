-- Migration: 003_add_users_table (down)
-- Rollback: Drop the users table

DROP TABLE IF EXISTS users;
