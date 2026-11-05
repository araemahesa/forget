# Pengujian langsung Shark.jpg — 3 November 2026

Hasil: alur teknis berhasil; kemiripan tinggi dengan foto gagal.

- Aplikasi terpasang: ForgeKit Studio 0.1.41.
- Masukan: satu Shark.jpg; mode Dari gambar; tanpa teks prompt pengguna.
- Provider nyata: OpenAI melalui akun Codex terpilih; GPT-6.1-Sol, Medium, kualitas High. Bukan respons fixture.
- Durasi: 995,9 detik (16 menit 36 detik).
- Empat pemeriksaan visual: semua meminta revisi. Tiga revisi dibangun; usulan revisi pada pemeriksaan terakhir tidak diterapkan karena batas empat pemeriksaan.
- Status akhir: preview_ready, bukan hasil diterima. Tidak ada error transport atau kegagalan build.
- Hasil: model .blend nyata, 41 bagian, 9.378 segitiga, 14 material dan enam render Blender 768×768.
- File .blend dibuka ulang oleh runner; hash delapan file sesuai manifest; recipe bundle sesuai kandidat final tersimpan.
- Satu referensi dipaketkan dalam .blend. Tidak ada atlas tekstur foto; warna memakai material per bagian.

## Penilaian visual

Hasil dapat dikenali sebagai hiu dan memiliki volume dari semua sisi. Namun kepala dan moncong belum sesuai, rahang putih tampak sebagai bantalan terpisah, bukaan mulut pendek dan terlalu kecil, susunan gigi sederhana, insang samar, sirip serta ekor masih sederhana, dan batas warna maupun detail kulit foto belum direproduksi. Keenam render final diperiksa langsung. Tidak diberikan persentase kesamaan karena tidak ada pengukuran yang sah.

Sisi tersembunyi adalah interpretasi dari satu foto. Validasi pembukaan ulang file dan jumlah segitiga tidak membuktikan kualitas artistik, manifold, bebas self-intersection atau kesiapan rig.

## Artefak

- Shark-test.blend: salinan tepat model terbaru dari bundle aplikasi.
- view-front/back/right/left/top/bottom.png: render nyata model tersebut.
- result.json: status tugas, metrik, hash dan sisa perbedaan.
- reviews.json: empat hasil pemeriksaan provider berikut recipe yang diusulkan; recipe terakhir tidak dibangun.
- candidate-final.json: kandidat yang benar-benar dibangun dan disimpan.

Pengujian ini tidak mengubah kode aplikasi, skills atau Obsidian. Tidak mengeksekusi revisi berulang setelah batas tugas.
