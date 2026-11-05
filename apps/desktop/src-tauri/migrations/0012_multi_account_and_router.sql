BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS connection_profile (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    connection_mode TEXT NOT NULL DEFAULT 'direct',
    credential_owner TEXT NOT NULL DEFAULT 'forgekit',
    router_instance_id TEXT,
    upstream_connection_ref TEXT,
    auth_method TEXT NOT NULL DEFAULT 'api_key',
    label TEXT NOT NULL,
    identity_json TEXT,
    registration_ref TEXT,
    credential_ref TEXT,
    access_state TEXT NOT NULL DEFAULT 'pending',
    enabled INTEGER NOT NULL DEFAULT 1,
    fallback_eligible TEXT NOT NULL DEFAULT 'unknown',
    fallback_disabled_reason TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    quota_bucket_refs_json TEXT NOT NULL DEFAULT '[]',
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS router_connection (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT '9router',
    base_url TEXT NOT NULL,
    dashboard_url TEXT,
    inference_credential_ref TEXT NOT NULL,
    management_credential_ref TEXT,
    detected_version TEXT,
    management_access TEXT NOT NULL DEFAULT 'unknown',
    routing_owner TEXT NOT NULL DEFAULT 'router',
    last_verified_at TEXT
);

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

CREATE TABLE IF NOT EXISTS task_attempt (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    provider_request_id TEXT,
    provider_job_id TEXT,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_attempt_task ON task_attempt(task_id);

INSERT OR IGNORE INTO connection_profile (
    id, provider_id, connection_mode, credential_owner, auth_method, label,
    credential_ref, access_state, enabled, fallback_eligible, priority,
    quota_bucket_refs_json, base_url, model, is_default, created_at, updated_at
)
SELECT
    id,
    provider_type,
    'direct',
    'forgekit',
    'api_key',
    name,
    key_reference,
    'pending',
    1,
    'unknown',
    0,
    json_array('unverified:' || provider_type),
    base_url,
    model,
    is_default,
    created_at,
    updated_at
FROM ai_provider_profile
WHERE id NOT IN (SELECT id FROM connection_profile);

PRAGMA user_version = 11;
COMMIT;
