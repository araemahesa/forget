PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspace (
    id TEXT PRIMARY KEY NOT NULL,
    root_path TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_item (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspace(id),
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gfx_version (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL REFERENCES collection_item(id),
    sequence INTEGER NOT NULL,
    spec_json TEXT NOT NULL,
    checks_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(item_id, sequence)
);

CREATE TABLE IF NOT EXISTS artifact (
    id TEXT PRIMARY KEY NOT NULL,
    version_id TEXT NOT NULL REFERENCES gfx_version(id),
    kind TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task (
    id TEXT PRIMARY KEY NOT NULL,
    input_version_id TEXT NOT NULL REFERENCES gfx_version(id),
    output_version_id TEXT REFERENCES gfx_version(id),
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
