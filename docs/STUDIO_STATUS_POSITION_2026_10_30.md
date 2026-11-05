# Posisi status Studio pada bar atas — 30 Oktober 2026

Ikon dan status koneksi Studio dipindahkan dari judul percakapan ke bar atas, tepat setelah breadcrumb AI Chat di sebelah merek ForgeKit Studio. Status hanya tampil pada tujuan AI Chat dan tidak diduplikasi pada header percakapan.

Badge tetap mengikuti snapshot map MCP terverifikasi: terhubung hijau dengan tooltip nama map, belum terhubung netral dengan petunjuk koneksi. Store/polling backend tidak diubah. Pada layar sempit merek mengikuti perilaku logo yang sudah ada; ikon, breadcrumb dan status tetap satu baris, dengan ellipsis bila ruang terbatas.

## Pemeriksaan sumber

- Typecheck, build dan 30 tes fokus App/ChatPage/Studio state lulus. Tes memeriksa urutan posisi setelah AI Chat, satu badge saja, perubahan koneksi dan hilangnya badge ketika menuju Pengaturan.
- Enam belas pemeriksaan layout fixture browser lulus pada tema gelap/terang, terhubung/belum terhubung dan lebar 1440/720/390/320. Logo, breadcrumb dan status tidak bertabrakan atau keluar batas, serta pusat vertikal breadcrumb dan badge sejajar.
- Build awal tertahan karena kenaikan versi app sempat ikut mengubah `find-msvc-tools` dari 0.1.15 menjadi 0.1.16. Entri dependensi dikembalikan ke 0.1.15; versi app tetap 0.1.16. Tidak ada upgrade dependensi yang disengaja.
- Screenshot fixture tidak membuktikan sesi MCP live. Full suite dan Rust unit tests tidak diulang untuk pemindahan UI ini.

Pemasangan dan hasil native dicatat setelah installer selesai. Bukti berada di `test-evidence/2026-10-30/studio-status-position/`.
