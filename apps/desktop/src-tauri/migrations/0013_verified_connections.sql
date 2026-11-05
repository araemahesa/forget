BEGIN IMMEDIATE;

CREATE TABLE connection_verification (
    profile_id TEXT PRIMARY KEY REFERENCES connection_profile(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    base_url TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    text_streaming INTEGER NOT NULL DEFAULT 0,
    tools INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE connection_cooldown (
    bucket_id TEXT PRIMARY KEY,
    until_ms INTEGER NOT NULL
);

-- Older builds treated saving metadata as proof of inference.
UPDATE connection_profile SET access_state = 'pending', fallback_eligible = 'unknown';
UPDATE fallback_policy SET enabled = 0;
UPDATE router_connection SET management_access = 'unknown', routing_owner = 'router';
UPDATE task_attempt SET status = 'interrupted', completed_at = CAST(unixepoch() * 1000 AS TEXT)
WHERE status = 'started';

PRAGMA user_version = 12;
COMMIT;
