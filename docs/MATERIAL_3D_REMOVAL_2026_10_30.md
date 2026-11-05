# Penghapusan Material 3D — 30 Oktober 2026

## Perubahan

Mode Material 3D (SurfaceAppearance), pemilih Material/Tekstur, dan halaman layer PBR dihapus. Menu Studio Kreatif sekarang menampilkan Tekstur dan langsung membuka Generator Tekstur. Halaman Material 3D dan wrapper dua mode tidak lagi masuk bundle produksi.

Rute internal `#create/material` dipertahankan untuk kompatibilitas. Alias `texture`, `textures`, `texture3d`, serta query mode lama mengarah ke editor Tekstur yang sama. Shortcut render/simpan tekstur tetap mengenali rute tersebut.

Data, kontrak material historis, serta backend penyimpanan dipertahankan agar penghapusan UI tidak menghapus karya. Properti material pada Model 3D dan generator lain tidak diubah.

## Verifikasi

ForgeKit **0.1.13** terpasang di `/Applications/ForgeKit Studio.app`. Aplikasi 0.1.12 dipindahkan ke Trash dan tidak dihapus permanen.

- Typecheck dan build lulus; 53 tes kontrak, 283 desktop dan 133 Rust lulus, tiga tes opt-in diabaikan.
- App/DMG lulus pemeriksaan versi, arm64, signature ad-hoc, CRC dan kecocokan executable di DMG. Notarization dan pemasangan mesin bersih tidak diuji.
- Seluruh 32 tabel database schema 15 memiliki jumlah baris dan hash identik sebelum/sesudah pemasangan dan peluncuran. Integrity `ok`, tanpa pelanggaran foreign key.
- UI native menampilkan menu Tekstur dan heading Generator Tekstur; heading Material 3D serta pemilih mode tidak ada. Awalnya screenshot editor kosong walaupun AX memuat kontennya. Zoom jendela lalu pengembalian ukuran memulihkan gambar; penyebabnya belum dipastikan dan tidak ada perubahan kode untuk observasi ini.
- Generasi provider dan penerapan ke Roblox tidak diuji ulang untuk penghapusan UI ini.

Bukti: [verification.json](test-evidence/2026-10-30/material-removal/verification.json), [installation.json](test-evidence/2026-10-30/material-removal/installation.json), [bundle.json](test-evidence/2026-10-30/material-removal/bundle.json), serta log typecheck, frontend, Rust, build dan release dalam direktori yang sama.
