# Blender viewport animation — 0.1.38

The selected provider/model continues to read Obsidian skills, create the validated recipe and review reference images. Blender is the execution tool. No external reconstruction service or remote execution server was added.

The Model 3D viewport shows the current job status while waiting. Once the trusted Blender builder writes evaluated preview geometry, a read-only command returns that candidate before rendering, saving and reopening finish. It is labeled as a candidate until the existing final validation completes. The previous saved model is hidden during generation and restored if the new job fails or is cancelled.

Actual Blender triangles are revealed over 1.6 seconds with easing and a short material fade. This is presentation of candidate geometry, not a replay of Blender operations, an estimated completion percentage or evidence of reference fidelity. Orbit/scan indicators use transform and opacity animations. The operating system's reduced-motion setting disables movement and shows complete geometry immediately.

Polling is sequential, stops when the job ends or the tab is inactive, and ignores late responses from prior jobs. Preview IDs suppress repeated mesh transfers. Candidate buffers pass the same validation as saved Blender previews; disposed models release geometry and materials. Candidate geometry cannot be exported or inserted as a final result. Existing saved bundle hashes remain compatible because the Blender Python builder was unchanged.

## Verification

- TypeScript typecheck passed.
- Frontend: 65 files, 352 tests passed with one worker. The first run overlapped Rust compilation and timed out on an existing 513-node DOM test; that test passed alone and the complete rerun passed without source changes.
- Rust library: 160 passed, 10 opt-in tests ignored.
- Actual installed Blender: evaluated candidate observed while render work was still running; final artifact validated; registry cleaned and unrelated job isolated.
- Native Obsidian: eight tests passed, including domain routing and context limits.
- Vault: 13 Python tests passed; index refreshed with 84 sources, 272 notes and 1438 internal links.
- Visual fixture uses hash-verified saved Blender geometry. See `test-evidence/2026-11-02/build-animation/visual-check.json` and viewport screenshots for browser rendering and reduced-motion results.

No new provider generation, paid request or Roblox upload was performed during this update. Visual fixture screenshots exercise the production viewport and overlay, using an existing real Blender mesh; they are not screenshots of a new provider run.

## Installation

Installed `/Applications/ForgeKit Studio.app` version 0.1.38 with a verified ad-hoc signature. Backed up the previous app and SQLite database under `~/Library/Application Support/ForgeKit Recovery/2026-11-02-build-animation-install-1793635368862783000`. Database integrity and foreign keys passed; all six chat/artifact table counts and content hashes matched before and after installation. The installed app reopened the saved 15,124-triangle shark, detected Blender and showed the connected Obsidian context. See `installation.json` and `installed-app-state.json` in the evidence folder.
