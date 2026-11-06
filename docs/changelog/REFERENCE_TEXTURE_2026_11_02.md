# Image-to-3D dan tekstur referensi — ForgeKit 0.1.39

Permintaan: meningkatkan bentuk, detail, pewarnaan dan penggunaan skills/tools pada ForgeKit serta Obsidian. Screenshot pengguna memperlihatkan graph Obsidian; graph itu bukan gambar objek untuk direkonstruksi.

## Perubahan engine

Rekonstruksi visual hull dari 2–6 tampak ortografis konsisten tetap menjadi jalur lokal berbasis piksel. Pipeline kini menghasilkan UV per face dan atlas warna sRGB yang benar-benar dipaketkan ke `.blend`, dipakai shader Blender dan dikirim bersama UV ke preview ForgeKit. Warna vertex tetap disimpan untuk fallback dan kompatibilitas impor lama.

Pemilihan tampak menguji arah normal, foreground dan ray visibility pada geometri nyata. Warna tidak diproyeksikan melalui permukaan yang tertutup. Satu tampak per face menjaga motif agar tidak kabur oleh campuran warna beberapa kamera. Padding warna di sekitar siluet mengurangi kontaminasi background. Sisi tanpa bukti memakai warna dasar recipe, dengan cakupan observasi dicatat pada metrics.

Atlas dibatasi 2048 × 2048 dan total empat megapiksel per model. Maksimum empat komponen rekonstruksi berbagi anggaran itu. Detail akhir tetap dibatasi resolusi input, sudut pengamatan, kepadatan geometri dan alokasi atlas. Tidak ada super-resolution atau tekstur sisi tersembunyi yang dikarang.

Preview hanya menerima PNG tertanam dengan dimensi header sesuai, UV finite dalam bounds, maksimum empat tekstur dan anggaran piksel gabungan. URL remote ditolak. GPU resources dibuang ketika model diganti; kegagalan decode memakai fallback vertex colors. File/hash dan cache meliputi helper tekstur baru. Tugas feedback menerima metrics hasil aktual agar cakupan rendah tidak disamakan dengan kesamaan visual.

Atlas merupakan proyeksi warna referensi, bukan albedo yang sudah dibersihkan dari lighting. Peta normal/roughness/displacement dan rekonstruksi neural dari satu foto belum ditambahkan. Geometri dari satu foto perspektif tetap memerlukan interpretasi mesh/cage. Tidak ada klaim 100% mirip, bebas semua self-intersection, atau PBR lengkap.

## Skills dan Obsidian

Core model-3d diperbarui ke 1.8.0, material-texture ke 1.7.0, termasuk registry dan mirror. Enam custom skills ditambahkan: kalibrasi kamera/landmark, segmentasi/ruang kosong, UV/motif, material/lighting, topologi/detail, serta bukti/revisi referensi. Kartu dibaca otomatis menurut domain dan kata kunci; tidak membebani semua prompt dengan seluruh panduan.

Panduan surface-reference dan catatan UV diselaraskan dengan kemampuan engine aktual. Tool tetap runner Blender tepercaya yang menerima data tervalidasi. Tidak mengizinkan Python dari provider atau menambahkan nama tool yang tidak tersedia. Direktori skills diperiksa menggunakan Find Skills; paket yang memerlukan layanan eksternal atau jalur eksekusi berbeda tidak dipasang ke pipeline lokal ini.

## Verifikasi

Bukti: `docs/test-evidence/2026-11-02/reference-texture/`.

- Typecheck lulus; 353 tes frontend lulus. Tes preview memeriksa UV, PNG/dimensi, warna sRGB, penolakan URL remote dan disposal.
- 160 tes Rust standar lulus; tes opt-in dijalankan terpisah. Empat tes vault aktual memeriksa semua domain, skenario campuran, enam skill baru dan isolasi prompt umum.
- Native Blender build/cache/integritas lulus, termasuk atlas PNG valid dan jumlah UV. `.blend` dibuka ulang; referensi serta tekstur terkemas.
- Fixture independen: bentuk bertingkat dengan lubang tembus dan garis warna dua piksel. Geometri manifold, ukuran dan lubang dipertahankan. Render aktual menampilkan 352 piksel motif kuning; nilai ini bukti fixture, bukan skor kemiripan umum.
- Siluet render fixture: depan IoU 1,0000, kanan/atas 0,9996. Metrik itu tidak menjadi persentase kemiripan 3D.
- Renderer WebGL membaca geometri Blender aktual, memuat atlas sRGB, memakai 70.560 UV untuk 23.520 triangle, glError=0. Screenshot berasal dari halaman uji lokal, bukan generasi baru pengguna.
- Subdivision lama level 0/2 tetap menghasilkan 12/192 triangle dan file dapat dibuka ulang. 13 tes helper vault lulus.
- Vault: 278 catatan, 1.468 tautan, 25 core skills dan 26 custom skills, tanpa error. Probe campuran terbesar 91 catatan/79.612 byte, di bawah batas 96 catatan/98.304 byte.

Tidak ada inference provider berbayar atau generasi hiu baru dalam pengujian ini. Tidak ada upload/penyisipan Roblox. Atlas Blender belum diteruskan sebagai tekstur asset pada impor Studio; jalur impor lama mempertahankan fallback vertex colors.

## Pemasangan

ForgeKit Studio 0.1.39 terpasang di `/Applications/ForgeKit Studio.app`, signature ad-hoc terverifikasi dan aplikasi dibuka kembali. Backup aplikasi 0.1.38 serta SQLite tersedia di `/Users/ariardianto/Library/Application Support/ForgeKit Recovery/2026-11-02-reference-texture-install-1793636941421049000`. Enam tabel chat/artefak memiliki jumlah dan hash isi yang sama sebelum/sesudah pemasangan; integrity_check=ok dan foreign-key check kosong.

Pengujian batas atlas final mencakup 2–6 tampak dan 1–4 komponen: total tidak melebihi empat megapiksel. Typecheck, tes preview dan fixture Blender dijalankan ulang setelah penyesuaian anggaran. Tidak ada file halaman/JSON pengujian browser yang disertakan dalam frontend produksi.

Pembacaan UI sesudah pemasangan membuktikan Model 3D terbuka, Blender terdeteksi dan Obsidian terhubung. Prompt serta referensi yang sudah terisi dipertahankan. Perubahan hash builder memerlukan cache preview lama dibangun ulang; tombol aplikasi dipakai pada recipe versi tersimpan, tanpa inference provider atau perubahan geometri recipe.

Pemeriksaan native final menampilkan kembali model lama 15.124 triangle, tombol Buka di Blender serta status Obsidian terhubung. Ini uji kompatibilitas pada recipe lama, bukan generasi ulang hiu atau bukti kemiripan baru. Screenshot dan snapshot tersimpan sebagai native-final.png/json.
