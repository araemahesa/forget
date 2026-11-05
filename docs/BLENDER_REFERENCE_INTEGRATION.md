# Blender and visual references — ForgeKit 0.1.5

Model 3D and AI Chat share a bounded Blender builder. The selected AI provider interprets uploaded reference images and produces a validated declarative model. ForgeKit runs its own fixed Python builder in Blender, validates the exported files, and saves a source `.blend`, a self-contained `.glb`, and an `.fbx`.

## Model 3D

Open **Kreasi → Model 3D**. Attach up to three PNG/JPG/WebP references and keep **Bangun hasil dengan Blender** enabled. Generate uses the already selected provider, model and reasoning setting. Blender must be installed; a missing engine produces an explicit error rather than a silent fallback.

After generation, **Hasil Blender** displays the actual exported GLB. You can switch to the recipe preview, inspect from different angles, or open the folder containing all three files. **Bangun di Blender** also builds an existing saved model. An active local build has a stop control; cancellation kills the owned child process. Cached results are integrity checked before reuse.

## AI Chat

Use the image attachment button beside the chat text field, attach up to three references, and ask for a model through Blender. Thumbnails and removal controls appear inside the composer. The agent receives the images and a scoped `forgekit_blender_build` tool. Successful output also creates a saved Model 3D version, accessible through Studio Kreatif → Model 3D. Images remain attached to their user message after reopening the chat. Ask/Plan recovery does not gain local write tools.

## Shape and transport

Model recipes retain the existing six primitives and add a `profile` primitive: a 2D outline, up to eight holes, bounded bevel, and real extrusion thickness. A profile lies in local XY and extrudes on Z, centers and normalizes to the part size, then applies its saved transform. The preview and Blender use the same part IDs, contours, dimensions, colors and materials. No model-supplied Python, shell command or local path is executed.

Selected PNG/JPG/WebP files are converted locally to PNG, capped at 1536 pixels per edge and 2 MiB encoded per image. Native code validates actual PNG bytes and dimensions. Canonical multimodal blocks are converted to Responses, Anthropic or OpenAI-compatible image inputs at the existing provider boundary. A provider/model that does not accept images can reject the request; references are never silently discarded or sent to a different account.

## Roblox import and scope

Use **Buka folder Blender / FBX**, then **File → Import** in Roblox Studio to import `model.fbx` or `model.glb`. Check materials, scale, grip and effects in Studio. Custom profiles cannot use the older primitive-only Apply path; the UI and backend reject that substitution. Existing primitive Apply actions remain available.

This is reference-guided procedural modeling. It is not a neural image-to-3D service and cannot guarantee 100% likeness, hidden-side reconstruction, production UV maps, baked PBR textures, rigging or playable weapon behavior. Those require their own production and verification. Blender source materials and the Roblox render can differ.

## Verification

Verification results and installation state are recorded in [the 30 October report](BLENDER_REFERENCE_VERIFICATION_2026_10_30.md). Automated checks distinguish fixtures, actual Blender file creation, live selected-provider requests and live Studio work. No Studio map is modified by this integration's acceptance test.
