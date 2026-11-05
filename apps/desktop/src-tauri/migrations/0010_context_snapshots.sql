BEGIN IMMEDIATE;
CREATE TABLE context_snapshot (
    id TEXT PRIMARY KEY,
    document_json TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
);
PRAGMA user_version = 9;
COMMIT;
