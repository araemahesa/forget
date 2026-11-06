use crate::storage::{now_string, StorageError};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectorConfig {
    pub id: String,
    pub name: String,
    pub transport: String,
    /// Executable started over stdio: a bare name resolved on PATH (e.g. `npx`) or an absolute path.
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub is_enabled: bool,
    /// Empty means every tool the server lists.
    pub allowed_tools: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub category: String,
    pub is_write: bool,
}

fn invalid(message: &str) -> StorageError {
    StorageError::InvalidInput(message.into())
}

pub fn validate(config: &McpConnectorConfig) -> Result<(), StorageError> {
    let clean = |value: &str| !value.chars().any(char::is_control);
    if config.id.is_empty()
        || config.id.len() > 128
        || !config.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(invalid("ID konektor tidak sah."));
    }
    if config.name.trim().is_empty() || config.name.chars().count() > 100 || !clean(&config.name) {
        return Err(invalid("Nama konektor wajib diisi (maksimal 100 karakter)."));
    }
    if config.transport != "stdio" {
        return Err(invalid("Saat ini hanya transport stdio yang didukung."));
    }
    if config.command.trim().is_empty() || config.command.len() > 1024 || !clean(&config.command) {
        return Err(invalid("Perintah server MCP wajib diisi."));
    }
    if config.args.len() > 64 || config.args.iter().any(|a| a.len() > 4096 || !clean(a)) {
        return Err(invalid("Argumen server MCP tidak sah (maksimal 64)."));
    }
    if config.allowed_tools.len() > 256
        || config.allowed_tools.iter().any(|t| t.is_empty() || t.len() > 128 || !clean(t))
    {
        return Err(invalid("Daftar tool yang diizinkan tidak sah."));
    }
    Ok(())
}

pub fn list_connectors(conn: &Connection) -> Result<Vec<McpConnectorConfig>, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, transport, is_enabled, allowed_tools_json, created_at, updated_at, command, args_json FROM mcp_connector_config ORDER BY name ASC"
    )?;
    let configs = stmt
        .query_map([], |row| {
            let tools_json: String = row.get(4)?;
            let args_json: String = row.get(8)?;
            Ok(McpConnectorConfig {
                id: row.get(0)?,
                name: row.get(1)?,
                transport: row.get(2)?,
                is_enabled: row.get::<_, i64>(3)? != 0,
                allowed_tools: serde_json::from_str(&tools_json).unwrap_or_default(),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                command: row.get(7)?,
                args: serde_json::from_str(&args_json).unwrap_or_default(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(configs)
}

pub fn save_connector(conn: &Connection, config: &McpConnectorConfig) -> Result<(), StorageError> {
    validate(config)?;
    let now = now_string();
    let tools_json = serde_json::to_string(&config.allowed_tools)?;
    let args_json = serde_json::to_string(&config.args)?;
    conn.execute(
        "INSERT INTO mcp_connector_config (id, name, transport, is_enabled, allowed_tools_json, created_at, updated_at, command, args_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            transport = excluded.transport,
            is_enabled = excluded.is_enabled,
            allowed_tools_json = excluded.allowed_tools_json,
            command = excluded.command,
            args_json = excluded.args_json,
            updated_at = excluded.updated_at",
        params![
            config.id,
            config.name.trim(),
            config.transport,
            if config.is_enabled { 1 } else { 0 },
            tools_json,
            config.created_at,
            now,
            config.command.trim(),
            args_json,
        ],
    )?;
    Ok(())
}

pub fn toggle_connector(conn: &Connection, id: &str, enabled: bool) -> Result<(), StorageError> {
    if enabled {
        let command: String = conn
            .query_row("SELECT command FROM mcp_connector_config WHERE id = ?1", [id], |r| r.get(0))
            .map_err(|_| invalid("Konektor tidak ditemukan."))?;
        if command.trim().is_empty() {
            return Err(invalid("Isi perintah server sebelum mengaktifkan konektor."));
        }
    }
    conn.execute(
        "UPDATE mcp_connector_config SET is_enabled = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, if enabled { 1 } else { 0 }, now_string()],
    )?;
    Ok(())
}

pub fn delete_connector(conn: &Connection, id: &str) -> Result<(), StorageError> {
    conn.execute("DELETE FROM mcp_connector_config WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn config() -> McpConnectorConfig {
        McpConnectorConfig {
            id: "conn-1".into(),
            name: "Filesystem".into(),
            transport: "stdio".into(),
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-filesystem".into(), "/tmp".into()],
            is_enabled: true,
            allowed_tools: vec!["read_file".into()],
            created_at: now_string(),
            updated_at: now_string(),
        }
    }

    #[test]
    fn test_connectors_lifecycle() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/0007_ai_chat.sql")).unwrap();
        conn.execute_batch(include_str!("../migrations/0017_mcp_connector_launch.sql")).unwrap();

        save_connector(&conn, &config()).unwrap();
        let list = list_connectors(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].is_enabled);
        assert_eq!(list[0].command, "npx");
        assert_eq!(list[0].args.len(), 3);
        assert_eq!(list[0].allowed_tools, ["read_file"]);

        toggle_connector(&conn, "conn-1", false).unwrap();
        assert!(!list_connectors(&conn).unwrap()[0].is_enabled);

        delete_connector(&conn, "conn-1").unwrap();
        assert!(list_connectors(&conn).unwrap().is_empty());
    }

    #[test]
    fn rejects_unsupported_or_incomplete_configs() {
        for broken in [
            McpConnectorConfig { transport: "sse".into(), ..config() },
            McpConnectorConfig { command: " ".into(), ..config() },
            McpConnectorConfig { name: "".into(), ..config() },
            McpConnectorConfig { id: "../x".into(), ..config() },
            McpConnectorConfig { args: vec!["a\nb".into()], ..config() },
        ] {
            assert!(validate(&broken).is_err());
        }
    }

    #[test]
    fn legacy_rows_without_command_stay_disabled() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/0007_ai_chat.sql")).unwrap();
        conn.execute("INSERT INTO mcp_connector_config (id,name,transport,is_enabled,allowed_tools_json,created_at,updated_at) VALUES ('old','Lama','stdio',1,'[]','1','1')", []).unwrap();
        conn.execute_batch(include_str!("../migrations/0017_mcp_connector_launch.sql")).unwrap();
        assert!(!list_connectors(&conn).unwrap()[0].is_enabled);
        assert!(toggle_connector(&conn, "old", true).is_err());
    }
}
