# ForgeKit Studio 0.1.31

## Perbaikan

- Hilangkan label dan aksi akun Utama. Akun dipilih eksplisit di generator/chat; tombol Pakai akun pada pengaturan mengubah pilihan tugas baru.
- Tambahkan tombol Akun berikutnya pada pemilih untuk berganti akun pada provider yang sama dengan satu klik. Pemilih provider tetap tersedia sebelum daftar akun.
- Jalur tugas baru chat, generator, dan editor mengaktifkan rotasi otomatis untuk akun direct yang teruji pada provider, endpoint, metode login, dan model yang sama. Maksimum lima percobaan; batas total Model 3D 20 menit, maksimum request provider 10 menit.
- Akun yang diketahui habis kuota dari pembacaan terbaru dilewati hingga reset. Kuota tak diketahui diuji melalui inference; respons HTTP/SSE limit tetap mempunyai kategori yang dapat dirutekan.
- Akun dengan kelompok kuota bersama, tidak teruji, dinonaktifkan, atau sedang dipakai dilewati. Semua akun gagal menghasilkan error terminal yang meminta pilihan akun/provider lain.
- Perpindahan akun mempertahankan budget dan transcript checkpoint, memperbarui identitas akun pelaksana, dan hanya terjadi sebelum output/kandidat/operasi tool diterima. Respons parsial, timeout, dan operasi yang sudah dijalankan tidak dikirim ulang otomatis.
- Tahap generator berubah menjadi penyusunan geometri saat provider berjalan, menampilkan waktu tunggu dan petunjuk Stop. Error tugas yang dipulihkan ditampilkan, bukan hanya indikator berjalan.
- Akun terakhir yang dipakai otomatis menjadi pilihan generator berikutnya, selama pengguna belum memilih akun lain.

## Validasi

Lihat direktori `docs/test-evidence/2026-11-01/account-failover/` untuk hasil tes, build, dan pemasangan. Tes frontend penuh memakai timeout 20 detik karena tes viewport 513 objek melewati batas default 5 detik pada mesin ini. Tidak ada perubahan implementasi viewport.

## Batas

Keberhasilan inference tetap bergantung pada respons, akses model, serta kuota provider. Rotasi memakai kapasitas akun yang terhubung dan terverifikasi. 9router mengelola akun upstream sendiri. Pengujian limit menggunakan fixture; tidak menghabiskan kuota akun pengguna untuk memicu limit nyata. Uji Blender menggunakan aplikasi Blender terpasang dengan workspace terisolasi.

## Pemasangan

Versi 0.1.31 terpasang di `/Applications/ForgeKit Studio.app`, tanda tangan ad-hoc diverifikasi, dan aplikasi dibuka. Tampilan Pengaturan menunjukkan v0.1.31; pilihan akun diuji langsung. Database lolos integrity/foreign-key check; hash tabel chat dan hasil kreatif sama sebelum/sesudah pemasangan. Salinan aplikasi sebelumnya dan database tersedia di folder privat `~/Library/Application Support/ForgeKit Recovery/`. Rincian ada di `installation.json`.
