# Pemulihan tambah akun — 30 Oktober 2026

Rilis 0.1.10 mengubah login browser Codex agar memakai halaman sukses hosted resmi (`useHostedLoginSuccessPage: true`). Callback OAuth tetap ditangani runtime Codex resmi; ForgeKit tidak menukar atau mempercayai token dari URL browser. Penantian login diperpanjang menjadi 10 menit. Login hanya disimpan setelah notifikasi sukses yang cocok dengan loginId, account/read terverifikasi dan auth.json milik profil ForgeKit tersedia. Cancellation tetap mengalahkan event sukses yang belum diproses.

Kesalahan login tidak lagi semuanya disebut dibatalkan/ditolak. Backend mengelompokkan pembatalan, sesi kedaluwarsa, callback/port, pertukaran token/jaringan, penyimpanan dan akses workspace. Pesan upstream mentah tidak diteruskan karena bisa berisi credential atau URL callback. Akun lama tidak disentuh oleh kegagalan profil baru. UI menjelaskan pemilihan Use another account dan penggunaan tab login terbaru.

Penyimpanan Keychain bersama kini memasukkan credential yang baru berhasil disimpan ke cache sesi meskipun belum ada akun yang diotorisasi dalam cache. Ini berlaku bagi koneksi API, Codex dan Google; tidak memberi akses ke credential lain dan tidak melewati otorisasi macOS.

## Bukti dan batas

Dua probe memakai runtime Codex terpasang 0.165.0-alpha.1.2 dengan direktori baru terpisah, tanpa membaca credential aplikasi lain atau menambah profil database. Login browser pada akun yang tersedia berhasil melalui halaman hosted dan halaman lokal: notification success=true dan auth.json tersimpan. Ini membuktikan alur runtime pada akun itu; kegagalan akun kedua pada screenshot belum berhasil direproduksi. Perubahan hosted menghindari ketergantungan halaman sukses lokal yang kosong, tetapi tidak diklaim membuktikan penyebab pasti kegagalan akun kedua.

Uji fixture memeriksa event sesi lama diabaikan, sukses sesi aktif dibaca ulang, kegagalan token tetap gagal, cancellation, dan redaksi error sensitif. Google tetap membutuhkan OAuth Desktop client ForgeKit terdaftar dan izin Gemini. Claude menggunakan API key resmi; Antigravity mengikuti akun upstream 9router. Belum ada credential baru untuk pengujian live tiap provider.

Kontrak resmi: [Codex App Server](https://learn.chatgpt.com/docs/app-server), bagian login browser dan account/login/completed.
