# Model 3D dari gambar tanpa prompt — ForgeKit 0.1.40

Mode utama Model 3D kini **Dari gambar**: pengguna mengunggah/menyeret 1–3 PNG/JPG/WebP, memilih provider/model dan menekan **Buat 3D**. Tidak perlu mengetik prompt. Mode **Dengan prompt** mempertahankan pembuatan dari teks dan draft yang sudah ada. Draft teks lama tidak terkirim dalam mode gambar.

Tombol tetap nonaktif jika belum ada gambar, lampiran sedang diproses, provider/model belum dipilih atau tugas sedang berjalan. Unggah tidak otomatis memanggil provider; pengguna menekan Buat 3D setelah lampiran lengkap. Filter gambar berlaku pada picker maupun drop; lampiran lain tetap didukung fitur yang sebelumnya mendukungnya.

Backend mengisi instruksi otomatis sebelum validasi, hashing dan penyimpanan tugas. Instruksi meminta analisis bentuk/volume/detail/warna dari referensi aktual, memilih rekonstruksi ortografis atau interpretasi mesh/cage menurut bukti, memakai skills Obsidian dan memeriksa render Blender. Gambar tetap data, bukan instruksi. Provider, model, budget, checkpoint, pembatalan dan artefak memakai jalur generasi yang sama.

Default tersebut hanya untuk generasi model3d baru dengan gambar langsung dan teks kosong. Permintaan fitur lain, file teks saja, revisi kosong dan referensi rusak tetap ditolak. Prompt eksplisit tidak ditimpa. Pemulihan membaca instruksi efektif dan referensi yang sudah tersimpan, sehingga tidak membutuhkan pengguna mengetik ulang.

Ini perbaikan input, bukan mesin rekonstruksi neural baru. Satu foto perspektif masih memerlukan interpretasi sisi tersembunyi; volume berbasis siluet memerlukan minimal dua tampak ortografis konsisten. Output utama tetap .blend, dengan validasi geometri, tekstur dan review yang sudah ada. Kemiripan penuh tidak dijamin oleh tombol tanpa prompt.

Core skill model-3d 1.9.0, registry, mirror dan panduan fitur Obsidian diselaraskan. Tidak ada penghapusan prompt, referensi, versi model atau akun pengguna.

Bukti pengujian dan pemasangan: `docs/test-evidence/2026-11-02/image-input/`.

## Verifikasi

- Typecheck lulus. Seluruh 358 tes frontend pada 66 file lulus. Sebelas tes input mencakup tombol tanpa teks, pemisahan draft lama, kebutuhan akun, lampiran yang sedang diproses, filter file dan pengiriman request gambar saja.
- 161 tes Rust standar lulus. Tes normalisasi mencakup gambar valid, prompt eksplisit, fitur lain, revisi kosong, teks saja dan PNG rusak. Batas panjang prompt asli tetap mengikat.
- Uji opt-in dengan Blender nyata dan HTTP fixture lokal lulus: instruksi otomatis dan gambar sampai ke transport provider fixture; render, satu revisi dan resume checkpoint yang sama berjalan. Ini pengujian mekanisme, bukan inference provider eksternal atau sertifikasi kemiripan.
- Verifikasi vault lulus: 278 catatan, 25 core skills, 26 custom skills dan tanpa tautan rusak.

Tidak ada generasi berbayar baru atau perubahan map Roblox dalam pengujian ini.

Pemeriksaan terakhir juga menguji input teks kosong yang melewati batas 16.000 byte: normalisasi tidak melewati validasi panjang asli. Teks otomatis disiapkan hanya untuk gambar langsung pada tugas model baru.

## Pemasangan

ForgeKit 0.1.40 dipasang dan dibuka. Signature ad-hoc serta hash executable diverifikasi. Cadangan aplikasi 0.1.39 dan SQLite konsisten: `/Users/ariardianto/Library/Application Support/ForgeKit Recovery/2026-11-02-image-input-install-1793637962475545000`. Enam tabel chat/artefak memiliki jumlah dan hash isi sama sebelum/sesudah pemasangan. SQLite integrity_check=ok dan tidak ada pelanggaran foreign key.

Native UI final: halaman Model 3D menampilkan Gambar ke 3D, pilihan Dari gambar/Dengan prompt, tombol Buat 3D, dan tidak merender kolom Apa yang ingin dibuat? pada mode gambar. Tidak menekan tombol generasi provider aktual. Snapshot/screenshot: native-final.json/png.
