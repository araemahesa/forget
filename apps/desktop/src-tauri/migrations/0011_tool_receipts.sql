BEGIN IMMEDIATE;
CREATE TABLE tool_receipt (
    task_id TEXT NOT NULL REFERENCES creative_task(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    call_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    PRIMARY KEY (task_id, call_id),
    UNIQUE (task_id, sequence)
);
PRAGMA user_version = 10;
COMMIT;
