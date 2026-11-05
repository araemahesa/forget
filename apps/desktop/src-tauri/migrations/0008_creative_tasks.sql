BEGIN TRANSACTION;
CREATE TABLE creative_task (
    id TEXT PRIMARY KEY,
    request_json TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    version_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE creative_event (
    task_id TEXT NOT NULL REFERENCES creative_task(id),
    sequence INTEGER NOT NULL,
    stage TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, sequence)
);
CREATE TABLE creative_version (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE REFERENCES creative_task(id),
    kind TEXT NOT NULL CHECK (kind IN ('model3d', 'animation')),
    parent_version_id TEXT REFERENCES creative_version(id),
    document_json TEXT NOT NULL,
    engine_version INTEGER NOT NULL,
    artifact_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE creative_export (
    relative_path TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES creative_version(id),
    sha256 TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    format TEXT NOT NULL,
    created_at TEXT NOT NULL
);
PRAGMA user_version = 7;
COMMIT;
