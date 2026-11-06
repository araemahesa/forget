# Satu gambar, model 3D lengkap — ForgeKit 0.1.41

Permintaan: satu gambar tanpa prompt, provider/model pilihan membuat objek lengkap dengan detail semua sisi. Perubahan dimulai 2 November dan diselesaikan 3 November 2026.

## Alur yang digunakan

Mode Dari gambar menerima satu PNG/JPG/WebP. Picker tidak memilih banyak file dan drop beberapa file ditolak sebelum ekstraksi. Referensi lama tidak dihapus otomatis: jika berisi beberapa gambar, pengguna dapat menyisakan satu atau berpindah ke Dengan prompt. Draft teks lama tidak digunakan pada mode gambar. Akun/model tetap mengikuti pilihan/default yang sudah ada; tidak berpindah layanan diam-diam.

Instruksi otomatis meminta objek volumetrik 360 derajat: depan, belakang, kanan, kiri, atas dan bawah. Bagian teramati mengikuti bentuk, proporsi, detail, warna dan bahan sumber. Bagian tersembunyi dilengkapi secara generatif dengan konstruksi serta palet yang konsisten. Mesh/cage, support loop, profile atau lathe dipilih menurut objek; satu perspektif tidak dipalsukan menjadi beberapa foto ortografis. Kolase ortografis konsisten dalam satu gambar tetap dapat memakai reconstruction yang sudah tersedia.

Sisi belakang/bawah bukan data yang dapat diukur dari satu foto. Kelengkapan itu merupakan keputusan desain interpretatif. Panduan melarang billboard, sisi kosong, ketebalan palsu, ornamen acak dan klaim memperoleh detail tersembunyi secara pasti. Ini bukan penambahan layanan image-to-3D neural atau photogrammetry.

## Pemeriksaan enam arah

Dengan satu gambar visual, Blender kini merender depan, belakang, kanan, kiri, atas dan bawah. Bundle berisi `.blend`, preview dan enam PNG aktual. Cache mencakup helper inspeksi yang berubah; artefak lama tetap disimpan pada identitas hash semula.

Provider review dan AI Chat menerima keenam render full-resolution dalam dua pesan berisi tiga gambar. Validasi per lampiran dan batas gambar kumulatif tetap mengikat. UI menampilkan keenam render secara terpisah dan dapat memperbesarnya. Tidak ada foto sisi belakang sintetis yang diperlakukan sebagai sumber observasi baru.

Review memeriksa kelengkapan volume, sambungan, ketebalan, normals, bukaan, warna dan skala detail seluruh sisi. Bagian terlihat dibandingkan dengan sumber; bagian interpretatif dinilai konsistensi desainnya dan dicatat pada `unseen`. Batas review/budget, checkpoint, pembatalan dan keputusan tidak tersertifikasi tetap berlaku.

## Skills dan Obsidian

Model-3d 1.10.0 diselaraskan pada source, registry dan mirror. Kartu single-image-completion ditambahkan dengan routing kata kunci spesifik. Panduan fitur serta indeks skill diperbarui. Snapshot tugas lama tetap memakai konteksnya; tugas baru membaca panduan terbaru.

Vault: 279 catatan, 1.473 tautan, 25 core skills dan 27 custom skills, tanpa error. Probe instruksi otomatis memilih 66 catatan/66.611 byte; skenario campuran terbesar 91 catatan/79.612 byte. Batas tetap 96 catatan/98.304 byte.

## Pengujian

Bukti berada di `docs/test-evidence/2026-11-02/single-image/` sesuai awal pengerjaan.

- TypeScript typecheck dan tujuh tes input terarah lulus.
- 161 tes Rust standar lulus. Protokol menguji pengiriman enam gambar dalam dua pesan dan penghapusan base64 dari tool receipt teks.
- Blender nyata + server HTTP fixture lokal lulus: enam nama tampak yang tepat, delapan berkas valid, keenam render diterima provider fixture, revisi, hash kandidat dan pemulihan checkpoint yang sama. Runtime 108,51 detik untuk dua build/render beserta feedback. Bukan inference provider eksternal atau penilaian artistik pada foto pengguna.
- Lima tes vault native opt-in lulus, termasuk routing instruksi otomatis satu gambar, semua domain, isolasi proyek dan budget.
- Percobaan frontend bersamaan dengan kompilasi mengalami timeout pada tes navigasi lama; dihentikan dan diulang secara serial setelah kompilasi. Tidak menaikkan timeout global.

Tidak ada generasi berbayar, penerapan map Roblox atau perubahan akun dalam pengujian ini. Fitur menyusun dan memeriksa sisi interpretatif; tidak menjamin kemiripan 100%, anatomi benar, albedo bebas lighting, UV/PBR lengkap atau bebas semua self-intersection pada setiap hasil provider.

Pengulangan frontend serial selesai: 360 tes pada 66 file lulus. Tidak ada perubahan source yang diperlukan untuk timeout saat kompilasi bersamaan.

## Pemasangan

Versi 0.1.41 terpasang di `/Applications/ForgeKit Studio.app`, signature ad-hoc dan hash executable terverifikasi. Backup aplikasi 0.1.40 dan SQLite konsisten: `/Users/ariardianto/Library/Application Support/ForgeKit Recovery/2026-11-03-single-image-install-1793639285212824000`. Enam tabel chat/artefak memiliki jumlah dan hash isi yang sama sebelum/sesudah pemasangan, integrity_check=ok dan foreign-key check kosong.

UI native menampilkan Satu gambar menjadi model 3D lengkap, mode Dari gambar serta tombol Buat 3D. Recipe model lama dibangun kembali melalui tombol Bangun di Blender untuk memeriksa kompatibilitas cache baru dan gallery enam render. Ini bukan generasi baru atau peningkatan artistik hiu lama oleh provider.

Native akhir: model tersimpan 15.124 triangle berhasil dibangun kembali dan keenam tombol render (front/back/right/left/top/bottom) tersedia, beserta Buka di Blender. Snapshot/screenshot: native-final.json/png. Ini uji kompatibilitas pada recipe lama, bukan model baru atau penilaian ulang kemiripan oleh provider.
