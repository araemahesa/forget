# Evidence identity — 28 October 2026

- `verification.json`: current aggregate, 51 contracts + 241 desktop + 107 Rust = 399 tests. Logs are from the latest passing runs.
- `bundle-verification.json`, `native-release-build.log`: final release4, macOS arm64, ad-hoc signature, DMG CRC and mounted binary match, acceptance harness absent. Not notarized or clean-machine installed.
- `native-provider-live.json`: actual ForgeKit-owned Codex OAuth / gpt-6.1-sol. Chat IPC, model3d native UI/WebGL, exact color-only refine, GFX native UI/preview. Isolated acceptance DB/artifacts, not production output library.
- `provider-usage-live-final.json`: readonly metadata probe, same ForgeKit-owned account, official Codex limits 4%/14% used (96%/86% remaining), real reset timestamps, eight catalog models. No inference used to obtain quota. One connected account only.
- `native-fixture.json`: local HTTP fixture via native IPC; deliberately simulated A429/B200 routing evidence, not real provider responses.
- `native-studio-initial-partial.json`: historical first attempt. Its ok=true meant Chat finalized, not wind creation. Unknown pre-dispatch Studio outcome was discovered and subsequently fixed.
- `native-studio-recording-blocked.json`: historical safe failure before script creation; nested undo recording unavailable. Do not interpret as current success.
- `native-studio-readback-timeout.json`: historical RPC timeout during read-only continuation. Checkpoint retained; later continuation completed. Error taxonomy now marks this as request_timeout.
- `native-studio-live.json`: current native/provider/Studio round trip on a newly created unpublished Baseplate Place1 (PlaceId0). Prior task mismatch correctly reported. New script created once; subsequent read-only continuation reached cumulative turn12/16 and did not add write receipts.
- `studio-source-readback.json`, `studio-runtime-verification.json`: independent external MCP verification, one LocalScript in StarterPlayerScripts, one runtime folder and 20 thin lines, moving camera-relative positions and rising TickCount, empty console during observation. Play stopped afterward. Short sample about14 ticks/s does not certify 60fps/smooth quality; undo/redo remains unverified.
- `studio-wind-play-1.png`, `studio-wind-play-2.png`: actual Studio Client Play views of the test map. Screenshots alone do not prove smooth motion.
- `native-picker.png`: historical native harness review where quota command was missing from the harness; unavailable text is not evidence of a production quota failure. Command registration was fixed and later native observation showed96%/86%.
- `native-studio-unknown.png`: native historical partial/unknown result UI, not a success screenshot.
- `native-review-current.png`: retained blue model3d result during later native review. Not evidence of success for the unrelated gate prompt visible in that window. Review window left open with isolated data because user activity was observed.
- `source-change-manifest.json`: source/document hashes compared with the pre-edit archive. This records differences since the snapshot, not Git ownership or a claim that all pre-existing dirty changes were authored in this session. Root README and parent continuation checkpoints were also updated separately.

Native review used debug9 before the final midnight reset-time formatting change. The latter has a frontend regression test and is embedded in release4. Native acceptance first paint required zoom/resize during review. Production startup on a clean machine was not tested. Screenshots may contain the local user's account display name/email, but no credentials.
