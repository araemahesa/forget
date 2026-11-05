# Header dan toolbar chat — ForgeKit 0.1.6

Sesuai lima screenshot pengguna, nama map di breadcrumb, seluruh kontrol kanan header, tombol Karya tersimpan, serta tombol Explorer mengambang dihapus dari tampilan. Toolbar chat sekarang berurutan: Percakapan baru, Explorer map, Riwayat percakapan.

Tombol Explorer membuka inspector live yang sudah ada, bukan panel snapshot lama. State buka/tutup dikelola App dan diteruskan ke ChatPage serta StudioExplorer. Tidak ada event bus atau inspector tambahan. Fokus keyboard drawer tetap kembali ke pemicu. Panel snapshot hanya tetap tersedia dari rincian receipt yang merujuk snapshot tertentu. Command palette tetap bisa dibuka dengan Cmd/Ctrl+K; provider, kuota, dan akun masih tersedia melalui composer atau Pengaturan. Riwayat dan artefak tidak dihapus.

Verifikasi:

- TypeScript lulus; frontend build lulus, dengan peringatan ukuran chunk Three yang sudah ada.
- 53 tes kontrak, 265 tes desktop, 127 tes native lulus; dua tes native opt-in diabaikan sesuai konfigurasi.
- Regresi memeriksa urutan tiga tombol, hilangnya header kanan/duplikat, buka/tutup Explorer dan pengembalian fokus.
- App dan DMG arm64 0.1.6 lolos verifikasi signature, checksum image, kesamaan executable di installer dan tidak adanya harness acceptance.
- `/Applications/ForgeKit Studio.app` diperbarui dan hash executable sama dengan build. App 0.1.5 sebelumnya disimpan dalam folder `work/` chat ini.
- UI native diperiksa langsung: header bersih, pemicu di samping + membuka Explorer, hierarki live memuat 100 dari 119 root pada map saat diuji, panel bisa ditutup tanpa tombol mengambang.
- Database produksi: satu koneksi, sepuluh chat, 23 pesan, empat versi GFX, satu image, satu SFX, nol versi 3D. Jumlah sama sebelum/sesudah; SQLite integrity `ok`. Tidak ada perubahan map.

Pengujian inference AI tidak diulang. Build baru menampilkan `KEYCHAIN_LOCKED`; persetujuan Keychain macOS tetap merupakan langkah pengguna. Installer memakai signature ad-hoc dan belum notarized.
