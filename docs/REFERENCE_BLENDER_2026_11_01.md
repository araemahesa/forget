# Rekonstruksi referensi dan hasil Blender — 0.1.28

Permintaan pengguna: mengikuti seluruh bentuk dan detail referensi dengan kualitas tinggi, serta memusatkan hasil pada Blender. Kesamaan 100% dari gambar tidak dapat dijanjikan: sisi tersembunyi, detail tekstur, data kamera/lighting dan keterbatasan geometri tidak hilang karena instruksi prompt. Implementasi memperkuat kemampuan bentuk dan pembandingan aktual, tanpa menambahkan label kemiripan palsu.

## Perubahan yang dapat dipakai

Model baru menghasilkan satu deliverable model utama, `model.blend`. Runner tidak membuat model GLB/FBX; tombol ekspor GLB/OBJ dan penerapan primitive ke Studio dihapus dari halaman Model 3D. Berkas ekspor dan versi lama tetap tersimpan. Generic exporters untuk domain lain/arsip tidak dihapus.

Blender menyimpan collection model, referensi gambar yang diproses dan ditanamkan ke file, kamera, pencahayaan studio dan catatan inspeksi. Tombol Buka di Blender menjalankan executable Blender pada artefak terverifikasi dengan auto-exec dimatikan. File dibuka ulang tanpa scripts oleh runner sebelum diterima.

Pratinjau interaktif dibaca dari geometri/normals Blender melalui buffer internal tervalidasi. Tidak memakai GLB tersembunyi untuk pratinjau. Nilai warna dan permukaan tetap memakai preset bersama. Buffer tidak sah ditolak sebelum GPU. Referensi dan render tampil bersama, dapat diperbesar dan diperiksa dengan zoom.

## Bentuk dan keseluruhan referensi

Selain primitive/profil, kontrak menerima dua geometri baru:

- **Mesh:** 4–2048 vertex lokal dan 1–4096 face triangle/quad per part, untuk bentuk asimetris, taper dan penampang khusus. Semua vertex harus terpakai; face dengan indeks salah, berulang atau degenerat ditolak. Quad dibelah konsisten. Normals Blender direkonstruksi; volume tertutup diperiksa orientasinya.
- **Lathe:** 3–128 pasangan radius/tinggi yang diputar pada sumbu Y, untuk bentuk berprofil berubah seperti botol, vas dan piala. Ujung radius nol menutup cap; rongga/ketebalan mengikuti kontur yang diberikan. Tidak memaksa bentuk asimetris menjadi simetri putar.

Bounds penuh dan transform tetap mengikuti recipe. Batas model 128 part dan 200000 triangle tetap berlaku. Schema frontend/native memakai kasus penerimaan bersama. Mesh fleksibel bukan layanan rekonstruksi neural, sculpt atau rig otomatis.

Panduan mewajibkan pemeriksaan seluruh bagian: bentuk, volume, penampang, proporsi, kelengkungan, asimetri, rongga, sambungan, detail/motif, warna, bahan, transparansi dan respons cahaya. Urutan konstruksi besar-ke-kecil tetap metode kerja, bukan pengurangan kriteria penerimaan. Perspektif, shadow dan highlight foto dipisahkan dari geometri/albedo; sisi tersembunyi diberi batas interpretasi.

## Umpan balik visual nyata

Generator dengan gambar referensi:

1. Provider pilihan menghasilkan recipe tervalidasi, dengan referensi asli sebagai image input.
2. Blender membuat model, menanamkan gambar dan merender depan, kanan serta tiga perempat dengan material aktual.
3. Render 768 × 768 dikirim sebagai image input ke provider yang sama dalam checkpoint/budget yang sama.
4. Provider mengembalikan perbedaan spesifik dan bagian yang tidak dapat diamati. Satu revisi otomatis diikuti pembandingan kedua; tidak mengulang dari awal atau mengganti akun/model.
5. Recipe final, hash dan laporan diikat pada kandidat yang benar-benar dirender. Perbedaan tersisa tetap ditampilkan. `accept` berarti tidak menemukan perbaikan lanjutan pada pemeriksaan itu, bukan sertifikasi identitas.

