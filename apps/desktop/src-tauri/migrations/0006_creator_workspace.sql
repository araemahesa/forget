BEGIN IMMEDIATE;
CREATE TABLE creator_draft (
    kind TEXT PRIMARY KEY CHECK(kind IN ('icon', 'texture', 'clothing', 'sfx')),
    spec_json TEXT NOT NULL,
    baseline_version_id TEXT,
    engine_version INTEGER NOT NULL CHECK(engine_version > 0),
    revision INTEGER NOT NULL CHECK(revision > 0),
    updated_at TEXT NOT NULL
);
CREATE TABLE work_task (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('icon', 'texture', 'clothing', 'sfx')),
    action TEXT NOT NULL CHECK(action IN ('render', 'save', 'export', 'open')),
    input_json TEXT NOT NULL,
    engine_version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'cancel_requested', 'cancelled', 'failed', 'succeeded', 'interrupted')),
    stage TEXT NOT NULL,
    receipt_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE work_event (
    task_id TEXT NOT NULL REFERENCES work_task(id),
    sequence INTEGER NOT NULL,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    receipt_json TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(task_id, sequence)
);
CREATE TABLE library_visibility (
    kind TEXT NOT NULL CHECK(kind IN ('gfx', 'icon', 'texture', 'clothing', 'sfx')),
    version_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    PRIMARY KEY(kind, version_id)
);
ALTER TABLE image_version ADD COLUMN engine_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sfx_version ADD COLUMN engine_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gfx_version ADD COLUMN engine_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX work_task_updated ON work_task(updated_at);
PRAGMA user_version = 5;
COMMIT;
