# Kualitas otomatis — 31 Oktober 2026

## Implementasi

- Hapus disclosure “Pengaturan hasil”, pilihan kualitas, budget caption, helper dan CSS khusus yang tidak lagi dipakai dari composer kreatif bersama.
- `useCreativeTask` langsung mengirim `quality: 'high'` untuk generate dan refine di seluruh jenis kreatif yang didukung. State/setter kualitas dihapus, sehingga tidak ada pilihan tersembunyi yang menurunkan request.
- Gunakan profil `high` yang sudah didukung backend (tertinggi saat ini), tanpa mengarang profil “ultra” atau menaikkan label saja. Validator, timeout dan batas keamanan backend tetap berlaku.
- Akun, model, reasoning effort, parent versi, cancel/resume, versi tersimpan dan handler editor manual dipertahankan. Reasoning effort tetap pilihan pengguna; ini berbeda dari profil kualitas artefak.
- Probe provider lintas domain menggunakan `high` agar selaras dengan request aplikasi. Probe live tidak dijalankan.
- Shared editor AI dan Chat pada source yang tersedia tidak memiliki parameter kualitas artefak atau kontrol “Pengaturan hasil”; tidak ditambahkan parameter IPC yang tidak didukung. Handler editor backend yang tersedia sudah membentuk request kreatif `high`.

## Verifikasi

- 336 kasus layout komponen lulus, mencakup delapan generator, shared editor AI, Chat, refine dan lampiran; tema/density dan rentang ukuran mengikuti pemeriksaan composer sebelumnya.
- Tidak ada disclosure “Pengaturan hasil” atau combobox kualitas pada semua composer yang dirender.
- 18 pemeriksaan hook `useCreativeTask` asli: generate dan refine untuk sembilan jenis kreatif yang didukung kontrak lama, termasuk material hanya pada tingkat hook. Ini tidak menghidupkan kembali halaman material yang sebelumnya dihapus.
- Setiap request mengirim `high` tepat sekali, menjaga provider/model/effort serta parent revisi.
- Parse TypeScript/CSS dan `node --check` untuk dua script yang berubah lulus. Screenshot fixture telah diinspeksi.

Provider, IPC, validasi recipe dan ekstraksi lampiran pada harness adalah fixture. Pemeriksaan ini membuktikan layout dan kontrak request frontend, bukan kualitas keluaran media nyata atau keberhasilan provider live.

Bukti: [laporan](test-evidence/2026-10-31/automatic-quality/report.json), [sintaks](test-evidence/2026-10-31/automatic-quality/syntax.json), [screenshot fixture](test-evidence/2026-10-31/automatic-quality/generator-dark-390.png).

## Batas pemasangan

Aplikasi native belum diperbarui. Source proyek tetap parsial; contracts, konfigurasi workspace, `src-tauri/src/lib.rs`, `build.rs` dan modul lain hilang. Penghalang build sebelumnya dikonfirmasi masih ada; perintah build penuh tidak diulang karena perubahan ini tidak memulihkan berkas tersebut. Lihat `PROMPT_LAYOUT_2026_10_31.md` dan bukti build sebelumnya.

Akun, chat, karya, database dan aplikasi terpasang tidak diubah. Memilih profil tertinggi tidak menjamin kualitas setiap hasil provider; inspeksi artefak live belum dilakukan.