Checkpoint menyimpan fase pembandingan dan kandidatnya, sehingga resume tidak membaca JSON laporan sebagai recipe atau mengulang operasi map. Laporan tersimpan per tugas/checkpoint, bukan menimpa manifest artefak immutable atau memakai laporan tugas lain dari cache.

AI Chat menerima render tool Blender sebagai image blocks setelah receipt. Gambar tidak diduplikasi menjadi teks base64 di tool output. Instruksi mengarahkan inspeksi semua aspek dan revisi lewat tool bila diperlukan. Chat mempertahankan batas loop/checkpoint yang ada; jumlah pemeriksaan generator tidak dipaksakan pada Chat.

Referensi kini disimpan pada tugas kreatif dan diwarisi oleh revisi bila tidak diganti dengan lampiran baru. Versi tersimpan membuka referensi miliknya, bukan lampiran dari tugas yang sedang aktif. Referensi/hasil ekstraksi tetap dianggap data, bukan instruksi.

Konteks supervisor menghitung budget teks terpisah dari gambar sebagaimana transport provider. Gambar valid yang lebih besar dari 256 KiB tidak langsung menggagalkan tugas atau pemulihan. Batas gambar 8 MiB, teks, waktu, jumlah panggilan dan budget kumulatif tetap mengikat. Tidak ada perpindahan provider diam-diam.

Render pembanding memakai 24 samples dan time limit inspeksi. `.blend` tersimpan dengan pengaturan render 1920 × 1920, 128 samples adaptif dan tanpa time limit inspeksi; ini konfigurasi, bukan klaim render 1920 sudah dijalankan. Pengguna dapat mengubah pengaturan di Blender.

## Obsidian dan skills

Skills model-3d/material-texture menjadi 1.6.0, asset-production 1.5.0. Dua panduan baru membahas Rekonstruksi Referensi 3D serta Workspace Blender dan Perbandingan. Panduan fitur, rubrik dan catatan 3D diselaraskan dengan hasil `.blend` dan pemeriksaan seluruh bentuk. Tidak ada tema atau palet default.

Vault berisi 116 catatan, 534 tautan internal dan 24 skills pada verifikasi awal pembaruan. Probe campuran menggunakan 64 catatan, tetap di bawah 96 KiB. Jumlah catatan bukan skor kualitas.

## Pemeriksaan

Bukti berada pada `docs/test-evidence/2026-11-01/reference-blender/`.

- Typecheck dan 314 tes frontend lulus. Termasuk 9 kasus mesh/lathe, buffer/normals/material Blender, serta perbesaran referensi dan laporan perbedaan.
- 143 tes Rust standar lulus; enam tes lingkungan diabaikan oleh suite standar. Enam tes konteks Obsidian termasuk dua probe vault nyata dijalankan terpisah. Tes Blender cache/integritas juga dijalankan secara nyata.
- Uji integrasi pembandingan menjalankan Blender dan HTTP fixture lokal: gambar render benar-benar terkirim, kandidat direvisi sekali, pemeriksaan kedua berjalan pada checkpoint yang sama dan resume selesai tidak memanggil provider lagi. Ini uji mekanisme; tidak memakai provider eksternal dan tidak menilai kemiripan artistik pada gambar pengguna.
- Fixture Blender memeriksa `.blend` yang dibuka ulang, dimensi, rongga, nilai warna/PBR, preview finite dan larangan ekspor GLB/FBX baru. Fixture 128 part dan penolakan triangle berlebih tetap diuji.
- Percobaan awal mendeteksi API Vector.length, penulisan ulang artefak immutable, fixture dialog jsdom dan sintaks JSX; diperbaiki sebelum build final. Normal mesh/lathe diperbaiki melalui BMesh sebelum penyimpanan.

## Batas hasil

Tidak ada inference provider eksternal, upload, publish atau perubahan map pengguna dalam pekerjaan ini. Tidak ada pengukuran kemiripan pada referensi pengguna yang nyata. Gambar sumber diproses sesuai batas lampiran; file gambar asli resolusi penuh tidak otomatis tersimpan. UV, tekstur foto, rig, anatomi/permukaan organik kompleks dan sisi tak terlihat tetap membutuhkan pemeriksaan atau pekerjaan lanjutan. Referensi asli dan render pembanding adalah bukti untuk inspeksi, bukan dasar klaim 100%.
