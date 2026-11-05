# Roblox Studio integration status

> Update 28 Oktober 2026: alur baru memakai mode otomatis dan discovery Studio berkala. Lihat [Automatic Agent Workflow](AUTOMATIC_AGENT_WORKFLOW.md) untuk implementasi, hasil tes dan batas saat ini. Isi checkpoint di bawah tetap sebagai riwayat.


Settings and the Chat context panel implement bounded, read-only Studio MCP inspection. Each read opens a short-lived stdio session. The top bar reports the latest observation rather than claiming a persistent connection.

## Working boundary

- Detect `/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP` or the equivalent under the user's `Applications`.
- Verify Apple-anchored code signature, `StudioMCP` identifier and Roblox's installed Team ID `2CFABCH843` before launch. A changed signing identity needs an explicit adapter update.
- Launch with structured subprocess arguments, minimal environment and no inherited provider credentials. No shell plugin or arbitrary executable input is granted.
- Negotiate MCP `2025-06-18`; accept compatible `2025-03-26` / `2024-11-05` responses. Send `notifications/initialized`, discover tools and call documented `list_roblox_studios`.
- Limit session to 20 seconds, individual JSON-RPC messages to 1 MiB, tool discovery to 8 pages / 256 tools, instance list to 64. Correlate response IDs, respond to ping, reject unadvertised client capabilities, cancel on timeout, close/reap child process on completion and application exit.
- Show checked timestamp, executable, negotiated protocol and instance list. Successful handshake with an empty instance list is a separate state, never labelled `Connected`.
- Require an explicitly selected instance for `get_studio_state` or `search_game_tree`. Rediscover/revalidate target before each read. Buttons require discovered tool names; unknown required schema fields produce an adapter-update error. Tree reads require a discovered path and depth parameter; UI accepts an explicit subtree and depth 1-4.
- Normalize recognized JSON hierarchy into at most 300 name/class/children nodes and 48 KiB. Script source, attributes and properties stay out of Chat context. Unsupported free text is rejected. Common credential patterns in labels are redacted; this does not guarantee removal of all sensitive information.
- Store immutable snapshots with a document hash. Chat sends only the snapshot ID after opt-in; native verifies storage integrity and a two-minute age limit before sending hierarchy to the selected provider. Changing target or probing again clears the selected snapshot. These checks do not establish strong session identity or detect all map edits.
- Render the normalized hierarchy in the Explorer panel. Raw inspection output remains escaped and display-limited to 64 KiB. No script execution, place write or cloud call is exposed. Chat offers map.search/map.inspect tools over the saved opt-in snapshot, not additional live Studio reads.

## Evidence and limits

`cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --example studio_probe` exercises the installed signed executable. The 27 October 2026 probe negotiates `2025-06-18` with RobloxStudio and returns no available instances or read tools. See the latest `test-evidence/2026-10-27/connections/studio-discovery.json`; the earlier chat-refactor report remains historical. The older probe remains historical evidence only.

Native tests cover framing limits, invalid/mutation-tool rejection, tool-error parsing, actual subprocess pipes with a labelled test server, ping, wrong response ID, timeout and child cleanup. Snapshot tests cover bounds, field exclusion, redaction, integrity and expiry. UI tests cover explicit selection, scope/depth, snapshot revocation, Chat opt-in and overlapping checks. Fixture responses prove adapter behavior, not a live place read.

Actual place state/tree reads remain unverified because no Studio instance was available. Persistent liveness, script reads, task receipts, configurable installation paths, user cancellation, live target read and a small authorized write with ChangeHistoryService undo remain pending. This checkpoint does not pass the full Studio integration gate.

Plugin Luau and custom relay remain deferred until official MCP capability gaps are measured. No loopback server, public bind, remote pairing or generated Luau runtime is currently shipped.

## Primary references checked 2026-10-26

- [Roblox Studio MCP](https://create.roblox.com/docs/studio/mcp): executable, explicit `studio_id`, session discovery and read tool names.
- [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports): newline-delimited UTF-8 JSON-RPC.
- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle): initialization, capabilities, timeout and transport shutdown.
