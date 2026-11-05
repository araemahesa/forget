"""Migrate a consistent read-only snapshot, never the active user's database."""
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "apps/desktop/src-tauri"
TARGET_SCHEMA = 15
SOURCE = Path.home() / "Library/Application Support/dev.forgekit.studio/forgekit.sqlite"
DESTINATION = NATIVE / "target/migration-copies" / str(time.time_ns()) / "forgekit.sqlite"
DESTINATION.parent.mkdir(parents=True)
with sqlite3.connect(SOURCE.as_uri() + "?mode=ro", uri=True) as source:
    with sqlite3.connect(DESTINATION) as copy:
        source.backup(copy)

def preserved_rows(connection):
    names = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    values = {}
    for name in names:
        if name in {"task", "work_task", "work_event", "creative_task", "creative_event", "task_attempt"}:
            continue
        quoted = '"' + name.replace('"', '""') + '"'
        changed_columns = {
            "connection_profile": {"access_state", "fallback_eligible"},
            "fallback_policy": {"enabled"},
            "router_connection": {"management_access", "routing_owner"},
        }.get(name, set())
        columns = [row[1] for row in connection.execute(f"PRAGMA table_info({quoted})") if row[1] not in changed_columns]
        selection = ",".join('"' + column.replace('"', '""') + '"' for column in columns)
        rows = connection.execute(f"SELECT {selection} FROM {quoted} ORDER BY rowid").fetchall()
        payload = json.dumps(rows, default=lambda value: value.hex(), separators=(",", ":")).encode()
        values[name] = {"rows": len(rows), "sha256": hashlib.sha256(payload).hexdigest()}
    return values

with sqlite3.connect(DESTINATION) as copy:
    original_version = copy.execute("PRAGMA user_version").fetchone()[0]
    before = preserved_rows(copy)
assert 1 <= original_version <= TARGET_SCHEMA, "Workspace schema is newer than this verifier"
subprocess.run([
    "cargo", "run", "--release", "--quiet", "--manifest-path", str(NATIVE / "Cargo.toml"),
    "--example", "migrate_copy", "--", str(DESTINATION),
], check=True)
with sqlite3.connect(DESTINATION) as copy:
    assert copy.execute("PRAGMA user_version").fetchone()[0] == TARGET_SCHEMA
    assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not copy.execute("PRAGMA foreign_key_check").fetchall()
    after = preserved_rows(copy)
    assert all(after.get(name) == value for name, value in before.items()), "Existing records changed"
snapshots = list(DESTINATION.parent.glob(f"forgekit-before-schema-{TARGET_SCHEMA}-*.sqlite"))
assert len(snapshots) == (1 if original_version < TARGET_SCHEMA else 0)
if snapshots:
    with sqlite3.connect(snapshots[0]) as snapshot:
        assert snapshot.execute("PRAGMA user_version").fetchone()[0] == original_version
        assert preserved_rows(snapshot) == before
report = {
    "ok": True, "sourceAccess": "SQLite read-only backup; migration only on isolated target copy",
    "fromSchema": original_version, "toSchema": TARGET_SCHEMA,
    "preservedTables": before, "preMigrationSnapshotVerified": bool(snapshots),
    "taskReconciliation": "Active task/attempt status and unverified connection metadata may be reset; excluded from immutable hashes",
}
output = ROOT / "docs/test-evidence/2026-10-31/recovery-build/workspace-migration.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2))
print(f"PASS schema {original_version} to {TARGET_SCHEMA}; {len(before)} existing tables preserved")
