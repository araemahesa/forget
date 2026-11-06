# Pengaturan ringkas — ForgeKit 0.1.23

## Perubahan

Pengaturan dibatasi hingga lebar 1120px dengan jarak antarbagiannya konsisten. Akun Discord dan Tampilan berada dalam dua kartu yang sejajar pada jendela besar dan tersusun vertikal pada jendela kecil. Katalog provider memakai logo vektor, satu baris metode koneksi dan tombol berukuran seragam.

Kartu akun memisahkan identitas, status utama/cadangan, kuota, model/penalaran serta tindakan pengelolaan. Informasi provider/model yang berulang dipindahkan ke Detail akses. Kuota tetap tampil dengan persentase tersisa dan reset, tanpa dua baris waktu pemeriksaan yang berulang. Keadaan gagal atau data tidak tersedia tetap ditampilkan. Pemilih model, akun utama, uji koneksi, putuskan koneksi dan fallback mempertahankan handler serta validasinya.

Konfigurasi Google dan penjelasan penggunaan akun dipindahkan ke Pengaturan lanjutan. Penjelasan urutan serta batas fallback berada dalam Detail fallback. Konfigurasi Discord dan koneksi Studio/penyimpanan tetap tersedia pada disclosure masing-masing. Teks ringkas di halaman utama tidak mengganti informasi izin atau biaya pada alur pengaturan koneksi.

## Pemeriksaan

- Typecheck lulus.
- 273 tes desktop dan satu tes kontrak lulus, total 274.
- Sepuluh pemeriksaan visual frontend produksi dengan fixture IPC: tema gelap/terang pada 1920×1080, 1440×900, 1280×800, 1024×700 dan 720×450. Tidak ada overflow halaman/kartu akun atau elemen preview tema yang keluar. Form API dapat dibuka, ditutup dengan Escape dan mengembalikan fokus. Pemeriksaan ini tidak mengirim inference atau mengubah akun nyata.
- Komponen shared ProviderUsageDetails mempertahankan tampilan lengkap sebagai default; mode ringkas hanya dipakai kartu akun Pengaturan.

Bukti: `docs/test-evidence/2026-10-31/settings-layout/`. Reproduksi visual: `scripts/verify_settings_layout.cjs`.

## Pemasangan dan pemeriksaan native

App/DMG 0.1.23 arm64 lulus pemeriksaan signature ad-hoc, checksum DMG serta kesamaan executable. Aplikasi telah dipasang di `/Applications/ForgeKit Studio.app` dan dibuka pada Pengaturan. Kartu Discord/Tampilan, logo provider, kuota dua akun asli serta model/penalaran tersimpan telah diperiksa pada aplikasi native. Pengaturan lanjutan tertutup secara default. Data chat/karya identik menurut hash enam tabel, schema 15, integrity `ok`, tanpa pelanggaran foreign-key. Backup database dan aplikasi 0.1.22 disimpan di direktori pemulihan privat. Tidak mengubah map, mengganti akun utama, mengirim inference, atau menguji ulang login provider. Paket belum dinotariskan; Mac bersih belum diuji.
