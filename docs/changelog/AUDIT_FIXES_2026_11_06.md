# Perbaikan hasil audit menyeluruh — 6 November 2026

## Keamanan

- **Persetujuan sebelum AI mengubah sesuatu.** Setiap `execute_luau` ke Roblox Studio dan setiap panggilan tool MCP kini berhenti dan menunggu persetujuan pengguna (`src/approval.rs`, dialog `app/ApprovalDialog.tsx`). Dialog menampilkan kode Luau atau argumen tool. Penolakan, Stop, atau 10 menit tanpa jawaban dicatat sebagai `[TOOL_NOT_DISPATCHED]` sehingga tidak ada efek dan tidak ada receipt tulis. Permintaan yang muncul sebelum dialog terpasang dibaca lewat `list_tool_approvals`.
- **Guard penulisan Studio tidak bisa dijebol.** Kode provider tidak lagi dibungkus `pcall(function() … end)`. Pemeriksaan Play/identitas map dan pembukaan recording ditaruh sebagai pernyataan sebelum kode provider, lalu panggilan terpisah menutup recording: commit bila sukses, cancel (rollback) bila error, dan tidak pernah pada map lain. Hasil tool memuat `undoRecording`.
- **Label "hanya baca" dari server MCP tidak dipercaya.** Semua tool MCP (`mcp_<n>_<tool>`) diperlakukan sebagai tulis: perlu persetujuan, mendapat perlindungan duplikasi supervisor, dan tidak diekspos pada mode ask/plan.
- **ffmpeg** dikunci ke demuxer sesuai ekstensi lampiran sehingga playlist/concat tidak bisa membaca file lokal lain.
- `reveal` Blender memakai `/usr/bin/open`, bukan `open` dari PATH.

## Keandalan

- Jendela bisa ditutup walau draf Ikon/Pakaian gagal dimuat (flush tanpa perubahan tidak lagi melempar error).
- localStorage dibatasi: kunci `editor-parent` dibersihkan, riwayat edit model disimpan maksimal 20, dan semua tulis memakai `safeStorage`. Error boundary mencegah layar putih total.
- Catatan Obsidian yang hilang dilewati dan dilaporkan sebagai `missingNotes`, bukan menggagalkan semua tugas; credential, symlink, dan batas ukuran tetap memblokir.
- Saat aplikasi dibuka, `task_attempt` berstatus `started` ditandai `interrupted`, dan `context_snapshot` lebih dari 7 hari yang tidak dirujuk tugas dihapus. Menghapus percakapan ikut menghapus `task_attempt`-nya.
- Lock build Blender diambil sebelum `recipe.json` ditulis (dengan helper direktori aman symlink).
- Fokus panel usage tidak lagi melompat saat tugas berjalan; editor GUI menunda pembangunan ulang viewport 250 ms; pilihan map Studio tidak lagi diabaikan saat probe berjalan; loop polling Studio tidak berlipat; pencarian Explorer konsisten; Stop memberi pesan bila gagal; notifikasi akun cadangan tidak lagi tertinggal.

## Fitur yang dipulihkan

- **Pengaturan → Worker GPU Hunyuan**: endpoint dan token worker kini bisa diisi dan diuji lagi; panel Model 3D tetap bersih.

## Kebersihan

- Migrasi mati `0015_provider_only_tasks.sql` dipindah ke `docs/history/migrations/`.
- `connect-mac.command` membaca host/port dari `~/.config/forgekit/hunyuan-worker.env`, bukan IP yang di-hard-code.
- Dokumentasi Blender dan Hunyuan disesuaikan dengan kode; teks "Requête" diganti.

## Sengaja tidak diubah

- Token Codex tetap di `auth.json` (Codex CLI mengelolanya); token Hunyuan tetap di file 0600. Memindahkannya ke Keychain berisiko membuat inference latar belakang gagal karena dialog izin Keychain.
- Scope Google OAuth `cloud-platform` adalah scope yang didokumentasikan Google untuk Gemini API via OAuth.
- Batas waktu tool MCP tetap 90 detik; supervisor sudah menolak panggilan baru saat sisa waktu di bawah 30 detik.
- 15 halaman yang belum terhubung ke menu (World, Place Tools, Roblox Cloud, dll.) dibiarkan sebagai pekerjaan produk yang belum selesai.

## Validasi

- 184 tes Rust, 410 tes frontend, typecheck, dan build lulus.
- `cargo audit`: tidak ada kerentanan; dua peringatan bawaan Tauri (`proc-macro-error` unmaintained, `glib` khusus Linux). `pnpm audit --prod`: tidak ada kerentanan.
- Belum diuji live: dialog persetujuan dengan akun provider dan map Studio sungguhan, serta guard recording lintas panggilan `execute_luau`.
