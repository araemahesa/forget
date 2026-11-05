BEGIN IMMEDIATE;
CREATE TABLE image_version (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('icon', 'texture', 'clothing')),
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    spec_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(kind, sequence)
);
CREATE TABLE image_artifact (
    version_id TEXT NOT NULL REFERENCES image_version(id),
    name TEXT NOT NULL,
    format TEXT NOT NULL CHECK(format IN ('svg', 'png')),
    relative_path TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    byte_length INTEGER NOT NULL CHECK(byte_length > 0),
    PRIMARY KEY(version_id, name, format)
);
PRAGMA user_version = 4;
COMMIT;
