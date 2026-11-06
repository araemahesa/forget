# ForgeKit Animation Studio — capability matrix dan rencana

Audit 6 November 2026 terhadap source aktif `CODE/` (versi 0.1.47). Dokumen ini memisahkan apa yang benar-benar ada dari apa yang masih rencana. Status diperbarui setiap tahap.

Legenda: **Ada & teruji** · **Ada, belum teruji live** · **Perlu implementasi** · **Tidak didukung target**

## Titik awal (sebelum tahap 1)

| Kemampuan | Status | Bukti |
|---|---|---|
| Recipe animasi R6/R15 (Euler per joint, keyframe pose penuh) | Ada & teruji | `creative.rs` validator `animation`, `motionAudio.ts` |
| Pratinjau di rig referensi (manekin lokal) | Ada & teruji | `create/robloxRig.ts`, `geometry.ts evaluateMotion` |
| Ekspor GLB rig referensi + motion | Ada, round-trip belum diuji | `AnimationPage.tsx exportAnimation` |
| Root motion (translasi) | Perlu implementasi | skill `animation-motion` 1.4.0 menolak root translation |
| Mode Objek 3D | Perlu implementasi | tidak ada |
| MotionIntent / checklist kepatuhan prompt | Perlu implementasi | tidak ada |
| Inspeksi rig aktual di Studio (Motor6D, Bone) | Perlu implementasi | StudioMCP read tools tersedia (`inspect_instance`, `search_game_tree`) |
| Penerapan ke Studio | Ada, belum teruji live | lewat chat + persetujuan (`execute_luau`) |
| Publikasi animation asset Roblox | Tidak didukung tanpa akses akun | tidak ada asset ID yang boleh dikarang |
| Blender untuk animasi | Perlu implementasi | Blender dipakai hanya untuk model statis |
| Uji runtime (Play, multiplayer) | Perlu implementasi | — |

## Tahap

1. **Kontrak & mesin evaluasi** (tahap ini): `AnimationDocument` v2 berversi (mode karakter/objek, MotionIntent, track quaternion/posisi, marker, root policy), migrasi v1 → v2, evaluasi berbasis waktu (independen FPS), QA otomatis, checklist kepatuhan prompt, dua mode di halaman Animasi, ekspor GLB + verifikasi baca-ulang.
2. Inspeksi target Studio read-only (`inspect_animation_target`): RigProfile/BindingMap dari Motor6D/Bone aktual.
3. Penerapan ke Studio dengan readback dan uji Play terkontrol.
4. Jalur Blender (authoring/baking, FBX) dan retargeting rig kustom.
5. Pencatatan bukti ke Obsidian per versi dan promosi pengetahuan draft → tested.

Detail status per tahap ada di bagian "Status saat ini" di bawah.

## Status saat ini (setelah tahap 1)

| Kemampuan | Status |
|---|---|
| AnimationDocument v2 (karakter/objek, quaternion, marker, MotionIntent) + validator TS & Rust | Ada & teruji otomatis |
| Migrasi recipe v1 → v2 (versi lama tetap terbaca) | Ada & teruji otomatis |
| Prompt bebas → kebutuhan berkutipan → binding target/waktu | Ada; generasi provider live belum diuji |
| Dua mode di halaman Animasi, prompt sebagai input utama, kontrol opsional | Ada & teruji otomatis |
| Evaluasi berbasis waktu (independen FPS), loop/pingpong/once | Ada & teruji otomatis |
| QA: larangan, seam loop pose+kecepatan, popping, kaki selip (rig referensi), tanpa drift objek | Ada & teruji otomatis |
| Koreksi otomatis (repair provider) untuk seam loop dan larangan | Ada; belum diuji dengan provider live |
| Ekspor GLB (kurva di-bake 30 Hz) + verifikasi baca-ulang | Ada & teruji otomatis |
| Panduan penerapan Studio untuk v2 (KeyframeSequence / CFrame rest-relative) | Ada; belum diuji live |
| Catatan vault (skill mirror v2, `30 Fitur/Animasi`, `35 Pengetahuan/Animasi Kapabilitas dan Bukti`) | Ada (draft) |
| Inspeksi rig/objek aktual di Studio, runtime test, Blender/FBX, retargeting, publikasi | Perlu implementasi (tahap 2–5) |

Detail: `docs/changelog/ANIMATION_STUDIO_2026_11_06.md`.
