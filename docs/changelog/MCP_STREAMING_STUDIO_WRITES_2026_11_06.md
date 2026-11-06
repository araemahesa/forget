# Streaming chat, konektor MCP, dan penulisan Studio — 6 November 2026

## Perubahan

- **Streaming chat.** `send_chat_message` mengirim event `forgekit:ai-chunk` `{threadId, requestId, chunk, done, reset}`. Setiap percobaan akun mengirim `reset` lebih dahulu sehingga teks dari akun yang gagal tidak tercampur. AI Chat menampilkan teks berjalan sebagai draf berlabel "draf belum tersimpan". Tugas tetap baru selesai ketika pesan asisten yang tersimpan diterima, bukan karena `done`.
- **Konektor MCP nyata.** Skema 16 (`0017_mcp_connector_launch.sql`) menambah `command` dan `args_json`. Konektor lama tanpa perintah tetap tersimpan tetapi dinonaktifkan. `src/mcp.rs` adalah klien stdio MCP (protokol 2025-06-18): server dijalankan per permintaan chat lalu dihentikan, stderr dibuang, PATH dilengkapi lokasi umum (Homebrew, `~/.local/bin`, `~/.cargo/bin`). Tool diekspos sebagai `mcp_r<n>_<tool>` (server menandai `readOnlyHint`) atau `mcp_w<n>_<tool>`. Tool tulis mendapat perlindungan supervisor yang sama dengan write Studio (duplikasi intent, outcome unknown). Mode ask/plan hanya mengekspos tool baca. Server yang gagal dijalankan hanya menghasilkan peringatan untuk model. Daftar tool palsu dihapus. Pengaturan → Konektor MCP mengganti halaman konektor lama yang tidak terhubung ke navigasi.
- **Penulisan Studio dengan guard.** `execute_luau` kini tersedia pada chat mode auto dan resume `stop_play`. Sebelum dispatch, ForgeKit membaca identitas dokumen (`game:GetDebugId` + `workspace:GetDebugId`, `PlaceId`, status Play). Kode provider dibungkus agar identitas dan mode Edit diperiksa ulang di dalam Studio saat kode berjalan, lalu dijalankan dalam satu recording `ChangeHistoryService` yang di-commit bila sukses dan dibatalkan bila error. Bila plugin lain sudah memegang recording, kode berjalan di dalam recording tersebut. `multi_edit` tetap tidak tersedia karena tidak dapat diberi guard di dalam Studio. Skill `scene-editing` 1.5.0 memperbarui panduan recording.

## Tidak diubah

- Rotasi akun otomatis pada `run_connected` tetap menimpa fallback policy tersimpan; ini perilaku v0.1.31 dan kontrol fallback di Pengaturan memang sudah dihapus.

## Validasi

- 179 tes Rust, 387 tes frontend, typecheck, dan build frontend lulus.
- Migrasi skema 15 → 16 diuji pada salinan database pengguna (`scripts/verify_workspace_migration.py`): 26 tabel utuh, integrity dan foreign-key check lulus. Bukti: `docs/test-evidence/2026-11-06/mcp-streaming-studio-writes/workspace-migration.json`.
- Klien MCP diuji melawan StudioMCP resmi Roblox (`cargo run --example mcp_probe -- /Applications/RobloxStudio.app/Contents/MacOS/StudioMCP`): 34 tool terbaca dengan klasifikasi baca/tulis.
- Aplikasi dev dijalankan dengan direktori data terisolasi; tidak ada error atau panic saat start. Bagian Konektor MCP diperiksa secara visual.

## Batas

- Streaming, tool MCP di dalam chat, dan penulisan Studio belum diuji live dengan akun provider sungguhan dan map Studio terbuka. Uji itu memakai kuota akun dan mengubah map, jadi perlu dilakukan pengguna.
- Database asli belum dimigrasikan. Aplikasi terpasang lama (skema 15) akan menolak database skema 16, jadi pasang build baru sebelum membuka build ini pada data asli.
