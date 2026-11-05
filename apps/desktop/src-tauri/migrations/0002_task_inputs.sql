BEGIN IMMEDIATE;
CREATE TABLE task_input (id TEXT PRIMARY KEY NOT NULL, spec_json TEXT NOT NULL);
INSERT INTO task_input SELECT id, spec_json FROM gfx_version;
ALTER TABLE task RENAME TO task_legacy;
CREATE TABLE task (
    id TEXT PRIMARY KEY NOT NULL,
    input_version_id TEXT NOT NULL REFERENCES task_input(id),
    output_version_id TEXT REFERENCES gfx_version(id),
    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','interrupted')),
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT INTO task SELECT * FROM task_legacy;
DROP TABLE task_legacy;
CREATE UNIQUE INDEX artifact_version_kind ON artifact(version_id, kind);
PRAGMA user_version = 1;
COMMIT;
