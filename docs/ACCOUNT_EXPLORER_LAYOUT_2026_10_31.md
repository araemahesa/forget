# Pemilihan akun, usage dan Explorer — ForgeKit 0.1.21

## Hasil

Versi 0.1.21 dipasang di `/Applications/ForgeKit Studio.app` dan dibuka kembali pada AI Chat. Kontrol kanan topbar (usage, nama akun utama, pencarian, profil) dihapus sesuai gambar. Command palette tetap tersedia melalui Cmd/Ctrl+K dan mengembalikan fokus ke elemen asal. Tombol Karya tersimpan di header chat dihapus; data karya tidak dihapus.

Tombol folder tepat setelah tombol percakapan baru sekarang membuka Explorer live yang sama dengan adapter Studio. Snapshot terbatas tidak lagi dipresentasikan sebagai Explorer live. Pembacaan cabang, pagination, pencarian, virtualisasi, Properties, validasi epoch/map dan penolakan respons lama tetap dipertahankan. Explorer tidak tampil dari tombol global kedua. Dalam kondisi belum tersambung, panel menampilkan status serta petunjuk koneksi, tanpa struktur map palsu. Referensi dari hasil tools tetap diberi identitas snapshot; membukanya tidak mengklaim telah memilih objek live.

Pemilih provider bersama sekarang memiliki dua tahap: logo/nama provider, kemudian akun yang terhubung pada provider tersebut. Menu akun berisi identitas dan penanda utama, tanpa data atau permintaan usage. Keyboard, tombol kembali, Escape, fokus dan penempatan menu dalam viewport tetap berfungsi. Perubahan berlaku di Chat dan editor/generator yang memakai komponen bersama.

Ikon meter terpisah membuka panel usage: daftar akun, persentase terpakai, waktu reset, progress bar, identitas dan paket akun. CSS yang hilang dipulihkan menggunakan token tema merah/hitam yang ada. Panel memakai portal agar tidak terpotong composer, dengan fokus terkurung, Escape dan pengembalian fokus. Tombol tutup juga tersedia dalam tampilan ringkas. Editor prompt bersama memiliki akses ke panel yang sama.

## Verifikasi

- Typecheck lulus; 273 tes desktop dan satu tes kontrak lulus, total 274.
- Pemeriksaan browser terhadap frontend produksi dengan fixture IPC: enam kombinasi tema gelap/terang dan ukuran 1440×900, 1024×700 serta 720×450. Menu provider/akun dan panel usage tetap dalam viewport; tidak ada error halaman atau overflow horizontal yang diperiksa. Pergantian akun dan keadaan kuota tidak tersedia juga diperiksa. Fixture ini tidak membuktikan koneksi Studio atau provider nyata.
- Pada aplikasi native terpasang: menu provider muncul sebelum dua akun, tanpa usage; kedua akun asli memiliki data usage, dan memilih akun kedua mengganti rincian kuotanya. Model serta effort tersimpan kembali termuat. Tidak mengirim prompt inference.
- Tombol folder native membuka panel Explorer pada posisi yang diminta. Roblox Studio MCP melaporkan daftar Studio kosong; pemeriksaan hierarchy/Properties menggunakan tes adapter, bukan map nyata. Tidak ada map diubah.
- App/DMG arm64 lolos pemeriksaan signature ad-hoc, checksum DMG dan kesamaan executable. Belum dinotariskan atau diuji pada Mac bersih.
- Backup database konsisten serta aplikasi 0.1.20 dibuat sebelum penggantian. Hash enam tabel chat/karya tetap sama, schema 15, integrity `ok`, tanpa pelanggaran foreign-key. Tidak menghapus akun, chat atau karya.

Bukti: `docs/test-evidence/2026-10-31/account-explorer-layout/`. Script reproduksi browser: `scripts/verify_account_explorer_layout.cjs`.

## Penyesuaian 0.1.22

Kartu informasi “Roblox Studio” di dalam Explorer dihapus sesuai screenshot lanjutan. Komponen pengaturan koneksi tetap berada pada Pengaturan; panel Explorer langsung menampilkan hierarki serta Properties. Versi 0.1.22 dibangun, diverifikasi dan dipasang. Typecheck serta 17 tes Chat/Explorer lulus. Pemeriksaan native pada map tersambung mengonfirmasi kartu hilang dan 100 dari 132 root termuat melalui Explorer live, tanpa mengubah map. Hash enam tabel chat/karya tetap sama; backup database serta app 0.1.21 disimpan. Bukti: `docs/test-evidence/2026-10-31/explorer-card-removal/`. Generasi AI tidak diuji ulang untuk perubahan tampilan ini.
