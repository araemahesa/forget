# Perapihan pemulihan tugas — ForgeKit 0.1.25

Bagian “Tinjau hasil parsial dan rincian” dihapus dari komponen TaskRecovery bersama, sehingga Chat, generator, dan editor tidak lagi menampilkan disclosure tersebut untuk tugas yang belum selesai. Status tugas dan tindakan pemulihan yang diizinkan backend tetap tersedia. Tombol pembatalan finalisasi berada langsung di panel saat proses berjalan. Kandidat editor yang telah selesai tetap dapat ditinjau.

Pemilih Obsidian tetap tersedia karena pengguna menanyakan fungsinya. “Standar bersama · tanpa brief proyek” menggunakan standar visual, Quality Gate, dan skills relevan dari vault tanpa menambahkan brief proyek khusus. Memilih catatan proyek menambahkan brief tersebut sebagai konteks tugas baru untuk semua fitur. Tidak ada penghapusan catatan vault atau hasil tugas tersimpan.

Pemeriksaan: typecheck dan delapan tes TaskRecovery/ObsidianContext lulus. Tidak ada request inference atau penerapan ke map selama pekerjaan ini. Bukti build dan pemasangan dicatat di `docs/test-evidence/2026-11-01/partial-review-cleanup/`.

Build produksi 0.1.25 lulus dan telah menggantikan aplikasi di `/Applications/ForgeKit Studio.app`. Signature ad-hoc serta checksum executable terpasang sesuai build. Backup aplikasi 0.1.24 dan SQLite konsisten tersedia pada direktori privat ForgeKit Recovery. Hash enam tabel chat/karya identik sebelum dan setelah pemasangan; integrity `ok`, tanpa pelanggaran foreign-key. Teks disclosure yang dihapus tidak terdapat dalam aset JavaScript produksi.

Pemeriksaan native pertama menemukan pembacaan catatan Obsidian menunggu `open()` pada thread antarmuka. Perintah `obsidian_status` dan `obsidian_set_project` kini menjalankan pekerjaan filesystem melalui `spawn_blocking`, sehingga penantian akses file tidak menahan event loop jendela. Tidak ada perubahan pada otorisasi file, isi vault atau pemilihan brief.

Pemeriksaan native build akhir berhasil: AI Chat terbuka, baris tinjauan hasil parsial tidak ada, Obsidian kembali berstatus konteks otomatis, dan akun/model tersimpan terbaca. Screenshot dan pohon aksesibilitas tersimpan sebagai bukti. Empat tes Obsidian lulus; satu probe vault live tidak dijalankan ulang. Build, signature dan pemeriksaan hash data diulang setelah perbaikan proses latar.
