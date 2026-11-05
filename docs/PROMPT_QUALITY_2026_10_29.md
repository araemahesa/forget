# Release 0.1.4 — 29 October 2026

Status: final 0.1.4 bundle installed at `/Applications/ForgeKit Studio.app`. Bundle verification passed arm64 architecture, signatures, DMG CRC, mounted executable equality and exclusion of acceptance harness markers. Installation preserved database files and the hashes/counts of all ten protected account/chat/artifact tables; integrity_check returned ok. Live Apply acceptance is recorded below. Existing Git changes, credentials, chats and works are preserved.

## Implemented in this continuation

- Six **Terapkan ke Studio** actions now execute: model3d, VFX, interface, NPC/dialogue, animation and cutscene. They attach an immutable saved version ID to the shared Chat executor. Native code reopens the saved artifact, verifies integrity/schema and pins its ID, domain skills and frozen provider/model/effort in the durable task. Unsaved changes, missing map or provider block dispatch with a concrete explanation.
- Application uses the same locked Studio/Edit epoch, inspected selection/parent, scope, timeout, receipts and cancellation/recovery as Chat. A version-specific attribute identifies installed roots. Application recovery reuses the original thread/task and loads only its committed final message; it does not replay a write. Results link back to the same Chat thread.
- Shared progress has one caller-owned card during execution and recovery. Technical account/provider/event details remain collapsed. No second progress card is nested inside recovery controls.
- Responses adapters use committed answer messages and exclude `commentary` messages from final answers/recipes. A live CSG failure exposed the previous concatenation; a protocol regression test covers phased and unphased final messages and rejects commentary-only terminal output.
- Uncertain writes allow subsequent read-only inspection within the existing budget. Further writes stay blocked, including later writes in the same batch. Restart reconstructs receipts without replay. A regression test proves an actual following read executes while write count stays one.
- Queued task operations now outwait the bounded background Studio session plus cleanup, instead of expiring after ten seconds while a twenty-second read still holds the session. The existing priority/retry test protects that budget relationship. Target detection continues between task calls.
- Native Luau verification now permits Chat streaming → validating → streaming, including recovery. A shared callback restores streaming even when the checker fails, so subsequent provider/tool steps remain valid. The journal test covers repeated checks.
- A page-level error boundary catches failed lazy module imports. It keeps navigation available and offers **Muat ulang aplikasi** instead of a blank workspace. Reload restores durable task recovery; it does not resend the task. Native minimum window size is 720×450.

## Verification

