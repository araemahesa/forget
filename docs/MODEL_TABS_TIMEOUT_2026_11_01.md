# Model 3D tabs and provider request timeout — 1 November 2026

Version: 0.1.30.

## Changes

- Model 3D has a tab strip with a + button and inline history. History reads saved creative versions; opening a result does not generate it again. Closing a tab does not delete an artifact.
- Each tab owns its draft, references, request journal and selected result. Tab metadata and prompt drafts survive restart. Captured references and the original prompt are restored from the task journal. Active tasks stay mounted when switching tabs; only the visible tab mounts a WebGL viewport. Closing a running tab is disabled.
- The generator shows a compact process card using actual journal events, activity state and tool receipts. It has no invented completion percentages. The submitted prompt is collapsible. Raw provider errors are not repeated in the process card; timeout feedback is shown once in plain language.
- A Model 3D provider request can run for up to 600 seconds, within a 1,200-second provider-work budget. This applies to initial generation, reference review, and explicit recovery. Other task budgets stay unchanged. Cancellation and unknown-result protection remain in place. Failed requests are never replayed automatically.

## Root cause

The user's recorded failed task started at 1793541237284 ms and ended at 1793541357793 ms: approximately 120.5 seconds. Its error was REQUEST_TIMEOUT. The supervisor requested at most 120 seconds and the curl transport independently rejected request durations above 120 seconds. Both boundaries have been updated for Model 3D; increasing only the frontend wait would not fix this.

## Verification

Evidence directory: `docs/test-evidence/2026-11-01/model-tabs-timeout/`.

- A supervisor test verifies that 600 seconds and 24,576 output tokens reach the request dispatcher, that a timeout triggers exactly one request, and that no completed result is fabricated.
- UI tests cover independent drafts, tab switching, running-tab close prevention, persistent history, history tab reuse, task isolation, restoring the correct completed version, and process stages without duplicated raw error text.
- Frontend: 323 tests passed; backend: 146 tests passed, six environment-dependent tests ignored. The final recovery/error-display changes also passed 17 focused tests.
- Native installation and final UI results are recorded in the evidence JSON.
- The local release build uses one Cargo job and opt-level 1 for the ForgeKit package to limit memory use on this 8 GB device; dependencies retain their normal release optimization. No debug build or development server is installed.

## Limits

The actual connected provider was not asked to regenerate the pictured shark as part of this update. A longer timeout does not guarantee provider availability or model quality. Network failures and provider-side limits can still end a request. Saving, opening, or recovering an existing result does not certify visual similarity to a reference or Roblox runtime behavior.

Temporary native build files are kept outside the source folder in a `.noindex` directory and removed after successful installation. The latest installed application and current source are retained.
