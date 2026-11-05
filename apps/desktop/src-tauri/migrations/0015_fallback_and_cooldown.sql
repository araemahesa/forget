-- Migration 0015: Add fallback_policy, connection_cooldown, ai_checkpoint tables
-- These tables support routing fallback, rate limit cooldowns, and task checkpoints.

CREATE TABLE IF NOT EXISTS fallback_policy (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    ordered_profile_ids_json TEXT NOT NULL DEFAULT '[]',
    allowed_provider_ids_json TEXT NOT NULL DEFAULT '[]',
    allow_cross_provider INTEGER NOT NULL DEFAULT 0,
    allow_model_change INTEGER NOT NULL DEFAULT 0,
    routing_owner TEXT NOT NULL DEFAULT 'forgekit',
    max_attempts INTEGER NOT NULL DEFAULT 2,
    max_elapsed_ms INTEGER NOT NULL DEFAULT 60000,
    budget_policy_id TEXT,
    data_policy_id TEXT
);

CREATE TABLE IF NOT EXISTS connection_cooldown (
    bucket_id TEXT PRIMARY KEY,
    until_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_checkpoint (
    task_id TEXT PRIMARY KEY REFERENCES creative_task(id) ON DELETE CASCADE,
    checkpoint_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

PRAGMA user_version = 14;

