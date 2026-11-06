# Pilihan akun eksplisit — ForgeKit 0.1.9

Opsi dan grup “Ikuti pilihan utama aplikasi” dihapus dari pemilih bersama. AI Chat, generator dan editor memakai daftar akun nyata, dikelompokkan menurut provider, dengan logo dan usage seperti sebelumnya. Preferensi `inherit` lama dimigrasikan satu kali ke ID akun utama yang tersedia. Setelah itu perubahan akun utama tidak mengalihkan pilihan fitur tersebut. Akun yang dilepas harus dipilih ulang secara eksplisit; tidak ada fallback diam-diam.

Pengaturan menyediakan penambahan beberapa profil pada provider yang sama. Setiap profil langsung memakai ID dan referensi Keychain unik. OpenAI memakai profil login Codex khusus per akun, Google memakai pemilih akun OAuth resmi, dan koneksi API dapat ditambahkan terpisah melalui kontrol lanjutan. Tombol utama Claude kini membuka formulir API yang benar, dengan akses ke Claude Console; membuka browser saja tidak lagi tampak sebagai proses menghubungkan inference yang lengkap. Formulir memberi nama akun berurutan dan tidak menimpa akun lama.

Saat akun pertama mencapai limit, pilih akun tersambung lain di composer, periksa model/effort akun tersebut, lalu kirim tugas baru. Resume tugas lama tetap memakai akun/model yang ditangkap saat mulai, untuk menjaga checkpoint dan mencegah replay write. Antigravity mengikuti akun upstream yang dikelola 9router; beberapa profil gateway tidak membuktikan akun upstream atau kapasitas terpisah. Kunci API dalam project/organisasi yang sama juga dapat berbagi kuota.

## Verifikasi

- Typecheck dan 22 tes fokus: lulus.
- Suite frontend penuh: 53 tes kontrak dan 278 desktop lulus.
- Tes baru memeriksa daftar tanpa opsi otomatis, pergantian ke akun kedua, migrasi preferensi lama, pilihan tetap saat akun utama berubah, akun hilang tanpa fallback, dan formulir Claude.
- Tes SQLite menggunakan dua profil untuk masing-masing OpenAI, Claude, Google/Gemini, OpenAI-compatible dan Antigravity: memeriksa penyimpanan, pergantian primary dan penolakan referensi credential ganda. Ini fixture lokal, bukan lima login provider live.

- Suite Rust berurutan: 130 lulus, tiga tes live/decoder opt-in diabaikan. Run paralel pertama gagal pada transport dan satu server fixture menunggu tanpa koneksi. Pembacaan credential memakai mutex `try_lock`; fixture yang mengakses Keychain bersamaan dapat ditolak sementara. Run paralel dihentikan dan log kegagalannya disimpan; hasil berurutan tidak diklaim sebagai keberhasilan run paralel.
- `pnpm build` lulus dalam build Tauri final. Verifier memeriksa versi 0.1.9, arm64, codesign ad-hoc, CRC DMG dan kesamaan executable app dengan DMG. Belum dinotarisasi atau diuji pada Mac bersih.
- App final dipasang di `/Applications/ForgeKit Studio.app`; hash cocok dengan bundle. Seluruh 32 tabel SQLite mempunyai jumlah dan hash yang sama sebelum/sesudah pemasangan, integrity check `ok`. App 0.1.8 dipindahkan ke Trash; tidak ada data pengguna atau perubahan Git yang dihapus.

Tidak ada akun baru atau credential pengguna yang dibuat oleh pengujian fixture. Dua login nyata untuk setiap provider belum tersedia untuk diverifikasi; ini tetap batas bukti live, bukan klaim bahwa kuota setiap provider independen.

[Bukti tes dan pemasangan](test-evidence/2026-10-30/multi-account/installation.json), [frontend](test-evidence/2026-10-30/multi-account/frontend.log), [Rust berurutan](test-evidence/2026-10-30/multi-account/rust-serial.log), [run paralel yang dihentikan](test-evidence/2026-10-30/multi-account/rust-parallel-interrupted.log), [bundle](test-evidence/2026-10-30/multi-account/bundle.json).

Pemeriksaan native 0.1.9: halaman Provider AI menunjukkan tombol Tambah akun OpenAI, formulir Claude dengan nama akun terpisah, sembilan model dari akun tersimpan, serta limit resmi 5h dan mingguan. Katalog pulih setelah tindakan foreground Izinkan akses akun. Tidak ada credential baru yang dimasukkan.

Saat pemeriksaan awal, menu composer terdeteksi expanded tetapi tidak terlihat. Pengukuran native pada build diagnostik menunjukkan ukuran/posisi sah dan opacity nol pada frame awal animasi. Fade opacity dihapus; pengujian native ulang membuktikan kartu akun terlihat tanpa grup pilihan otomatis. Menu kini juga memakai koordinat layout viewport dan anchor atas langsung ke tombol. Empat tes Dropdown lulus setelah perubahan terakhir. Diagnostik sementara dihapus dari source sebelum rilis final. Fixture browser produksi menggunakan empat akun terpisah untuk memeriksa kelompok/usage; angka fixture bukan data live.
