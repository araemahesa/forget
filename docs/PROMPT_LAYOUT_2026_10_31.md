# Perapian composer ForgeKit — 31 Oktober 2026

Status: **implementasi komponen selesai; pemasangan native terhalang source proyek yang belum lengkap.** Aplikasi terpasang tidak diperbarui. Pengguna mengonfirmasi tidak memiliki salinan source lengkap.

## Perubahan implementasi

- Brief kreatif dan asisten desain memakai kartu prompt bersama: hierarki judul, input 14 px, ritme 8/12/16 px, kontrol 36–40 px menurut density, aksi utama 44 px.
- Chat, generator, revisi dan editor AI memakai aturan composer yang sama. Layout merespons lebar kartu melalui container query, termasuk inspector sempit pada layar desktop.
- Model dan penalaran memiliki kolom terukur; nama model panjang memakai ellipsis dan tooltip yang sudah tersedia. Provider, model, effort, kirim, stop, error dan pemulihan tetap memakai handler sebelumnya.
- Pembaruan lanjutan: “Pengaturan hasil” dan pemilih kualitas dihapus. Generate serta revisi melalui `useCreativeTask` selalu mengirim profil `high`, tertinggi yang didukung kontrak/backend saat ini. Pilihan akun, model dan penalaran tetap dipertahankan.
- ReferenceImages memakai tombol bertema, penghitung 0/3, detail format yang dapat dilipat, preview dan hapus file. File input tetap tersembunyi dan dapat dipicu tombol. Validasi jumlah/ukuran, drag/drop dan pembacaan referensi dipertahankan.
- Fokus keyboard diperjelas pada composer dan lampiran; reduced-motion dihormati. Benturan bingkai input editor dan posisi teks lampiran diperbaiki.

Perubahan utama: `CreativeControls.tsx`, `EditorAiPromptBar.tsx`, `ReferenceImages.tsx`, `workspace-layout.css`. `references.ts` dipulihkan dari sumber lokal yang sudah tersedia; kode pembacaan file tidak diubah. Provenance tersedia dalam bukti.

## Cakupan dan bukti

Komponen yang dirender menggunakan source React asli. Provider, IPC, pemulihan tugas dan ekstraksi lampiran menggunakan fixture eksplisit. Stylesheet dasar diambil dari aset aplikasi terpasang, kemudian CSS source yang berubah diterapkan. Ini **bukan** pengujian provider, Studio, atau aplikasi native hasil build baru.

- **336 kasus layout lulus**: delapan domain CreativeControls (Model 3D, animasi, VFX, GUI, NPC, cutscene, musik, sky), shared editor AI, Chat, revisi dan lampiran.
- Ukuran 1920, 1440, 1280, 1024, 720, 390, 320 px; tema terang/gelap; density nyaman/kompak. Inspector diuji pada lebar maksimum 360 px, terlepas dari lebar halaman.
- Tidak ada overflow horizontal atau kontrol keluar kartu pada kasus yang diperiksa.
- Interaksi: kirim tunggal, input kosong dinonaktifkan, stop, error provider terlihat, akun belum dipilih dinonaktifkan, revisi mempertahankan parent versi, tambah/hapus lampiran, batas tiga lampiran dan disclosure format.
- Lima modul TypeScript serta CSS berhasil diparse. Ini tidak menggantikan typecheck proyek penuh.

Bukti: [laporan komponen](test-evidence/2026-10-31/prompt-layout/report.json), [screenshot generator](test-evidence/2026-10-31/prompt-layout/generator-dark-1440.png), [screenshot editor](test-evidence/2026-10-31/prompt-layout/editor-light-1440.png), [screenshot lampiran](test-evidence/2026-10-31/prompt-layout/attachments.png), [native sebelum perubahan](test-evidence/2026-10-31/prompt-layout/before-native.png).

Screenshot sesudah adalah **fixture komponen**, bukan aplikasi native yang telah diperbarui. Native sesudah tidak tersedia karena build belum dapat dibuat.

## Penghalang build dan batas verifikasi

Keempat perintah diminta dicoba dari CODE:

| Perintah | Hasil |
| --- | --- |
| `pnpm typecheck` | Gagal: `tsc` belum tersedia; konfigurasi TS dan source contracts juga hilang. |
| `pnpm test --run` | Gagal: `vitest` belum tersedia. |
| `pnpm build` | Gagal: `vite` belum tersedia; bukan build aplikasi yang lulus. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | Gagal parse manifest: `src/lib.rs` hilang. |

Pemasangan dependency saja tidak memulihkan `tsconfig.base.json`, workspace config, package/index contracts, `src-tauri/src/lib.rs`, `build.rs`, `MessageAvatar.tsx`, `editorAi.ts` dan modul lain yang hilang. Versi source juga bercampur; jangan membangun versi backend pengganti dengan menghilangkan fitur atau mengarang kontrak agar compile.

[Daftar berkas hilang](test-evidence/2026-10-31/prompt-layout/build-blockers.json) dan log masing-masing perintah tersimpan di direktori bukti. Catatan pemulihan lama tetap dipertahankan.

Belum diverifikasi: integrasi semua halaman native, generasi provider live, lampiran melalui backend native, runtime Roblox, zoom 200%, pembaca layar penuh. Tidak ada perubahan pada akun, chat lama, karya, database, migrasi, atau aplikasi terpasang.
