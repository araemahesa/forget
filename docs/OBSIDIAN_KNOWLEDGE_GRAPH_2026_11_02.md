# Jaringan pengetahuan map Roblox dan ForgeKit — 2 November 2026

Vault aktif diperluas dari 133 menjadi 272 catatan Markdown. Penambahan 139 catatan memuat 96 panduan pendalaman, 12 indeks bidang, 20 kartu skill, indeks skill, dashboard peta pengetahuan, panduan operasi dan delapan catatan sumber. Seluruh catatan baru terhubung ke komponen utama vault. Ada 1.435 wikilink (1.067 hubungan unik antar catatan); dua catatan lama yang terpisah tetap dipertahankan.

## Perubahan yang digunakan

- Arsitektur service/controller, state server, replikasi, remote validation, lifecycle serta streaming.
- Gameplay loop, ronde, quest, inventori, checkpoint, combat dan onboarding.
- Schema data pemain, kegagalan simpan, transaksi idempoten, migrasi serta ekonomi.
- Level graybox, terrain, wayfinding, prefab, collision serta anggaran performa.
- GUI/HUD, input, aksesibilitas, lokalisasi, NPC, pathfinding, rig/animasi dan cutscene.
- VFX, lighting, cuaca, musik, SFX, ikon/GFX serta pakaian.
- Rekonstruksi 3D: inventaris referensi, kamera, rasio landmark, silhouette multiview, volume organik, rahang/rongga, topologi, material, kebutuhan UV serta bukti kemiripan.
- Pengembangan ForgeKit: caller UI/kontrak/native/engine, kemampuan aktual, versi artefak, provider/akun, timeout, checkpoint, pengujian dan rilis.

20 customSkills dimuat melalui kemampuan manifest yang sudah tersedia pada aplikasi terpasang 0.1.36. Tidak ada perubahan kode runtime atau build/instalasi baru. Source Rust hanya mendapat tes integrasi tambahan untuk vault aktif. Tugas baru membaca kartu yang relevan; wikilink tidak diikuti rekursif. 25 skill inti dan tujuh runbook lama tetap tersedia. Tugas yang dilanjutkan memakai snapshot sebelumnya.

Graph menggunakan 20 kelompok warna, node serta garis bawaan Obsidian. Canvas `00 Studio/Jaringan Produksi.canvas` memuat 13 kartu file dan 24 hubungan. Dashboard, bookmark serta indeks skill mengarah ke jaringan baru. Graph berwarna telah dilihat pada aplikasi Obsidian terpasang. Hubungan baru menghubungkan catatan baru dengan panduan fitur lama berdasarkan topik; tidak ada node dekoratif palsu atau tautan acak.

Helper vault sekarang memeriksa seluruh Canvas, routing customSkills, tipe konfigurasi, path serta batas manifest. `verify` tetap membandingkan mirror skill inti, hash source dan checksum handoff.

## Verifikasi

13 tes helper lulus. Delapan tes native Obsidian lulus, termasuk enam skenario fokus, 14 jenis tugas campuran, semua domain, isolasi proyek, pemilihan skill dan batas pembacaan. Permintaan campuran terbesar mengandung 89 receipt dan 73.893 byte teks; batas native tetap 96 receipt dan 98.304 byte teks. Manifest 17.270 byte, di bawah batas 24.576 byte. Seluruh tiga Canvas (29 node) valid. Tidak ada file lama hilang; isi Canvas lama hanya diformat ulang oleh Obsidian tanpa perubahan struktur.

Bukti mesin: [validation.json](test-evidence/2026-11-02/knowledge-graph/validation.json), [native-routing.log](test-evidence/2026-11-02/knowledge-graph/native-routing.log). Helper: jalankan `python3 "90 Sistem/Tools/forgekit_vault.py" verify` dari root vault. Tes helper berjalan pada salinan sementara, bukan proyek live.

## Batas pemeriksaan

Penambahan pengetahuan tidak melatih bobot model atau mengimplementasikan kemampuan engine seperti rekonstruksi neural, sculpt, UV baking atau rig otomatis. Tidak ada provider inference, generasi Blender baru atau write/playtest Roblox Studio pada pembaruan ini. Kemiripan hasil hiu sebelumnya belum diselesaikan atau dievaluasi ulang. Validasi routing menunjukkan panduan mencapai konteks, bukan bukti peningkatan artistik keluaran.

## Cadangan

/Users/ariardianto/Library/Application Support/ForgeKit Recovery/2026-11-02-knowledge-graph-210352

Backup mencakup seluruh vault sebelum perubahan. Proyek pengguna, paket handoff, mirror 25 skill inti dan pembelajaran lama dipertahankan.
