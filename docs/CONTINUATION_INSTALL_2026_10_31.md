# Kelanjutan pemulihan ForgeKit — 31 Oktober 2026

Source aktif berada di `/Users/ariardianto/Documents/ForgeKIT/CODE`; tautan `Documents/ChatGPT/ForgeKit/CODE` menunjuk ke lokasi ini. Kelanjutan dimulai dari laporan recovery-build 0.1.20. Aplikasi terpasang saat pemeriksaan awal masih 0.1.19, dan kandidat hasil pemulihan berjalan terpisah dari folder build. Tautan percakapan yang diberikan tidak menyediakan konten yang bisa dibaca; browser in-app tidak berhasil terpasang dan browser connector Chrome tidak tersedia. Catatan ini tidak mengklaim telah membaca isi percakapan tersebut.

## Perbaikan sebelum pemasangan

Pemeriksaan kandidat native menemukan model akun tersimpan tertahan oleh permintaan akses Keychain. `codex_auth::profile_id` hasil pemulihan masih memerlukan marker non-secret yang sudah dihapus sebagai persyaratan pada versi sebelumnya. Ketergantungan marker dipulihkan sesuai kontrak profil Codex milik ForgeKit: ID harus valid; akses akun tetap membaca token yang sah dari direktori privat ForgeKit. Pembacaan profil, root serta auth.json tetap menolak symlink/berkas tak sah. Login baru tidak menulis marker tambahan. Penyimpanan Keychain untuk credential provider lainnya dan pembersihan marker akun lama dipertahankan.

Konfigurasi jendela dipulihkan ke minimum 720×450. Handler drag/drop native Tauri dinonaktifkan agar frontend memakai handler HTML5 yang sudah tersedia, sesuai konfigurasi aplikasi sebelumnya. Kontrol akun/model/effort serta kualitas `high` otomatis dipertahankan.

## Bukti baru

- Typecheck lulus.
- Suite lengkap frontend: satu tes kontrak dan 272 tes desktop lulus, total 273. Jumlah ini adalah suite proyek hasil pemulihan saat ini; bukan jumlah suite historis sebelum pemulihan.
- Suite Rust berurutan: 128 lulus, tiga tes bergantung lingkungan dilewati. Dua tes tambahan menguji referensi profil tanpa marker Keychain serta validasi token dan penolakan symlink.
- Probe metadata live membaca dua akun ForgeKit yang sudah tersambung: masing-masing delapan model dan dua jendela kuota tersedia. Tidak ada prompt inference, login ulang, akses profil aplikasi lain, atau pencetakan credential.
- Backup SQLite konsisten dibuat sebelum pemasangan. Hash enam tabel chat/karya dan integrity/foreign-key check dicatat terpisah dari metadata koneksi yang dapat berubah saat aplikasi dibuka.

Bukti baru disimpan di `docs/test-evidence/2026-10-31/continuation-install/`. Bukti recovery-build sebelumnya tetap terpisah.

## Batas

Probe metadata tidak membuktikan hasil inference atau kualitas generasi media. Generasi baru, penerapan ke map, Play/Edit, seluruh alur login provider lain dan uji instalasi pada Mac bersih tidak termasuk pemeriksaan ini. Pemeriksaan native setelah pemasangan dicatat setelah paket final diverifikasi.

## Hasil pemasangan final

ForgeKit Studio 0.1.20 telah dipasang di `/Applications/ForgeKit Studio.app` dan dibuka. Paket app dan DMG lulus pemeriksaan signature ad-hoc, checksum DMG, arsitektur arm64 serta kesamaan binary di DMG. SHA-256 executable terpasang: `38839497bd13925ae5bb51a56ab1347f95d841be4e5782922d2de82851edb669`. Paket belum dinotariskan; instalasi pada Mac bersih belum diuji.

Pemeriksaan native mengonfirmasi akun utama, model GPT-6-Astra dan penalaran Xhigh terbaca tanpa permintaan marker Keychain. Halaman Animasi menampilkan mesh rig Roblox R15; preset kamera kanan dan orbit dengan drag mengubah sudut pandang 3D. Ini menguji rig serta kamera, bukan generasi motion baru. Aplikasi ditinggalkan pada AI Chat, dengan satu proses aplikasi terpasang yang berjalan. Roblox Studio belum terhubung; map tidak diubah.

Pemeriksaan SQLite setelah pemasangan lulus: schema 15, integrity `ok`, tanpa pelanggaran foreign-key. Hash keenam tabel chat/karya sama dengan sebelum pemasangan: 14 chat, 32 pesan, empat versi GFX, satu versi SFX, satu versi gambar dan nol creative-version. Backup database konsisten dan aplikasi 0.1.19 tetap tersedia di direktori pemulihan privat.
