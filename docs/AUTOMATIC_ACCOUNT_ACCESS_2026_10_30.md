# Akun siap otomatis dan usage — 30 Oktober 2026

## Perubahan implementasi 0.1.11

Codex memakai profil autentikasi milik ForgeKit yang sudah dikelola runtime resmi. Referensi non-secret di Keychain tidak lagi menjadi syarat membaca katalog, limit, atau menjalankan inference. Login baru tidak membuat marker Keychain kedua. Akun lama tetap kompatibel tanpa login ulang atau memindahkan token. Direktori dibatasi pada `dev.forgekit.studio/codex-accounts/<id>`; ID, file token, ukuran, dan isi tetap diperiksa. Direktori profil/root serta auth.json berupa symlink ditolak. Token tetap di profil privat Codex; tidak dipindahkan ke SQLite atau webview. Tidak membaca auth aplikasi lain.

Untuk API key, OAuth Gemini, dan credential gateway, penyimpanan Keychain tetap digunakan. Uji koneksi kini memakai cache credential yang sudah disimpan atau diizinkan dalam sesi aplikasi, tanpa meminta ulang pembacaan OS. Pembacaan non-interaktif yang berhasil juga masuk cache per akun. Ini tidak memberikan akses ke akun lain dan tidak melewati Keychain terkunci atau penolakan macOS. Pemulihan manual hanya diperlukan jika sistem benar-benar menolak akses; autentikasi/consent resmi provider tetap harus diselesaikan.

Refresh provider otomatis tetap memuat katalog dan usage untuk setiap akun ready yang baru ditambahkan. Refresh setelah penyambungan kini membaca ulang usage meskipun percobaan sebelum verifikasi gagal beberapa detik sebelumnya. Pemulihan akses katalog juga menyegarkan usage segera, tanpa menunggu interval 30 detik. Pilihan akun/model tidak diganti otomatis; tugas aktif tetap memakai identitas semula. Provider tanpa endpoint quota tetap menjelaskan batasnya dan tidak diberi angka buatan.

## Pemeriksaan

Dua akun Codex yang sudah tersimpan diuji dari proses baru tanpa cache Keychain sesi: katalog masing-masing delapan model terbaca, usage resmi keduanya available, dengan jendela 5 jam dan mingguan. [Bukti proses baru](test-evidence/2026-10-30/automatic-account-access/cold-process-live-usage.json). Ini pengujian live, berbeda dari fixture pemuatan empat jenis koneksi di UI.

Fixture memeriksa akses profil Codex tanpa marker Keychain, profil hilang setelah dicabut, akun berbeda tidak tertukar, penolakan symlink, verifikasi ulang credential cache tanpa OS read, pemuatan otomatis akun baru, serta refresh usage setelah akses pulih. Run awal frontend memiliki satu kegagalan pada pemeriksaan refresh terbaru ketika source/test berubah selama run; log disimpan dan suite final dijalankan ulang setelah source stabil.

Status pemasangan dan hasil suite final dicatat setelah pemeriksaan bundle/native selesai. Provider API/Gemini/gateway belum diuji live dengan credential baru pada perubahan ini. Izin Keychain yang diwajibkan OS tetap berlaku untuk credential provider tersebut.
