BEGIN IMMEDIATE;
CREATE TABLE editor_draft (
    item_id TEXT PRIMARY KEY NOT NULL REFERENCES collection_item(id),
    revision INTEGER NOT NULL CHECK(revision > 0),
    spec_json TEXT NOT NULL,
    baseline_version_id TEXT REFERENCES gfx_version(id),
    updated_at TEXT NOT NULL
);
PRAGMA user_version = 2;
COMMIT;