Latest requested commands passed: `pnpm typecheck`, `pnpm test --run`, `pnpm build`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`. **53 contract + 263 desktop + 122 Rust = 438 tests**, one opt-in live test ignored by default. [Logs and evidence](test-evidence/2026-10-29/prompt-quality/0.1.4/).

Earlier native live generator/editor acceptance remains **14/14** durable schema-validated provider artifacts. Browser preview replay uses those actual recipes with fixture transport: 45 preview/viewport and 180 appearance checks. Shared Explorer/layout fixtures cover 80 route/viewport and 320 appearance checks. These are separate from live map/provider evidence.

Live saved-artifact application independently confirmed the VFX root, source version attribute, parent and emitter values in the isolated acceptance map. An initial model application encountered a real CSG error and was correctly recorded as **not installed/unverified**, rather than success. A later explicitly corrected plan produced 87 native parts for the 25 recipe entries, including bounded WedgePart cone approximations. Independent read-back confirmed its version, parent, all 87 anchored parts and overall bounds, retaining the 455-child fixture and original entrance. GUI installation independently matched its version/root; a live Studio capture recorded the actual ten-element layout. Four installed GUI/cutscene/animation scripts passed independent StyLua syntax and Selene checks with zero errors/warnings. These static checks do not prove runtime behavior. Its failure led to the protocol/read-back fixes above. Completed tool receipts alone are explicitly not counted as proof of installation. The 455-child fixture, prior 26-part gate and other user data are retained.

## Final live/native follow-up

All six Apply domains have independently read-back roots in the isolated Studio map: model3d, VFX, interface, NPC, animation and cutscene. Completed earlier applications were reused by task ID, not resent. The NPC recipe exactly matches all four nodes/four choices and the requested marker position (12, 1, 0). Animation matrix comparison matches all 24 poses, with maximum keyframe time error 4.77e-8 seconds.

In Play, the actual AnimationConstraint changed during playback and restored its initial transform exactly. The cutscene entered Scriptable camera mode, changed FOV and restored Custom/70° after completion. A real native click on the inventory close button disabled the GUI. NPC ProximityPrompt opened the live GUI; valid choices reached the correct terminal node, invalid index preserved the node, distance and respawn closed the panel, and respawn retained one GUI/panel. Runtime captures show actual inventory and NPC layouts. Studio returned to Edit. The console had no game script error; Studio Assistant did report its own camera reset at an execute_luau boundary, which limits the separate respawn camera inference.

The final callback was exercised through a live read-only Chat task: script_read → forgekit_luau_check → final response, with StyLua/Selene exit 0 and zero diagnostics. NPC installation also ran both checks successfully. Native release 0.1.4 connection testing succeeded (3982 ms), eight account models became enabled, and official 5h/weekly remaining/reset information rendered. Only the connected ChatGPT account was checked live. All ten protected table hashes/counts remained unchanged after native launch/testing.

A final installed-app restart retained the enabled model catalog and automatically displayed Explorer on the verified map. Its first read encountered the real Studio session lock; the explicit **Muat ulang Explorer** action recovered 100/118 root nodes. This verifies manual recovery, not automatic retry under every contention scenario. No task was submitted during restart checks. All ten protected table hashes/counts still matched afterward.

Empty-state and editor captions now describe the actual selected-provider pipeline, removing obsolete claims of a local planner/refine path. Engine rendering/synthesis remains explicitly described as local.

## Integration matrix additions

| UI entry points | IPC / execution | Skills, validation and output |
|---|---|---|
| Model3dPage, VfxPage, GuiPage, NpcDialoguePage, AnimationPage, CutscenePage / StudioApply | `create_chat_thread` → `send_chat_message(creativeVersionId)` → pinned shared supervisor → available scoped Studio tools | saved artifact integrity/schema → domain guides + context → Edit preflight → receipts/read-back → committed final result; resume same task |
| All visited page modules | PageBoundary around Suspense | Failed module import stays inside its page; explicit reload preserves durable journal |

Generation/refine/variation and five prompt editors retain the fifteen-path matrix in [provider pipeline](PROVIDER_ONLY_PIPELINE.md). Music, material/texture, sky and image outputs keep real render/export paths. Roblox upload/publish that needs approved asset IDs is not claimed as automatic application. The UI supplies export/import instructions instead of a false success action.

## Remaining acceptance limits

Full original acceptance is not complete. Independent runtime/visual/audio/rig quality for every generated domain, comprehensive native zoom/accessibility, multiple real map/reconnect scenarios and representative runtime performance are not all proven. Text providers produce validated procedural recipes; unsupported neural media generation is not claimed. StyLua/Selene are actual scoped local tools, not a full Luau type analyzer, and are not bundled for a clean machine. Explorer search is bounded and reports partial scope; selection sync depends on the adapter. Signing remains ad-hoc, not notarized.

---

The following 0.1.3 and older sections are historical. Current implementation/verification above supersedes their statements about disabled Apply actions and test totals.

# Current installed status — 29 October 2026, release 0.1.3

The final 0.1.3 app is installed at `/Applications/ForgeKit Studio.app`. Installation verified matching release binary, ad-hoc signature, database integrity and unchanged protected account/chat/artifact table hashes/counts. Previous app copies are recoverable from Trash. Existing dirty Git and user data were retained.

## New implementation

- Shared typed `progress/candidate/final/needs_action/error` IPC with monotonic committed revisions. Only durable completed output becomes final; no provider chunks/tool JSON enter chat. Diagnostic receipts remain separate.
- Chat, creative and editor tasks restore the same task ID without resending; editor recovery preserves manually changed parent documents. Real checkpoint phases drive one shared progress card.
- Permanent writes lock Studio and map epoch, preflight actual Edit mode, reject Client/Server before dispatch and verify map identity before explicit Play-to-Edit recovery. Uncertain writes cannot blindly replay.
- VFX supports validated fade keypoints and parameter-driven bounded animation preview. GUI supports validated parent graphs, anchor points and nested UDim2 preview. Skills include corresponding JSON contracts and runtime inspection guidance.
- Keychain access is serialized. Background reads fail with a recoverable locked state; explicit Settings **Uji koneksi** authorizes access through macOS. OS permission failure does not falsely mark provider authentication expired. Model errors provide a Settings recovery link.
- Generator Apply captions now explain actual export/import or Chat paths. Unsupported upload/apply remains explicitly disabled.

## Verified evidence

`pnpm typecheck`, `pnpm test --run`, frontend/release build and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passed: **53 contract + 258 desktop + 119 native = 430 tests**; one live test is ignored by default and run separately. Bundle verification passed architecture/signature/DMG CRC/mounted executable equality and absence of acceptance harness markers.

- Native live provider: **14/14** creative/editor paths produced durable schema-validated artifacts with frozen provider/model; isolated acceptance database only. This establishes executor/artifact integration, not independent visual/audio quality for every output.
- Live Explorer: 455-child fixture, pagination beyond 300, depth beyond four, empty folder, duplicate and dotted names, unopened deep search, Properties and stale epoch rejection checked against Studio.
- Live Chat: provider built a 26-part anchored fantasy gate from actual 12×16×2 entrance context. Read-back retained all 455 fixture children. Wind initially failed runtime bootstrap; same-provider repair fixed it. Independent Play inspection observed movement, transparency 0.40–0.996, 20 lines, one folder after respawn, cleanup after runtime script destruction and empty console. Returned isolated map to Edit; source retained.
- Layout fixtures: 80 route/viewport and 320 theme/density overflow checks passed across 1920×1080, 1440×900, 1280×800, 1024×700 and 720×450. Native screenshots and live evidence are separate.

Additional provider recipe replay: 45 preview/viewport and 180 appearance checks passed using actual saved provider recipes with synthetic transport/Explorer. [Rendered preview report](screenshots/generated-previews/report.json); GUI/VFX images inspected separately.

[0.1.3 evidence](test-evidence/2026-10-29/prompt-quality/0.1.3/).

Installed native **Uji koneksi** succeeded (4467 ms); model catalog became enabled and official account usage displayed 5h/weekly remaining plus reset times. This check uses the retained account; no credential was exported.

## Remaining limits

Full original acceptance is **not complete**. Direct generator asset upload/apply and all domains’ independent render/audio/rig quality acceptance are not implemented/proven. Luau checks cover syntax/lint, not full type analysis; local Rokit binaries are not bundled. Explorer selection sync requires adapter support; search is bounded and reports partial scope. Comprehensive native zoom/accessibility, multiple real maps/reconnect and representative runtime performance remain unverified. Build is ad-hoc signed, not notarized; macOS may require explicit Keychain approval after an update. No silent provider fallback or neural media capability is claimed.

---

Historical 0.1.2 report below; current status above supersedes its open acceptance statements.

# Prompt quality work — 29 October 2026

Status: implementation in progress; the full acceptance request is not complete. Existing Git changes and user data were retained. No production map write or account modification was performed. Release 0.1.2 is installed at /Applications/ForgeKit Studio.app and has been launched. Installation checked identical database files and hashes/counts of all protected account/chat/artifact tables; integrity_check returned ok. The previous app bundle is recoverable from Trash. User data is retained.

## Implemented

- Chat buffers provisional provider chunks (bounded to 64 KiB) without rendering them as answers. Only persisted user/assistant messages enter the conversation; tool-role messages and receipt metadata are excluded. Snapshot receipts remain available behind a diagnostic disclosure.
- The shared TaskAttempts component, already reused by prompt flows, displays one compact stage from persisted backend events. It maps preparation, context, generation, validation, repair and save stages; unknown/unavailable stages remain explicitly unknown. No elapsed-time-based stage simulation or percentages were introduced. Existing task recovery is retained.
- Permanent-write schemas hide both target and datamodel from the model. Backend injects the locked target/Edit and rejects supplied Client/Server or malformed datamodel values before dispatch.
- Write dispatch now checks the actual get_studio_state response first. Non-Edit states return NEEDS_EDIT/TOOL_NOT_DISPATCHED with an instruction to stop Play, without stopping it automatically. Unknown state fails closed. The current parser supports the MCP text format; an unrecognized response does not authorize write.
- Context-tree reads fill the current MCP schema’s required Edit datamodel and bounded head_limit. Context snapshots remain partial and separate from the incremental Explorer index described below.
- Bundled skills are selected from prompt intent across domains, including VFX/audio/animation in Chat. The same selection is stored with versions and source hashes in task snapshots. No model-supplied packages or unrestricted tools were installed.
- Cancellation before tool dispatch is marked TOOL_NOT_DISPATCHED so it does not imply an uncertain write.

## Verification

Typecheck passed. Frontend suites: 51 contract and 251 desktop tests passed. Frontend build passed with the existing geometry chunk-size warning. Final native suite: 115 tests passed. Total: 417 tests. Logs and verification.json are stored beside this report. Regression checks cover hidden provisional text/tool-role content, diagnostic disclosure, unknown-stage behavior, forbidden datamodel inputs, verified Edit preflight, and cross-domain skill hashes.

[Evidence directory](test-evidence/2026-10-29/prompt-quality/) contains final test/build/bundle logs. [Explorer visual evidence](screenshots/shared-explorer/report.json) covers 80 route/viewport fixtures across five sizes and 320 theme/density overflow checks. These are deterministic browser IPC fixtures, not live provider/map evidence. There is no before screenshot for this work.

## Additional implementation in release 0.1.2

- Shared Explorer is mounted once in the application layout, across Chat and every creative route. It opens for a verified place, uses bounded subtree pages, stable object IDs and name segments, virtual rows, search across unopened branches, live read-only Properties, and preserves selection/expansion across routes. Desktop resize is bounded 280–360px; narrow layouts use a drawer with backdrop, focus trapping and Escape recovery. Loading, empty, error and partial search states are distinct.
- Root/branch refresh uses bounded polling, focus and task-settled events, deduplicated requests and stale target/epoch guards. Refresh retains loaded pages, rotates expanded branches/pages and invalidates changed child counts. Search explicitly reports its 10,000-object scan limit. No label claims the entire map has been loaded.
- Studio discovery now verifies an open place through get_studio_state and continues target detection during tasks without retargeting a running task. Real MCP discovery returned name:null for an unopened place; deserialization now accepts it and the UI requires a verified place before showing Explorer.
- Explicit “Hentikan Play dan lanjutkan” recovery checks the saved task, budget, dispatch receipts and target before stopping Play. It reads state again before resuming the same checkpoint. Unknown/dispatched write outcomes cannot use this path; completed writes are not replayed.
- The scoped forgekit_luau_check tool performs real StyLua syntax/AST checking and Selene linting with a checked-in Roblox standard library. It accepts source only, never executes source, uses a private temporary directory, fixed arguments, bounded output and a five-second process timeout. It is offered only when the already installed Rokit binaries exist. Results explicitly identify static-only coverage. It is wired into Chat and resumed tasks, with hashed cross-domain skill guidance.
- Version 0.1.2 is used consistently by frontend, Cargo and Tauri. Bundle verification checks executable architecture, signatures, DMG CRC, mounted binary equality and absence of test harness markers. The signature is ad-hoc; notarization and clean-machine installation are not claimed.

## Acceptance still open

1. Live Studio map acceptance: the connected Studio currently reports “Place is not open”. Large/deep maps, duplicate names, search/Properties, map changes and Play/Edit need live checks. No fantasy gate or wind runtime output was produced by this work.
2. Full structured IPC candidate/final/needs_action union across adapters, complete restart/cancel/retry/outcome-unknown acceptance and a task-level game epoch guard beyond the existing Studio ID lock remain to be completed. Explorer has its own epoch protection.
3. All prompt routes have shared layout coverage, but this does not prove each media/domain output with the actual chosen provider. Existing engine/recipe capabilities and their limits remain; no unsupported neural media capability is claimed.
4. Explorer exposes readable identity/core properties and bounded search. It does not synchronize selection into Studio or automatically send all source/map contents to providers. Adapter identity permissions can limit coverage and produce explicit errors.
5. Luau checking is static syntax/lint, not luau-analyze type checking or runtime playtesting. Its local Rokit dependencies are not bundled for other machines.
6. Browser fixture evidence covers layouts and appearance/density states. Native launch evidence is separate. Comprehensive zoom/accessibility and native map/provider acceptance remain open.

Do not label the full original acceptance request complete solely from unit/browser tests. The installed release and preserved data are documented in installation evidence.

## Installed native verification

The installed 0.1.2 process rendered Chat and retained the selected ChatGPT account/model. Opening its provider dropdown displayed actual refreshed account limits (5h and weekly) and reset times. Native accessibility/screenshot evidence is in the evidence directory. All protected table hashes remained identical after native launch as well. Studio native screenshot showed the welcome screen without a place; no live map acceptance is claimed.
