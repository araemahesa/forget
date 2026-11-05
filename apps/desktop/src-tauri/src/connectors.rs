use crate::storage::{now_string, StorageError};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectorConfig {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub is_enabled: bool,
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

pub fn get_available_mcp_tools() -> Vec<McpToolInfo> {
    vec![
        McpToolInfo {
            name: "get_studio_state".into(),
            description: "Membaca status koneksi, place ID, dan target Roblox Studio".into(),
            category: "studio".into(),
            is_write: false,
        },
        McpToolInfo {
            name: "search_game_tree".into(),
            description: "Mencari instance dalam DataModel Roblox Studio".into(),
            category: "studio".into(),
            is_write: false,
        },
        McpToolInfo {
            name: "read_workspace_artifact".into(),
            description: "Membaca konten file artefak yang tersimpan di workspace".into(),
            category: "workspace".into(),
            is_write: false,
        },
        McpToolInfo {
            name: "generate_sfx_recipe".into(),
            description: "Menghasilkan parameter efek suara prosedural".into(),
            category: "generators".into(),
            is_write: false,
        },
        McpToolInfo {
            name: "mutate_studio_instance".into(),
            description: "Menyisipkan atau mengubah instance di Roblox Studio (butuh konfirmasi)"
                .into(),
            category: "studio".into(),
            is_write: true,
        },
    ]
}

pub fn list_connectors(conn: &Connection) -> Result<Vec<McpConnectorConfig>, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, transport, is_enabled, allowed_tools_json, created_at, updated_at FROM mcp_connector_config ORDER BY name ASC"
    )?;
    let configs = stmt
        .query_map([], |row| {
            let tools_json: String = row.get(4)?;
            let allowed_tools: Vec<String> = serde_json::from_str(&tools_json).unwrap_or_default();
            Ok(McpConnectorConfig {
                id: row.get(0)?,
                name: row.get(1)?,
                transport: row.get(2)?,
                is_enabled: row.get::<_, i64>(3)? != 0,
                allowed_tools,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(configs)
}

pub fn save_connector(conn: &Connection, config: &McpConnectorConfig) -> Result<(), StorageError> {
    let now = now_string();
    let tools_json = serde_json::to_string(&config.allowed_tools).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO mcp_connector_config (id, name, transport, is_enabled, allowed_tools_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            transport = excluded.transport,
            is_enabled = excluded.is_enabled,
            allowed_tools_json = excluded.allowed_tools_json,
            updated_at = excluded.updated_at",
        params![
            config.id,
            config.name,
            config.transport,
            if config.is_enabled { 1 } else { 0 },
            tools_json,
            config.created_at,
            now
        ],
    )?;
    Ok(())
}

pub fn toggle_connector(conn: &Connection, id: &str, enabled: bool) -> Result<(), StorageError> {
    conn.execute(
        "UPDATE mcp_connector_config SET is_enabled = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, if enabled { 1 } else { 0 }, now_string()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn test_connectors_lifecycle() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../migrations/0007_ai_chat.sql"))
            .unwrap();

        let cfg = McpConnectorConfig {
            id: "conn-1".into(),
            name: "Local Studio Bridge".into(),
            transport: "stdio".into(),
            is_enabled: true,
            allowed_tools: vec!["get_studio_state".into(), "search_game_tree".into()],
            created_at: now_string(),
            updated_at: now_string(),
        };

        save_connector(&conn, &cfg).unwrap();
        let list = list_connectors(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].is_enabled);
        assert_eq!(list[0].allowed_tools.len(), 2);

        toggle_connector(&conn, "conn-1", false).unwrap();
        let list2 = list_connectors(&conn).unwrap();
        assert!(!list2[0].is_enabled);

        let tools = get_available_mcp_tools();
        assert!(tools.len() >= 3);
        assert!(tools.iter().any(|t| t.name == "get_studio_state"));
    }
}
