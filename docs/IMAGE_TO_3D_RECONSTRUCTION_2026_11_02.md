# Rekonstruksi gambar lokal — ForgeKit 0.1.37

Tanggal: 2 November 2026. Jalur tetap ForgeKit → Obsidian → Blender. Tidak menambahkan layanan Meshy/Tripo atau mengunduh model neural.

## Perubahan nyata pada engine

- Primitive `reconstruction` membentuk **visual hull** dengan mengiriskan siluet 2–6 tampak ortografis konsisten pada minimal dua sumbu. Piksel referensi benar-benar menentukan geometri; bukan hanya deskripsi prompt.
- Crop kolase `[x,y,width,height]` ternormalisasi, arah kamera, latar polos/alpha asli, tolerance dan resolution 64/96/128 divalidasi di TypeScript serta Rust. Indeks gambar harus tersedia pada tugas. Maksimal empat komponen rekonstruksi dan total 200.000 triangle.
- Segmentasi memisahkan komponen utama, membatasi biaya gambar, menguji proporsi dan konsistensi siluet. Input tidak sesuai ditolak dengan alasan; tidak diganti kubus.
- Permukaan dihaluskan dan disederhanakan ke target 12k/24k/48k triangle per komponen sesuai resolusi dan sisa budget. Sambungan non-manifold ditolak.
- Warna sumber diproyeksikan sebagai vertex color dalam ruang linear. Warna disimpan pada .blend, shader dan preview Three.js. Rencana impor EditableMesh mempertahankan warna dan konversi sRGB, termasuk lintas batas mesh/chunk. Upload Roblox aktual belum diuji pada pekerjaan ini.
- File .blend dibuka ulang sebelum diterima. Referensi ditanam dalam file. Rekonstruksi dirender dari depan/kanan/atas; teknik lama mempertahankan tiga perempat/depan/kanan.
- Cache mencakup hash helper rekonstruksi. Timeout Blender rekonstruksi 300 detik, pembatalan tetap tersedia. Batas ukuran file dan integritas artefak tetap berlaku.
- Review visual maksimal high=4, balanced=3, fast=2 dalam checkpoint dan budget global yang sama. Review `revise` tetap berarti perlu perbaikan, bukan lulus kemiripan.
- Obsidian: core skill model-3d 1.7.0 disinkronkan dengan registry; enam panduan terarah diperbarui, source index 79 file diperbarui. Tidak menambah node kosong untuk mengklaim kecerdasan.

## Bukti dan pengujian

Bukti: [folder pengujian](test-evidence/2026-11-02/image-reconstruction/).

| Pemeriksaan | Hasil |
|---|---|
| TypeScript typecheck | Lulus |
| Seluruh frontend, satu worker | 346 tes / 62 file lulus |
| Rust unit suite | 160 lulus; 9 tes integrasi diabaikan secara default |
| Native runner Blender aktual, lama dan rekonstruksi | 2 lulus; buka ulang, preview berwarna, rencana impor, cache dan penolakan file berubah |
| Siklus feedback render + revisi + resume | 1 lulus dengan server fixture HTTP lokal; bukan provider eksternal |
| Routing Obsidian dan budget konteks | 8 lulus termasuk tes vault aktual; tanpa backfill yang menulis hasil baru |
| Helper vault | 13 lulus |
| Verifikasi vault | 272 catatan, 1.437 tautan, 25 core skills, 20 custom skills; nol error |
| Subdivision lama | Level 0: 12 triangle; level 2: 192 triangle; file dibuka ulang dan preview cocok |

Pengujian frontend pertama mengalami satu timeout 5 detik ketika berjalan paralel pada Mac 8 GB. Tes itu lulus sendiri dan seluruh suite lulus dengan satu worker; timeout global tidak dinaikkan. Pencarian tes `CreativeControls.test.tsx` menemukan tidak ada file tersebut; perubahan caption diperiksa oleh typecheck, build dan pembacaan UI setelah pemasangan. Tes Model3dPage/SkyboxPage diuji ulang untuk regresi tampilan, tetapi mereka memock CreativeControls. Kesembilan tes tersebut lulus; caption baru juga dibaca langsung pada aplikasi terpasang.

### Fixture rekonstruksi Blender aktual

