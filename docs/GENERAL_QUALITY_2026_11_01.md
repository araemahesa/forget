# Panduan general dan skills adaptif — ForgeKit 0.1.26

Pemilih Standar bersama/brief global dihapus dari seluruh composer. Saat sehat, komponen konteks tidak menambah baris UI; kegagalan pembacaan vault tetap terlihat. Endpoint pengubah brief global dan izin IPC terkait dihapus. Konfigurasi project lama dibaca untuk kompatibilitas tetapi tidak dipakai sebagai konteks tugas baru.

Arah visual diturunkan dari prompt, referensi eksplisit dan konteks live. Style Bible menjadi metode general, tanpa genre fantasy, palet, ukuran atau proyek default. Proyek contoh dan paket lama tetap menjadi arsip; tidak ikut dimuat otomatis. Snapshot tugas yang sudah berjalan tetap dipertahankan saat resume.

Registry diperluas dari 14 menjadi 24 skills versi 1.4.0. Panduan lama diperkuat dengan pemeriksaan domain. Skills tambahan mencakup pemahaman permintaan, arah artistik, level, performa, aksesibilitas, keandalan multiplayer, produksi aset, rencana uji, bahasa/konten dan komposisi ruang. Satu fungsi pemilih sekarang dipakai instruksi provider, metadata/hash receipt dan konteks vault. Pemilihan lintas fitur berlaku pada generator/editor selain Chat. Pencocokan kata menghindari substring pendek yang salah; pertanyaan model AI tidak diarahkan ke pemodelan geometri.

Vault berkembang dari 66 menjadi 109 catatan dengan 490 tautan internal: 12 topik pengetahuan, 13 rubrik domain dan empat workflow produksi. Skills vault diverifikasi cocok dengan berkas panduan aplikasi. Graph diberi grup warna pengetahuan, rubrik, workflow dan skills; jumlah catatan/tautan bukan skor kualitas output.

Konteks otomatis memuat panduan umum, feature utama, skills dan rubrik pendukung yang relevan. Panduan fitur lengkap tidak diulang untuk setiap bidang tambahan. Permintaan campuran 13 domain lolos dengan 56 catatan dan 70.389 byte isi, di bawah batas 96 KiB. Batas per catatan, penolakan symlink/traversal, credential filtering, checkpoint dan pembatasan tool tetap berlaku.

Pemeriksaan: typecheck, 283 tes frontend, 136 tes Rust standar dan 10 tes helper vault lulus. Lima tes lingkungan diabaikan pada suite standar; dua probe vault dibuka secara terpisah bersama empat tes Obsidian lain, total enam lulus dengan catatan pengguna nyata. Kegagalan awal suite frontend akibat timeout paralel dan fixture Obsidian lama dicatat; fixture diperbarui, suite lengkap lulus dengan dua worker tanpa menaikkan batas waktu tes. Batas konteks lintas fitur yang terdeteksi diperbaiki sebelum build final.

Aplikasi 0.1.26 terpasang, signature dan checksum sesuai build. Hash enam tabel chat/karya identik sebelum/sesudah pemasangan, integrity ok dan tanpa pelanggaran foreign-key. Pemeriksaan native mengonfirmasi pemilih dan baris konteks lama tidak ada serta akun/model tersimpan tersedia. Backup vault/source/aplikasi/database tersedia pada direktori privat ForgeKit Recovery.

Pembaruan panduan tidak menambah kapabilitas engine atau menjamin kualitas artistik tertentu. Tidak ada inference provider, upload atau perubahan map selama pekerjaan ini. Kualitas hasil provider, gameplay dan performa live tetap perlu pemeriksaan pada artefak/map aktual. Referensi metode disimpan di vault, termasuk dokumentasi resmi Roblox tentang desain game dan desain untuk performa.

Graph native telah memperlihatkan nodes baru untuk skills, pengetahuan, rubrik dan workflow. Grup warna dibaca setelah Obsidian dibuka ulang. Preferensi akhir memakai zoom awal lebih kecil dan text fade nol agar label dapat ditelusuri. Pengamatan input terakhir terhalang karena tidak ada jendela desktop yang memiliki fokus; tidak ada perubahan izin atau pengulangan aksi input setelah retry restore gagal. Konfigurasi akhir disimpan dan Obsidian dibuka ulang.
