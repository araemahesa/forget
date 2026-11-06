# ForgeKit Studio

Aplikasi desktop (Tauri 2 + React) untuk membuat aset dan konten Roblox dengan bantuan AI.
Status pemulihan dan batas verifikasi: `README_PEMULIHAN.md`.

## Perintah

```sh
pnpm dev          # jalankan frontend (Vite, port 1420)
pnpm tauri dev    # jalankan aplikasi desktop lengkap
pnpm typecheck    # TypeScript
pnpm test         # tes frontend + contracts (Vitest)
pnpm build        # build frontend
cd apps/desktop/src-tauri && cargo test   # tes Rust
```

## Struktur

```
apps/desktop/                 aplikasi desktop
  src/
    app/                      shell aplikasi, navigasi, registry fitur
    design-system/            komponen UI dasar + token CSS
    engines/                  renderer/worker lokal (gfx, sfx, music, skybox, ...)
    services/                 jembatan ke backend Tauri + state bersama
    features/<fitur>/         satu folder per halaman/fitur
      model3d/  gui/  vfx/  npcDialogue/  library/  gfx/  sfx/  ...
      shared/                 komponen & hook yang dipakai banyak fitur
    tests/                    setup Vitest + helper tes
  src-tauri/                  backend Rust
    src/
      lib.rs  commands.rs     titik masuk + perintah IPC
      ai/                     klien provider AI (mod.rs) + protokol stream
      auth/                   login Codex, Google, browser
      model3d/                Blender, Hunyuan, profil & referensi model 3D
      studio/                 koneksi Roblox Studio, explorer, cek Luau
      tasks/                  task, journal, activity
      provider_usage/         kuota/pemakaian provider
      obsidian/               integrasi vault Obsidian
      storage/                SQLite + tes storage
      *.rs                    modul lain (routing, creative, images, sfx, ...)
    scripts/blender/          skrip Python Blender (di-embed via include_str!)
    scripts/luau/             skrip Luau/Lua (di-embed)
    resources/                data statis (stdlib selene Roblox)
    migrations/               migrasi SQL (dijalankan otomatis oleh aplikasi)
    examples/                 probe/alat diagnostik (`cargo run --example ...`)
    tests/                    harness tes live/manual
packages/contracts/           tipe & validator bersama frontend/backend
services/hunyuan3d/           worker GPU Hunyuan3D (upstream/ = kode pihak ketiga)
skills/                       prompt skill AI (di-embed ke backend)
scripts/                      skrip verifikasi & tes Blender
docs/                         panduan; docs/changelog/ = catatan perubahan bertanggal;
                              docs/test-evidence/ = bukti tes
```

Catatan: file di `src-tauri/scripts/` dan `skills/` dikompilasi ke dalam binary,
jadi memindahkan/mengganti namanya perlu memperbarui path `include_str!`.
