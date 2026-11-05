BEGIN IMMEDIATE;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE creative_version_new (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE REFERENCES creative_task(id),
    kind TEXT NOT NULL CHECK (kind IN (
        'model3d', 'animation', 'vfx', 'interface', 'npc',
        'cutscene', 'material', 'music', 'sky'
    )),
    parent_version_id TEXT REFERENCES creative_version_new(id),
    document_json TEXT NOT NULL,
    engine_version INTEGER NOT NULL,
    artifact_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
INSERT INTO creative_version_new SELECT * FROM creative_version;

CREATE TABLE creative_export_new (
    relative_path TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES creative_version_new(id),
    sha256 TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    format TEXT NOT NULL,
    created_at TEXT NOT NULL
);
INSERT INTO creative_export_new SELECT * FROM creative_export;
DROP TABLE creative_export;
DROP TABLE creative_version;
ALTER TABLE creative_version_new RENAME TO creative_version;
ALTER TABLE creative_export_new RENAME TO creative_export;

PRAGMA user_version = 13;
COMMIT;
