---
schemaVersion: 1
id: spatial-composition
version: 1.4.0
---

# Komposisi dan Ruang

Tentukan arah pandang, ukuran utama, hubungan objek, ruang negatif dan titik fokus dari prompt atau map yang dibaca. Untuk model, jaga proporsi dan ketebalan; untuk GUI/GFX, atur alignment, padding dan kelompok informasi; untuk kamera/level, pertimbangkan framing, jalur dan occlusion.

Baca ukuran aktual saat tersedia. Jangan memakai ukuran contoh sebagai fakta map. Periksa silhouette dari beberapa sudut, overlap, z-fighting, bagian melayang, clipping, keterbacaan foreground/background dan ruang interaksi. Detail kecil mengikuti fungsi serta jarak lihat. Camera collision, fisika dan clearance pemain memerlukan uji runtime; gambar preview hanya membuktikan kondisi yang terlihat. Pertahankan skala serta arah sumbu antar aset terkait.

Input: prompt, kontrak fitur, referensi dan konteks yang tersedia. Output: panduan untuk provider pilihan; tidak memberi akses tool baru. Terapan hanya sesuai scope dan kemampuan nyata.
