//! Lists the tools a real MCP stdio server exposes through ForgeKit's connector client.
//! Usage: cargo run --example mcp_probe -- <command> [args...]
use forgekit_desktop_lib::connectors::McpConnectorConfig;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut argv = std::env::args().skip(1);
    let command = argv.next().ok_or("Expected an MCP server command")?;
    let config = McpConnectorConfig {
        id: "probe".into(),
        name: "Probe".into(),
        transport: "stdio".into(),
        command,
        args: argv.collect(),
        is_enabled: true,
        allowed_tools: vec![],
        created_at: "0".into(),
        updated_at: "0".into(),
    };
    forgekit_desktop_lib::connectors::validate(&config)?;
    let tools = forgekit_desktop_lib::mcp::discover(&config)?;
    for tool in &tools {
        println!("{} [{}]", tool.name, if tool.is_write { "tulis" } else { "baca" });
    }
    println!("PASS {} tools", tools.len());
    Ok(())
}
