# Pemulihan ForgeKit — 31 Oktober 2026

Source yang sebelumnya parsial sudah direkonstruksi dari berkas yang tersisa, arsip pemulihan, riwayat penulisan, dan kontrak yang dapat diverifikasi. Berkas asli dan perubahan pengguna dipertahankan. Asal pemulihan ada di `.forgekit-rebuild/restored-missing-20261031.json`; versi laporan sebelumnya disimpan dalam `.forgekit-rebuild/pre-reconstruction-20261031/`.

Source kini lolos typecheck, build frontend, 273 tes JavaScript/TypeScript dan 126 tes Rust. Tiga tes Rust yang memerlukan integrasi eksternal dilewati dalam suite biasa. Tes Blender terpasang dijalankan terpisah dan berhasil menghasilkan serta memeriksa file nyata. Build native dan verifikasi installer versi 0.1.20 sedang difinalisasi.

Perbaikan meliputi jalur executor Chat/generator, checkpoint pemulihan, pembatasan write Edit, bukti kandidat sebelum penyimpanan, lampiran, pendaftaran IPC dan kontrol model/provider. Composer bersama memakai profil `high` tanpa pemilih kualitas. Identitas bundle dan direktori data tetap `dev.forgekit.studio` agar akun, chat dan karya lama dapat digunakan.

Build yang berhasil bukan bukti seluruh kebutuhan kualitas media atau integrasi live selesai. Login/kuota semua provider, write/playtest Roblox Studio, map besar dan kualitas hasil provider masih memerlukan verifikasi langsung tersendiri. Jangan menjalankan migrasi SQL manual. Verifikasi migrasi dilakukan dahulu pada salinan database, lalu aplikasi menjalankan migrasi yang didukung saat dibuka.

Bukti terbaru: `docs/test-evidence/2026-10-31/recovery-build/`. Catatan implementasi dan batas verifikasi: `docs/RECOVERY_BUILD_2026_10_31.md`.
