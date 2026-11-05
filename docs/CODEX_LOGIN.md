> Aktif 30 Oktober 2026, 0.1.11: profil Codex milik ForgeKit dibaca langsung oleh runtime resmi untuk katalog, usage dan inference. Marker referensi Keychain dari rilis lama tidak lagi diperlukan; login baru tidak menambah marker. API key/OAuth provider lain tetap memakai Keychain dan cache per akun. [Implementasi dan penerimaan](AUTOMATIC_ACCOUNT_ACCESS_2026_10_30.md).

# Login ChatGPT melalui Codex di ForgeKit

28 Oktober 2026. Jalur baru ini memakai managed login resmi Codex app-server, dengan profil tersendiri untuk setiap koneksi ForgeKit. Ini berbeda dari token Sign in with ChatGPT untuk Responses API yang sebelumnya menghasilkan HTTP 401 saat membaca quota backend.

## Cara menggunakan

Di Pengaturan → Provider AI → OpenAI, tombol Connect/Tambah akun memulai login ChatGPT melalui Codex. Selesaikan autentikasi pada browser resmi yang dibuka. ForgeKit menunggu notifikasi `account/login/completed`, memeriksa akun, membaca katalog model, menyimpan koneksi baru, dan menguji respons teks singkat. Login ChatGPT kini hanya menggunakan Codex. Tombol login standar, formulir salin sesi/cookie, command sesi web, dan implementasi login SIWC lama sudah dihapus. Permintaan metode lama dari frontend lama ditolak oleh backend; parameter metode yang kosong memulai login Codex.

Usage dibaca memakai `account/rateLimits/read` dari profil akun tersebut. Periode dan reset mengikuti respons provider; tidak ada asumsi bahwa setiap paket selalu mempunyai dua jendela. Pembacaan berlangsung saat daftar dibuka, selama terlihat, saat aplikasi kembali aktif, dan setelah tugas melalui layanan usage yang sudah ada. Katalog dari app-server dapat berasal dari cache; uji teks memverifikasi model yang dipilih, bukan seluruh model dalam katalog.

## Penyimpanan dan isolasi

- macOS: `~/Library/Application Support/dev.forgekit.studio/codex-accounts/<id-koneksi>/`.
- Root/profil berizin 0700; `auth.json` berizin 0600. Token dan refresh dikelola Codex dalam profil ini. Rilis sebelum 0.1.11 menyimpan marker referensi non-secret di Keychain. Rilis 0.1.11 tidak memerlukan marker tersebut; login aplikasi lain tetap tidak disalin.
- Setiap subprocess memakai `CODEX_HOME` yang ditentukan backend. Environment lain dibersihkan; direktori kerja adalah profil milik ForgeKit. Akun, cookie, dan konfigurasi login Orca atau `~/.codex` tidak diimpor.
- Pembaruan token, katalog, dan limit diserialkan per akun. Putuskan akun menjalankan logout profil tersebut dan membersihkan direktori kredensialnya.
- Login dapat dibatalkan. Proses dihentikan saat selesai/gagal, ketika dibatalkan, atau saat ForgeKit keluar. Pesan error tidak meneruskan payload autentikasi atau URL login ke log/UI.

## Eksekusi tugas

Koneksi `codex_oauth` memakai adapter Responses pada endpoint Codex, token dan `ChatGPT-Account-Id` dari profil yang sama. Pesan system dipetakan ke instructions dan parameter yang tidak didukung endpoint Codex tidak dikirim. Model serta reasoning tetap diambil dari pilihan tugas. Tool loop dan pembatasan target Roblox yang sudah ada tetap melalui gateway native ForgeKit.

Runtime Codex harus tersedia pada perangkat. Backend mencari executable Codex CLI yang terpasang, termasuk runtime dalam aplikasi ChatGPT/Codex; yang digunakan hanya executable. Build ini belum menyertakan binary Codex untuk distribusi mandiri. Jika runtime tidak tersedia, UI menjelaskan dependensi tersebut dan tidak menyatakan akun tersambung.

## Verifikasi

Unit test mencakup isolasi `CODEX_HOME`, korelasi respons RPC, redaksi error, penutupan subprocess, penolakan path/URL asing, katalog model, expiry token, dan format request inferensi. Tes UI memastikan Connect OpenAI memilih metode Codex tanpa meminta cookie.

Uji live tetap memerlukan pengguna menyelesaikan login baru. Keberhasilan unit test atau build tidak membuktikan persentase akun dapat dibaca. Gunakan `examples/codex_login.rs` hanya untuk acceptance yang secara eksplisit memulai login baru: ia menyimpan koneksi baru, menguji inferensi singkat, dan mencetak hasil usage tanpa identitas atau kredensial.

Referensi resmi: [Codex app-server — authentication dan rate limits](https://learn.chatgpt.com/docs/app-server).

## Hasil live sesi ini

Pengguna menyelesaikan login baru di browser melalui acceptance runner native yang menggunakan implementasi login ForgeKit yang sama. [Bukti live](test-evidence/codex-login-live-20261028.json): akun Plus, delapan model, respons inferensi streaming berhasil, dan dua jendela limit berstatus `available`. Pada waktu pemeriksaan provider melaporkan 1% terpakai untuk 300 menit dan 13% terpakai untuk 10080 menit, dengan reset masing-masing. Angka berubah mengikuti penggunaan akun; nilai tersebut tidak dijadikan default kode.

Saat uji login awal, akun SIWC lama masih disimpan secara terpisah. Sesuai permintaan pengguna berikutnya, koneksi lama dan kredensial lokalnya sudah dilepas melalui command native ForgeKit, dan akun Codex dijadikan utama. Database aktif kini berisi satu akun Codex, aktif dan terverifikasi. Pengujian antarmuka juga menemukan dan memperbaiki panel Usage yang sebelumnya mengembalikan pilihan akun ke default pada setiap klik.

[Screenshot aplikasi native pada 19.51 WIB](screenshots/provider-usage/codex-usage-live-20261028-1951.png) memperlihatkan dropdown akun Codex dengan 99% tersisa untuk 5h dan 87% untuk mingguan, waktu reset, serta waktu pemeriksaan baru. Ini berasal dari build release yang memakai IPC dan koneksi asli, bukan harness fixture visual. Build ini dibuka dari `CODE/apps/desktop/src-tauri/target/release/bundle/macos/ForgeKit Studio.app`. Salinan terpisah di `/Applications/ForgeKit Studio.app` masih memakai implementasi lain yang belum mendukung koneksi ini; installer di luar workspace tidak ditimpa.

[Probe setelah akun lama dihapus](test-evidence/codex-only-live-20261028.json) kembali membaca satu akun Plus melalui Codex, delapan model, serta dua jendela limit dengan status available. Validasi setelah penghapusan alur lama: 51 tes kontrak, 235 tes desktop, dan 89 tes Rust lulus. Jumlah tes Rust berubah karena tes yang khusus menguji implementasi SIWC/cookie yang dihapus ikut dihapus; ditambahkan regresi untuk menolak metode lama dari klien lama. Riwayat chat tidak dihapus.

[Pemeriksaan akhir](test-evidence/codex-only-cleanup-20261028.json) dan [screenshot build terbaru](screenshots/provider-usage/codex-only-20261028.png) memastikan satu akun Codex utama, tombol login standar/formulir sesi lama tidak ada, serta kuota tetap terlihat melalui IPC native. Typecheck, build aplikasi/DMG, dan verifikasi bundle lulus.
