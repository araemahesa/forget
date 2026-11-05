-- Schema 14 shipped in two builds; reconcile their provider-only invariants once.
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS ai_checkpoint (
 task_id TEXT PRIMARY KEY REFERENCES creative_task(id) ON DELETE CASCADE,
 checkpoint_json TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
UPDATE connection_profile SET enabled=0,is_default=0,fallback_eligible='unsupported',fallback_disabled_reason='Inferensi lokal dihentikan; pilih akun provider.' WHERE provider_id='local-llm' OR auth_method='local_runtime';
UPDATE ai_provider_profile SET is_default=0 WHERE provider_type='local-llm';
UPDATE fallback_policy SET enabled=0;
PRAGMA user_version=15;
COMMIT;
