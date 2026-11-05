BEGIN IMMEDIATE;
CREATE TABLE chat_turn (
    request_id TEXT PRIMARY KEY REFERENCES creative_task(id),
    thread_id TEXT NOT NULL REFERENCES chat_thread(id) ON DELETE CASCADE,
    user_message_id TEXT NOT NULL REFERENCES chat_message(id),
    assistant_message_id TEXT REFERENCES chat_message(id)
);
CREATE INDEX chat_turn_thread ON chat_turn(thread_id);
PRAGMA user_version = 8;
COMMIT;
