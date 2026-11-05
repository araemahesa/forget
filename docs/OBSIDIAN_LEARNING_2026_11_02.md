# Obsidian knowledge memory — 0.1.36

ForgeKit now records local terminal task outcomes as scoped runbooks, then retrieves relevant runbooks for subsequent requests. It separates Roblox work from ForgeKit source development. This is persistent knowledge retrieval, not model-weight training or autonomous execution of new tools.

## Behavior

- Completion/failure publication and the visible Obsidian status synchronize recent outcomes from the application database into `55 Pembelajaran`. Manual creative saves use the same path.
- The index retains 128 recent observations. Runbooks are grouped by feature and observed condition, with original task IDs and status. Older runbooks remain available when observations leave the active window. Repeated synchronization is idempotent.
- Runbooks distinguish review-revise, provider review-accept, timeout, validation failure, undiagnosed failure, saved artifacts and saved answers. `observed` never means a verified fix. A saved version never implies visual similarity or successful gameplay.
- No reference image, complete recipe, chat body or provider credential is written to memory. Bounded review excerpts are treated as evidence, not instructions. User notes are not overwritten; symlink paths are rejected. Writes are atomic per file, with the index committed last. A failure is surfaced separately from artifact-save success.
- Retrieval selects at most six learned runbooks for the task feature, with separate development routing. Explicit custom skills can be registered by note, kinds, keywords and enabled in the vault manifest. Note/context limits still apply.
- Exact embedded copies of bundled instructions are referenced by skill ID and original note hash instead of sending the body twice. Local additions and rewritten guide bodies remain in context. Checkpoints freeze the selected snapshot.
- The UI displays the vault connection, core and learned guide counts, and learning state. It refreshes on focus and task changes.

## Vault additions

The homepage and a knowledge canvas connect the brain overview, Roblox production, ForgeKit development, visual diagnosis, quality checks and generated learning. A ForgeKit development skill covers source tracing, contracts, tests, build/install verification and truthful reporting when development tools are unavailable. Existing skill guides and user projects remain in place.

## Validation

See `test-evidence/2026-11-02/obsidian-learning/validation.json` for exact counts and the two initial UI timeouts. All three selected retry cases passed with the original timeout, without changing production code or test limits. The focused native suite includes actual configured-vault routing and a read-only connection to the user's task database. It produced 29 observations and seven runbooks. The all-feature context uses 50,596 text bytes across 71 note receipts, below the 98,304-byte context limit.

The full native suite passed before the final targeted changes; all 12 Obsidian tests passed afterward. Version 0.1.36 is built and installed only after bundle verification, with the previous application and a consistent SQLite backup retained. Installation evidence is recorded separately.

## Limits

This change does not add UV texture baking, neural reconstruction, a sculpt engine, a rigging engine or shell tools to ForgeKit AI Chat. It does not demonstrate improved shark geometry or reference fidelity. The latest user message mentioned an image, but contained no new image attachment. No external inference or Studio writes were performed for these checks.
