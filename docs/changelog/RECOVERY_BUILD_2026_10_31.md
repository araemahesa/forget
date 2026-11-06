# ForgeKit 0.1.20 — pemulihan dan verifikasi

## Implementasi

- Memulihkan modul frontend/backend, kontrak, migration, skills, rig dan aset dari arsip tanpa menimpa berkas pengguna.
- Menyambungkan Chat dan generator ke supervisor/checkpoint persisten. Akun/model/effort dibekukan; fallback tidak dinyalakan diam-diam.
- Menyangga output sementara provider; chat menampilkan hasil final dan progres backend terpisah.
- Memvalidasi target serta argumen Edit sebelum dispatch. Operasi belum dieksekusi dapat diperbaiki; efek write yang belum pasti perlu read-back.
- Menyambungkan lampiran dan executor Blender dengan validasi recipe, batas proses, checksum dan bukti operasi induk.
- Mengharuskan kandidat hasil AI cocok dengan checkpoint tervalidasi sebelum versi karya disimpan.
- Memulihkan registrasi command/permission IPC, task recovery dan pembaruan Explorer tanpa menghentikan deteksi map selama tugas.
- Mempertahankan composer bersama dan kualitas `high` otomatis. Tidak ada pemilih kualitas di composer.
- Memulihkan logo/favicon dan gaya navigasi/struktur viewport 3D yang hilang; canvas tetap di dalam batas preview.
- Menyamakan versi Cargo, Tauri dan frontend menjadi 0.1.20.

## Bukti

`docs/test-evidence/2026-10-31/recovery-build/` memisahkan log suite, render frontend di browser, screenshot native, migrasi salinan database dan pemeriksaan installer.

- `pnpm typecheck`: berhasil.
- `pnpm test --run`: 273 tes berhasil (272 desktop + 1 contracts).
- `pnpm build`: berhasil melalui beforeBuildCommand Tauri.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: 126 berhasil, 3 dilewati.
- Browser frontend produksi: 75 kasus (15 rute × 5 ukuran dari 1920×1080 sampai 720×450), tanpa error JavaScript, overflow halaman, kontrol prompt terpotong, gambar rusak atau canvas keluar batas. Tema/density default; bukan pemeriksaan semua state native.
- Audit statis: 86 command UI memiliki handler dan capability eksplisit (90 command backend terdaftar).
- Kompatibilitas database pengguna: salinan schema 15 dibuka ulang; 26 tabel diverifikasi tetap utuh, integrity/foreign-key check berhasil. Ini bukan bukti migrasi live dari semua versi lama.
- Blender terpasang: 1 tes tambahan berhasil; berkas `.blend`, GLB dan FBX nyata, pemeriksaan cache/tamper, workspace sementara.

## Batas

Fixture tidak membuktikan provider atau Studio live. Belum ada sertifikasi seluruh login/kuota provider, semua domain hasil generasi live, map >300 objek/depth >4, Play/Edit, performa Roblox dan mutu gerak/visual/audio. Browser menggunakan frontend produksi tanpa IPC palsu; state yang memerlukan desktop tetap menampilkan keterbatasannya. Build ini memakai tanda tangan ad-hoc lokal dan belum dinotariskan Apple. Jangan menganggap label kualitas `high` sebagai bukti kualitas hasil.
