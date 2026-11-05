# Produksi Model 3D — ForgeKit Studio 0.1.27

Permintaan pengguna: meningkatkan bentuk besar dan kecil, detail serta warna objek 3D di ForgeKit dan Obsidian. Implementasi memperluas recipe, renderer dan runner Blender nyata; tidak memasang generator tekstur/material yang telah dihapus.

## Kemampuan dan alur

Prompt/referensi dibaca oleh provider pilihan dengan skills dan konteks vault adaptif. Panduan 3D merancang silhouette dan proporsi, konstruksi menengah, lalu detail yang terlihat pada jarak penggunaan. Warna/bahan mengikuti prompt tanpa tema atau palet global. Revisi mempertahankan ID dan bagian yang disetujui. Default prompt fantasy di halaman Model 3D dihapus untuk pengguna baru; draft pengguna tidak dihapus.

- Model maksimal 128 part, naik dari 64. Profil fast/balanced/high untuk model adalah 32/64/128; anggaran fitur lain tetap. Batas 200000 triangle dipertahankan dan diperiksa sebelum ekspor.
- Ukuran minimum part 0.001 stud, maksimum 1000 per sumbu. Minimum teknis bukan anjuran detail mikroskopis.
- Cube dapat memakai bevel dalam stud, maksimal seperempat sisi terkecil. Geometri bevel dibangun di Blender pada ukuran aktual sebelum rotasi. Preview memakai RoundedBoxGeometry; triangulasi dan shading preview dapat berbeda dari Blender.
- Sphere/cylinder/cone/torus menerima segments integer 8..64. Resolusi default preview disamakan dengan runner, smooth/faceted dapat dipilih dan caps silinder tetap datar.
- Roughness, metalness, opacity dan emissiveIntensity opsional per part; nilai invalid/null dan field asing ditolak. Emission dibatasi 0..5, nilai permukaan lain 0..1.
- Satu tabel preset material JSON digunakan preview dan Blender. Base color #RRGGBB sRGB dikonversi sekali ke linear. Blender memakai kembali material dengan warna/permukaan sama.
- Kontur menolak persilangan, titik penutup berulang, rongga keluar, bersentuhan, bertumpuk dan bersarang. Kasus penerimaan frontend/native memakai fixture yang sama. Total titik kontur dibatasi 8192.
- Kamera fokus menyesuaikan benda besar/kecil, near/far clipping dan jarak orbit mengikuti skala. Preview mendapat environment studio netral untuk membaca bahan metalik dan warna.
- Statistik menampilkan model yang sedang terlihat, termasuk hasil Blender, bukan selalu recipe.

Recipe legacy tanpa field opsional tetap diterima. Ekspor tersimpan tidak dihapus. Kunci cache Blender mencakup script, tabel material dan recipe sehingga perubahan runner tidak memakai hasil lama yang tidak cocok. Build lama tetap berada di folder ekspornya.

Provider Model 3D memperoleh batas output 4096/16384/24576 sesuai profil; request engine menerima maksimum 32768. Budget ini diikat ketika checkpoint baru dibuat. Batas waktu, jumlah panggilan, budget kumulatif dan checkpoint lama tidak direset. Akun/model/effort tidak diganti. Codex OAuth tetap mengikuti protokol adapter yang tidak mengirim max_output_tokens. Dukungan panjang keluaran bergantung model/provider; pembaruan tidak menjamin setiap provider menyelesaikan model maksimal dalam satu respons.

Versi final dan revisi editor Model 3D dibangun melalui Blender sebelum disimpan. Revisi dapat dihentikan tanpa menghilangkan versi sebelumnya; build berjalan di luar mutex storage. Custom profile, bevel, resolusi/shading atau permukaan khusus memerlukan impor mesh GLB/FBX. Backend dan UI mencegah tombol Terapkan mengganti detail tersebut dengan primitive native.

## Obsidian

