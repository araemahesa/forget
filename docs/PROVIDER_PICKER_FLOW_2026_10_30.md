# Pemilih provider dan akun — 30 Oktober 2026

ForgeKit 0.1.17 mengubah pemilih bersama menjadi dua langkah pada menu yang sama: provider dengan logo, lalu akun yang terhubung pada provider tersebut. Daftar akun hanya memuat identitas, metode koneksi, penanda utama, dan pilihan aktif. Kuota tidak dimuat atau ditampilkan oleh menu pemilih.

Tombol meter membuka panel rincian penggunaan dengan akun yang dipilih. Seluruh editor aktif yang memakai `EditorAiPromptBar` kini juga menyediakan tombol tersebut, seperti AI Chat dan generator.

## Perubahan

- `ProviderPicker.tsx`: navigasi provider/akun; penghapusan hook dan detail usage dari daftar akun; identitas email tidak digandakan.
- `Dropdown.tsx`: mode navigasi grup menggunakan perilaku posisi, fokus, keyboard, dan penutupan yang sudah ada. Tombol kembali berada di luar listbox. Escape/ArrowLeft kembali ke provider, kemudian Escape menutup menu.
- `controls.css`: akun ringkas, ellipsis untuk nama panjang, penanda Utama tidak terbelah, daftar tanpa bullet bawaan.
- `EditorAiPromptBar.tsx`: akses rincian kuota lewat tombol meter.

## Validasi

- Typecheck dan build frontend lulus.
- 25 tes fokus Dropdown, ProviderPicker, OrcaUsagePanel, ChatPage, dan EditorAiPromptBar lulus. Termasuk pemilihan lewat keyboard, pemisahan akun berdasarkan provider, tidak ada pembacaan kuota saat menu dibuka, serta rincian kuota melalui meter.
- Full run: 53 tes kontrak dan 275 tes desktop lulus; dua tes Skybox masih memakai urutan pemilih lama. Setelah kedua tes disesuaikan, ketujuh tes Skybox lulus. Total kasus frontend final adalah 53 kontrak dan 277 desktop.
- Rust: 133 tes lulus, tiga acceptance test bergantung lingkungan dilewati. Percobaan paralel awal mengalami kegagalan/hang pada transport fixture; tes bermasalah lulus sendiri, dan suite berurutan selesai tanpa kegagalan. Log akhir berada di `test-evidence/2026-10-30/provider-picker-flow/rust-tests.log`.
- Bundle app/DMG 0.1.17 dan tanda tangan ad-hoc diverifikasi. Executable terpasang memiliki SHA-256 `5051512d405a7f33427982e8137b817d7aac325896b77c41801dadfc2d785b03`. Installer bukan uji pada mesin bersih.
- Aplikasi terpasang dibuka kembali. Menu provider dan kedua akun OpenAI diperiksa langsung tanpa bagian usage. Aksesibilitas panel meter mengembalikan identitas akun pilihan dan nilai 5h/mingguan dari sambungan akun; generasi provider baru tidak dijalankan.
- Database tetap schema 15, integrity check `ok`, tanpa pelanggaran foreign key. Hash dan jumlah baris percakapan serta karya pada tujuh tabel yang diperiksa sama sebelum dan sesudah pemasangan.

Pemasangan hanya mengganti bundle aplikasi di `/Applications/ForgeKit Studio.app`. Salinan aplikasi sebelumnya berada sementara di `/tmp/forgekit-previous-0.1.16.U9CrkI/ForgeKit Studio.app`. Snapshot database sebelum/sesudah dan verifikasi installer berada di `docs/test-evidence/2026-10-30/provider-picker-flow/`.
