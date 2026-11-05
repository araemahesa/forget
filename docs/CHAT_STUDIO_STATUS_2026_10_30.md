# Status Studio pada AI Chat — 30 Oktober 2026

## Perubahan

Header AI Chat menampilkan ikon dan teks status di samping judul. `Studio terhubung` berwarna hijau ketika store `useStudioSnapshot()` memiliki map yang sudah diverifikasi melalui pembacaan state MCP. Tanpa snapshot valid, header menampilkan `Studio belum terhubung` dengan ikon dan warna netral. Kehadiran proses Studio saja tidak dianggap map terhubung.

Status mengikuti store koneksi yang sudah ada, termasuk saat koneksi terputus; tidak ada polling, endpoint, atau data simulasi baru di produk. Tooltip terhubung menampilkan nama map; status belum terhubung menjelaskan pembukaan map dan koneksi MCP. Tooltip Explorer yang lama menyebut Pengaturan juga diperbaiki.

Ikon, teks dan judul sejajar pada layar lebar. Baris judul dapat membungkus pada layar kecil, tombol aksi tidak menyusut, dan judul percakapan panjang memakai ellipsis. Badge memakai live region berlabel agar perubahan dapat diumumkan pembaca layar.

## Pemeriksaan sumber

- Typecheck, build dan 30 tes fokus ChatPage/App/Studio state lulus. Tes baru memeriksa status belum terhubung, koneksi map, nama map dan putus koneksi tanpa memuat ulang halaman. Satu selector tes Stop yang semula menganggap hanya ada satu status diperjelas setelah penambahan status baru.
- Dua belas pemeriksaan layout browser memakai fixture IPC: status terhubung/belum, tema gelap/terang, lebar 1440/720/390. Header tidak keluar batas atau bertabrakan dengan tombol. Screenshot fixture bukan bukti koneksi Studio live. Percobaan awal dengan server HTTP sederhana sempat timeout pada pemuatan halaman; pemeriksaan final melalui Vite preview lulus.
- Full suite dan Rust unit tests tidak diulang untuk perubahan UI ini. Backend koneksi tidak diubah.

## Pemasangan dan hasil native

ForgeKit **0.1.15** terpasang di `/Applications/ForgeKit Studio.app`. App/DMG lulus pemeriksaan versi, signature ad-hoc, arm64, CRC dan kecocokan executable. Bundle 0.1.14 dipindahkan ke Trash. Notarization dan mesin bersih tidak diuji.

Header native menampilkan ikon dan `Studio belum terhubung` sejajar dengan AI Chat. Kondisi terhubung serta peralihannya diuji melalui tes komponen dan fixture browser; sesi MCP live baru tidak dibuat atau diklaim. Tidak ada map yang diubah dan tidak ada chat provider baru dikirim.

Seluruh 32 tabel schema 15 identik pada jumlah baris dan hash sebelum/sesudah pemasangan serta peluncuran. Integrity `ok`, tanpa pelanggaran foreign key.

Bukti: [verification.json](test-evidence/2026-10-30/chat-studio-status/verification.json), [installation.json](test-evidence/2026-10-30/chat-studio-status/installation.json), [bundle.json](test-evidence/2026-10-30/chat-studio-status/bundle.json), [visual/report.json](test-evidence/2026-10-30/chat-studio-status/visual/report.json), serta log typecheck, focused, build dan release. Screenshot browser adalah fixture layout, bukan data pengguna.
