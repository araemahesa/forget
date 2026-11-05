BEGIN IMMEDIATE;
CREATE TABLE sfx_version (
    id TEXT PRIMARY KEY NOT NULL,
    sequence INTEGER NOT NULL UNIQUE CHECK(sequence > 0),
    recipe_json TEXT NOT NULL,
    wav BLOB NOT NULL CHECK(length(wav) BETWEEN 4454 AND 264644),
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
);
PRAGMA user_version = 3;
COMMIT;
