# ForgeKit 0.1.5 — Blender and references, 30 October 2026

ForgeKit Studio 0.1.5 is installed at `/Applications/ForgeKit Studio.app`. Blender 5.2.3 LTS is installed from the official Apple Silicon distribution and detected by the Model 3D page. The previous 0.1.4 application bundle is retained in this task's `work/` folder. No production map was changed.

The Model 3D generator and AI Chat accept up to three image references. The selected provider receives validated image blocks. A successful recipe can build real `.blend`, `.glb` and `.fbx` files using the fixed local Blender builder. Model 3D previews the exported GLB. AI Chat's Blender tool saves a Model 3D version only when a persisted provider tool call, its dispatched operation and the exact recipe all match. Native and UI use the real `#create/model-3d` route.

Validation completed:

- TypeScript typecheck and production frontend build passed. The Three viewport chunk still triggers the pre-existing size warning.
- Frontend and contract suite: 317 passed (53 contract, 264 desktop).
- Native suite: 127 passed, 2 intentionally ignored, serialized to avoid the known unrelated stream-lease test race. A real 512×512 PNG exceeding the old text-only body cap reached the selected HTTP fixture with its image block intact.
- Opt-in real Blender test: source, GLB and FBX created; cached reuse and tamper rejection passed. Independent GLB load verified meshes, contour hole and bounds.
- Selected managed Codex provider in isolated data generated a model from a PNG reference; three parts and all three Blender files were saved. The isolated Model 3D page reloaded and displayed the actual exported mesh.
- Live AI Chat in isolated data reached `forgekit_blender_build` and created Blender files, exposing a child-version provenance failure. The save path was corrected and its regression test now verifies accepted, mismatched and duplicate saves. A complete second live Chat/provider run has not yet been confirmed.
- Release app and DMG passed `verify_macos_bundle.py`: arm64, signatures, image checksum, mounted binary match and no acceptance harness markers. The DMG was made with `hdiutil` after Tauri's Finder-based DMG helper timed out.
- Installed 0.1.5 launched. An intermediate 0.1.5 bundle reconnected its original managed Codex account through **Uji koneksi**, read eight models and actual usage windows. The final rebuilt bundle is awaiting macOS Keychain authorization; Computer Use cannot operate `SecurityAgent`, so the user must approve that dialog. Protected production table row counts stayed the same (nine chat threads, 21 messages, four GFX versions, one image version, one SFX version, zero 3D versions); SQLite integrity is `ok` and no active task remains.

Limits: One image does not reveal hidden geometry, so exact likeness is not guaranteed. Import the GLB/FBX into Roblox Studio and inspect scale, materials and grip; import is manual. UV baking, advanced PBR, rigging, animation and gameplay are outside this change. The installer uses an ad-hoc signature and has not been tested on a clean machine. Existing dirty Git work was preserved without reset or commit.
