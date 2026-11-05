# Pratinjau Blender dan impor Studio — 0.1.29

## Tampilan

Halaman Model 3D hanya menampilkan buffer geometri yang dihasilkan Blender. Tidak ada fallback recipe, pilihan Hasil Blender, atau checkbox wireframe kedua. Saat bundle belum tersedia, viewport kosong dengan pesan singkat; versi lama tidak diganti geometri tiruan.

Toolbar menampilkan nama model dan triangle. Statistik, ukuran dan batas pemeriksaan berada di Detail model. Tiga thumbnail utama adalah render Blender; referensi asli dan laporan pembandingan ditempatkan di panel tertutup Referensi & pemeriksaan. Tombol Bangun di Blender hanya muncul jika bundle belum tersedia. Tombol utama: Buka di Blender dan Masukkan ke Studio, disertai ikon folder.

Grid bersama memakai kotak yang lebih besar, cakupan sedikitnya 20 kali diagonal model, posisi mengikuti pusat X/Z model dan lantai di bawah bounds. Garis dibuat transparan. Berlaku pada seluruh pemakai ThreeViewport: Model 3D, Animasi, Cutscene, GUI mode 3D dan Karakter/Dialog. Editor 2D tidak diubah menjadi ruang 3D.

## Masukkan ke Studio

Tombol membutuhkan versi tersimpan, bundle Blender terverifikasi dan konteks map Studio. Tidak memakai provider untuk membuat ulang bentuk dan tidak membuat ekspor GLB/FBX. Backend memeriksa recipe, hash semua berkas bundle, buffer triangle/normals, identitas part dan batas 200.000 triangle.

Importer tetap yang dibundel mengirim geometri asli Blender dalam chunk kecil melalui MCP. Bagian di atas 20.000 triangle dipisahkan menjadi beberapa MeshPart dengan bounds/posisi yang sama. Normals dan warna diteruskan; bahan Roblox memakai padanan material bawaan dan opacity. Roughness/metalness dicatat pada attribute. Ini bukan pemindahan penuh shader/tekstur/rig Blender. Collision Roblox perlu diperiksa.

Saat tombol ditekan, [AssetService:CreateAssetAsync](https://create.roblox.com/docs/reference/engine/classes/AssetService#CreateAssetAsync) mengunggah mesh ke pemilik experience (atau akun Studio untuk place lokal), kemudian [CreateMeshPartAsync](https://create.roblox.com/docs/reference/engine/classes/AssetService#CreateMeshPartAsync) membuat MeshPart dari asset ID. Tidak memublikasikan place. Kegagalan izin, jaringan atau upload ditampilkan; tidak membuat primitive pengganti. Upload yang sudah berhasil tidak dihapus otomatis.

General-purpose provider writes tetap diblokir. Jalur impor khusus hanya menerima ID versi, Studio dan snapshot; tidak menerima kode, geometri atau path dari frontend. Map dikunci dalam mode Edit dan identitas DataModel/Workspace diperiksa melalui GetDebugId sebelum operasi dan setelah setiap yield. Jika identitas tersebut tidak dapat dibaca, tidak ada impor. Perubahan dibuat sebagai model terpisah, ditempatkan pada fokus kamera, dicatat untuk Undo dan diperiksa kembali. Objek map lama tidak ditimpa.

Menekan kembali pada versi yang sudah dimasukkan menggunakan hasil yang telah ada tanpa upload baru. Receipt per tahap dan intent disimpan pada `workspace/imports/blender/`. Hasil upload yang tidak pasti tidak diulang otomatis. Percobaan baru diizinkan setelah penolakan upload yang terkonfirmasi tanpa aset berhasil. UI menunggu konteks segar sebelum mengunci tugas; discovery tidak merebut sesi MCP selama tugas aktif.

## Verifikasi

- Typecheck lulus.
- Suite frontend penuh: 317 tes lulus; setelah penambahan tes hook impor, tes hook dan dua tes Studio state lulus terpisah. Tes baru memeriksa viewport tanpa fallback, geometri Blender, tombol map terverifikasi, ukuran/cakupan grid, konteks segar dan pencegahan klik ganda.
- Suite Rust: 145 tes lulus, enam probe lingkungan diabaikan. Tes impor memeriksa buffer, chunk dan receipt terputus tanpa retry.
- Skrip Lua importer yang sama dijalankan pada harness lokal: mesh/normals, upload receipt, commit/Undo, reuse, map berganti, penolakan upload, percobaan ulang terkonfirmasi dan kegagalan setelah upload. Harness mengganti layanan Roblox; bukan upload nyata.
- Build native dan signature diperiksa. Tampilan Model 3D dan Animasi diperiksa pada aplikasi terpasang: model lama terbaca, kontrol ganda hilang, tiga render utama terlihat dan grid luas. Studio offline membuat tombol impor nonaktif.
- Pemasangan membuat backup aplikasi dan database konsisten. Tabel chat/karya sama sebelum/sesudah; integrity `ok`, tanpa foreign-key violation.

Roblox Studio tidak terhubung selama pengerjaan. Upload, insertion, Undo, penyimpanan/reopen dan playtest pada map Roblox nyata belum diuji. Tidak ada upload aset atau perubahan map selama pengujian ini. Tidak menjalankan ulang generasi provider yang sudah lulus pada tahap sebelumnya.

Bukti: `docs/test-evidence/2026-11-01/blender-preview-studio/`.
