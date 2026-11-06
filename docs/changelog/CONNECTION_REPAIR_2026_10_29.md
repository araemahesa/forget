# Connection and installed-app repair — 29 October 2026

## Findings

The installed `/Applications/ForgeKit Studio.app` was the old 0.1.0 build from the preserved RobloxKit repository. Its executable matched that repository byte for byte. It did not contain the managed Codex model adapter present in the active source. A saved ready Codex account therefore appeared connected, while its model catalog could not be read by that installed build. The legacy browser callback is only a return instruction; it is not evidence that the installed app completed account verification.

Two source branches also used SQLite schema 14 for different migrations. The active application now uses schema 15, reconciles their checkpoint/provider-only invariants, and makes a consistent pre-migration snapshot. Account credentials, chat history, creative versions and exports are retained. Older binaries that support only schema 14 reject the newer schema.

## Changes

- Release version 0.1.1 is shared by frontend settings, native binary and installer. The existing managed Codex adapter uses the same version during initialization.
- Successful connection changes force a fresh model/usage read; a cached model failure cannot persist merely because the same account ID was saved again.
- Account usage cache excludes task model overrides. A live smoke test exposed stale canonical-account usage after choosing another model; a regression reproduced the old observation and passes after the fix.
- Model discovery errors include the backend’s safe explanation and a retry control.
- Migration and installer verification scripts use the current schema/version instead of stale constants. Migration regression coverage includes both schema-14 layouts and history/account preservation.
- Settings describe the actual strict selected-provider task limits rather than removed fallback behavior.

## Preservation

Before editing, selected changed sources, Git status and a consistent read-only database snapshot were stored in `../work/connection-repair-20261029-131323/`. Existing dirty changes and historical chats were preserved. The original source repositories were not edited.

## Verification

- TypeScript typecheck passed. Final full frontend/contract suite: 51 contract + 243 desktop = 294 tests passed. Targeted usage/picker/panel run: 11 tests passed. The new model-override regression failed before the fix and passed after it.
- Native suite: 108 tests passed, plus binary/doc test targets. During verification, a prior parallel run had a transient stream lease assertion; the complete final run passed. No production lock behavior was changed during this repair.
- Production database migration was tested on an isolated, consistent read-only copy: schema 14 to 15, integrity and foreign keys clean, immutable hashes and row counts of 26 existing tables preserved, automatic schema-14 snapshot verified.
- Live metadata check from ForgeKit’s own connected account: 8 catalog models readable; ChatGPT Plus official Codex limits readable (5h 0% used, weekly 19% used at the recorded timestamp). These are account metadata observations, not proof of a successful inference.

- The installer passed signature, disk image CRC, mounted app/executable match, architecture, version and production-harness checks. The app uses a local ad-hoc signature; notarization and installation on a clean machine were not tested.
- Installed 0.1.1 launched successfully. The production database is schema 15 with clean integrity/foreign keys; all 32 tables were byte-for-byte unchanged at the row level after migration. The native chat smoke test then added its own thread/turn/attempt. Every original row remains preserved.
- The actual installed UI displayed enabled model/reasoning controls and both official Codex quota/reset windows. A short real chat using the selected account and `gpt-6-astra` returned `ForgeKit terhubung.` and persisted a single succeeded attempt with the same account and model.
- After the smoke test, quota updated from the provider to 3% used in 5h and 20% weekly. These numbers are observations at test time and will change as the account is used.

The final cache-fix bundle was rebuilt and reverified, installed at `/Applications/ForgeKit Studio.app`, and relaunched normally. Source and installed executable hashes match: `04f3a6eea8078d1186f2dc3d620c54c6181175bcba62a9c800c337696baa123a`. The final UI again loaded enabled model/reasoning controls and both official quota/reset windows. After the final restart, all 32 table contents—including the smoke test history—were unchanged and the pre-migration snapshot was not duplicated. The real chat smoke test exercised the same native backend before the final frontend cache fix; that fix is covered by its failing-before/passing-after regression. The browser sign-in itself was not repeated: the already connected ForgeKit-owned account was reused, without importing credentials from another application. Only this one account is connected; other providers were not verified live in this repair.


Evidence is in [`test-evidence/2026-10-29/connection-repair/`](test-evidence/2026-10-29/connection-repair/). `verification.json` indexes the final result; `bundle-verification.json` and `installed-build.json` identify the final installer/binary, while `native-chat-smoke.json` identifies the earlier smoke-test binary explicitly. Previous app bundles and consistent SQLite backups are preserved in the work archive. No Git reset, commit, publication, deletion of historical chats, or mutation of a Roblox map was performed in this repair.
