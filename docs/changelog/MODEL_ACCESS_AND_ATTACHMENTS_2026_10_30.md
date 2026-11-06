# Pemulihan model dan lampiran chat — ForgeKit 0.1.7

Masalah: koneksi akun tersimpan sebagai ready, tetapi katalog dan inference gagal dengan `KEYCHAIN_LOCKED` setelah aplikasi diperbarui. Panel referensi berada di luar form dan memakai kontrol file native yang memenuhi halaman.

## Perbaikan

- Pembacaan Keychain interaktif sekarang menyimpan hasil persetujuan dalam memori proses, terpisah per referensi credential. Ini memungkinkan pilihan macOS **Allow** yang berlaku untuk satu pembacaan dipakai oleh katalog dan inference pada sesi aplikasi yang sama. Cache diperbarui ketika credential ditulis dan dihapus ketika credential dilepas. Tidak ada salinan credential baru di disk.
- Refresh latar tetap noninteraktif. Saat dialog izin sedang berlangsung, pembacaan latar mengembalikan status terkunci, bukan menunggu mutex tanpa batas.
- Command katalog menerima `authorize` opsional, default noninteraktif. Hanya tombol foreground **Izinkan akses akun** atau refresh pada kondisi terkunci yang meminta persetujuan macOS untuk akun tersimpan yang dipilih. Tidak ada perpindahan akun/model otomatis.
- Model dan pengiriman ditahan saat loading atau akses terkunci. Akun tetap ditampilkan sebagai akun yang sudah dipilih, dengan tindakan pemulihan langsung pada form.
- Panel **Referensi & model 3D** di luar form dihapus. Ikon gambar berada di samping textarea. Thumbnail, jumlah lampiran, penghapusan dan pesan validasi berada di dalam composer. Batas tiga gambar, validasi PNG/JPG/WebP serta pengiriman ke provider pilihan tetap berlaku. Status Blender tetap tersedia di halaman Model 3D.

## Verifikasi kode

- TypeScript dan build frontend lulus; peringatan ukuran chunk Three yang sudah ada tetap muncul.
- Suite lengkap: 53 tes kontrak, 268 tes desktop dan 128 tes native lulus; dua native opt-in diabaikan. Dua regresi UI tambahan serta 19 tes terkait juga lulus setelah perubahan akhir.
- Regresi memeriksa pemisahan cache otorisasi per akun, pemulihan katalog tanpa mengganti model, tombol pemulihan langsung, letak lampiran di composer, preview/hapus, serta penolakan empat referensi.
- Tidak ada migrasi database atau dependensi baru.

Pemeriksaan instalasi dan akun nyata dicatat setelah verifikasi paket akhir. Persetujuan dialog Keychain merupakan tindakan pengguna; aplikasi tidak mengubah ACL atau melewati proteksi macOS.