Skills model-3d dan material-texture menjadi versi 1.5.0. Material-texture dipilih otomatis sebagai dukungan 3D dan secara eksplisit mempertahankan kontrak Model3dRecipe. Panduan legacy tekstur tidak menjadi generator baru.

Vault memiliki lima panduan baru: Model 3D Makro Meso Mikro, Topologi Ketebalan dan Sambungan, Palet dan Permukaan 3D, Katalog Teknik 3D, serta Inspeksi dan Ekspor 3D. Panduan fitur/rubrik ditulis ulang untuk general, source index diperluas, dan mirror skills disamakan. Pemilihan adaptif memuat panduan ini pada tugas 3D di generator maupun AI Chat.

## Bukti pemeriksaan

Direktori bukti: `docs/test-evidence/2026-11-01/model3d-quality/`.

- Typecheck dan 302 tes frontend lulus; termasuk GLB round-trip warna/PBR, bevel panel tipis, detail 0.001 stud, 12 kasus kontur dan framing skala 0.001..1000.
- 139 tes Rust standar lulus, lima tes lingkungan tidak dijalankan oleh suite standar. Enam tes Obsidian termasuk dua probe vault nyata dijalankan terpisah dan lulus. Satu tes Blender native nyata menguji build, cache dan deteksi file yang dirusak.
- Fixture Blender terisolasi menghasilkan 17 mesh, 8 material dan 2500 triangle. .blend, GLB, FBX dibuka ulang oleh Blender 5.2.3 LTS; jumlah mesh, ukuran, vertices dan normals finite sesuai. Albedo linear, roughness, metalness, alpha dan emission GLB cocok dengan recipe/preset. Raycast memastikan rongga profil terbuka dan dindingnya solid.
- Fixture 128 part berhasil memakai satu material bersama, 24064 triangle. Fixture dengan tessellation berlebih ditolak dan tidak menghasilkan GLB final.
- Render inspeksi berasal dari .blend fixture nyata melalui Cycles CPU. Fixture disusun untuk pengujian engine, bukan hasil inference provider atau janji semua output memiliki kualitas artistik tertentu.

Vault akhir berisi 114 catatan, 516 tautan internal dan 24 skills; tidak ada error verifikasi. Probe campuran memakai 62 catatan dan 86513 byte isi, di bawah batas 96 KiB. Aplikasi 0.1.27 terpasang di /Applications/ForgeKit Studio.app; signature ad-hoc dan checksum sesuai build. Hash enam tabel chat/karya identik sebelum/sesudah pemasangan, integrity ok dan tanpa pelanggaran foreign-key. Detail dicatat dalam log/laporan JSON pendamping. Backup source dan vault dibuat sebelum perubahan; aplikasi/database sebelumnya disimpan saat pemasangan.

## Batas pemeriksaan

Tidak ada inference provider, upload, publish atau perubahan map Roblox selama pekerjaan ini. Tes material mengecek nilai file; lighting/renderer/importir yang berbeda dapat memberi tampilan pixel berbeda. GLB menjadi acuan parameter PBR, sedangkan OBJ geometri saja; FBX/Studio perlu pemeriksaan material ulang. Tidak ada jaminan otomatis UV, rig, sculpt organik kompleks, collision, performa perangkat atau kesamaan referensi.

## Referensi teknis

Material preview mengikuti [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html), bevel preview memakai [RoundedBoxGeometry](https://threejs.org/docs/pages/RoundedBoxGeometry.html). Pembuatan bevel runner memakai modifier geometri, dengan prinsip radius/segment dan overlap pada [dokumentasi Blender](https://docs.blender.org/manual/en/4.4/modeling/modifiers/generate/bevel.html); perilaku aktual diuji pada Blender lokal 5.2.3 LTS.

Pemeriksaan native setelah pemasangan membuka halaman Model 3D: Blender terdeteksi, viewport WebGL tampil, composer kosong tanpa preset fantasy dan kontrol kamera tersedia. Tidak ada artefak uji yang dimasukkan ke library pengguna. Akun/model yang tersimpan tidak diubah.
