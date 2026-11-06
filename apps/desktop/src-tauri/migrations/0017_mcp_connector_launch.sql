-- MCP connectors gain a real launch command so chat can start the server over stdio.
BEGIN IMMEDIATE;
ALTER TABLE mcp_connector_config ADD COLUMN command TEXT NOT NULL DEFAULT '';
ALTER TABLE mcp_connector_config ADD COLUMN args_json TEXT NOT NULL DEFAULT '[]';
-- Earlier rows had no command and could never connect; keep them but leave them off.
UPDATE mcp_connector_config SET is_enabled=0 WHERE command='';
PRAGMA user_version=16;
COMMIT;