Objek uji independen: bentuk L bertingkat dengan lubang tembus, tiga gambar ortografis RGBA dan aksen putih pada permukaan merah. Ini **fixture sintetis**, bukan referensi hiu pengguna.

- 23.520 triangle / 11.760 vertex; manifold; tiga referensi ditanam; .blend dibuka ulang.
- Pembentukan volume dan warna: sekitar 1,7 detik pada run fixture; waktu ini tidak mencakup seluruh startup, render, penyimpanan atau panggilan provider.
- Ray-cast membuktikan lubang benar-benar kosong dan daerah solid memiliki geometri.
- IoU siluet **render akhir**: depan 1,0000; kanan dan atas 0,9996. Baseline kubus depan 0,7381. Ini tidak menjadi persentase kemiripan 3D.
- Warna sumber tersimpan setelah konversi sRGB ke linear. Detail kecil masih dipengaruhi densitas vertex dan resolusi voxel.
- Alpha opaque, siluet kosong, proporsi tidak cocok dan siluet antar-sudut tidak konsisten ditolak.
- Angka `silhouetteIou` di metrics engine mengukur konsistensi **voxel sebelum smoothing**, berbeda dari render akhir yang diukur khusus dalam fixture.

Detail: [acceptance.json](test-evidence/2026-11-02/image-reconstruction/stepped-solid/acceptance.json).

## Cara memakai

Lampirkan tampak depan dan samping, lebih baik ditambah atas. Gunakan objek dengan pose sama, kamera tanpa perspektif, latar polos/transparan dan sedikit ruang kosong di sekitar siluet. Beberapa panel dalam satu gambar dapat dipisahkan melalui crop. Jika panel berbeda pose atau memakai perspektif kuat, gunakan mesh/cage dan pemeriksaan manual; jangan memaksakan visual hull.

Contoh prompt:

> Buat satu model dari gambar ortografis depan, kanan dan atas yang saya lampirkan. Gunakan rekonstruksi siluet lokal dan warna referensi, resolution 96. Cocokkan crop, arah kamera dan rasio ukuran sebelum membangun. Periksa render Blender, geometri bukaan dan batas warna. Jelaskan bagian tersembunyi yang diinterpretasikan; jangan menyatakan 100% cocok.

Satu foto perspektif belum didukung sebagai rekonstruksi neural seperti Meshy. Siluet tidak menentukan rongga tersembunyi, anatomi internal, detail kulit, UV/albedo bersih, rig atau semua sisi objek. Warna proyeksi masih membawa pencahayaan gambar. Foto hiu enam panel sebelumnya memuat perspektif dan pose yang tidak konsisten untuk pengukuran ortografis; model hiu belum direkonstruksi ulang atau dinyatakan cocok oleh pekerjaan ini. Recipe hiu lama dibangun kembali tanpa mengubah geometri untuk memastikan kompatibilitas preview aplikasi setelah perubahan cache. Screenshot terbaru adalah graph Obsidian, bukan referensi objek.

## Pemasangan dan data

ForgeKit 0.1.37 terpasang di `/Applications/ForgeKit Studio.app` dan dibuka kembali. Signature ad-hoc dan hash executable terverifikasi. Installer membuat backup aplikasi 0.1.36 dan salinan SQLite konsisten. Isi enam tabel chat/artefak sama sebelum, sesudah pemasangan dan setelah pembacaan UI; integrity_check=ok, tanpa pelanggaran foreign key.

Pembacaan UI membuktikan caption baru tampil, Obsidian terhubung dan Blender terdeteksi. Preview hiu lama 15.124 triangle berhasil dibangun kembali; ini uji kompatibilitas, bukan hasil rekonstruksi baru atau bukti kemiripan. Screenshot: `installed-model3d.png`. Tombol Masukkan ke Studio tidak digunakan.

Receipt canonical: `test-evidence/2026-11-02/image-reconstruction/installation.json`; pemeriksaan lanjutan: `post-ui-verification.json`. Backup aplikasi/database: `/Users/ariardianto/Library/Application Support/ForgeKit Recovery/2026-11-02-image-reconstruction-install-1793632575657801000/`. Backup vault tercatat di `vault-backup.json`. Tidak mengunggah atau menerapkan model ke map Roblox dalam pengujian ini.
