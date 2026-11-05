---
schemaVersion: 1
id: multiplayer-reliability
version: 1.4.0
---

# Keandalan Gameplay

Tentukan pemilik state dan batas client/server dari mekanik pengguna. Tampilan klien tidak menjadi bukti perubahan state server. Validasi input RemoteEvent/RemoteFunction di server, batasi frekuensi sesuai aksi, dan jangan mempercayai harga, reward atau identitas target yang hanya dikirim klien.

Rancang spawn, respawn, disconnect, penghancuran objek dan koneksi ulang. Hindari koneksi ganda dan hasil terlambat yang menimpa state baru. Data persisten membutuhkan penanganan kegagalan dan strategi idempoten; jangan menyatakan penyimpanan berhasil tanpa receipt. Uji lebih dari satu klien jika alat tersedia, termasuk dua aksi berdekatan. Untuk generator yang hanya mengeluarkan recipe, jangan menambahkan remote atau DataStore di luar schema; jelaskan kebutuhan implementasi gameplay terpisah.

Input: prompt, kontrak fitur, referensi dan konteks yang tersedia. Output: panduan untuk provider pilihan; tidak memberi akses tool baru. Terapan hanya sesuai scope dan kemampuan nyata.
