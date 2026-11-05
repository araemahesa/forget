# Layout dan viewport 3D — ForgeKit 0.1.19

## Perubahan

- Editor memakai ukuran heading, jarak, panel dan tombol yang sama. Panel prosedural menggunakan satu scroll halaman; kontrol tidak lagi terkunci dalam dua panel dengan tinggi tetap. Informasi runtime panjang dipindahkan ke detail yang dapat dibuka.
- Prompt bar GFX/SFX diringkas; model dan penalaran berdampingan, atribusi akun berulang dihapus. Warna panel mengikuti token tema. Ikon tetap vektor; navigasi utama tetap floating tanpa kolom sidebar.
- Viewport bersama menggunakan WebGL/Three.js dengan OrbitControls: orbit, pan, zoom, bingkai semua objek, depan, kanan, atas, grid, wireframe, pemilihan dan daftar struktur. Memilih dari struktur memfokuskan kamera pada objek. F/1/3/7 tersedia saat canvas mendapat fokus.
- Model 3D menampilkan grid interaktif sebelum hasil tersedia, kemudian geometri recipe atau mesh GLB hasil Blender. Ekspor tetap memuat geometri aktual; tidak mengganti hasil dengan gambar.
- Animasi menampilkan rig standar sebelum generasi. Setelah ada recipe, tipe R6/R15 dipilih otomatis dari recipe, pose diputar melalui quaternion pada sambungan Motor6D, dan GLB memuat rig beserta track animasi.
- VFX SVG diganti simulasi spasial: partikel memiliki koordinat XYZ dan shader point sprites, beam memakai mesh silinder, trail memakai mesh tabung yang berubah saat playback. Burst dibedakan dari emisi kontinu. Jumlah partikel dibatasi 2048; bingkai awal mencakup volume seluruh umur emitter.
- Cutscene mengganti cuboid acuan dengan rig Roblox R15. Mode lintasan bisa diorbit, mode kamera mengikuti keyframe, FOV dan easing. Ekspor LocalScript tetap memulihkan kamera setelah berhenti.
- GUI menyediakan dua mode: struktur elemen berlapis dalam 3D serta layar 2D. Perhitungan posisi mengikuti UDim2, parent dan anchor. Pemilihan elemen pada struktur memperbarui editor. ScreenGui runtime tetap antarmuka 2D; mode 3D adalah inspeksi komposisi, bukan konversi otomatis ke SurfaceGui.
- NPC menampilkan rig R15 3D bersama simulasi dialog bercabang yang tetap interaktif. Pada layar lebar, karakter dan dialog berdampingan.
- Arahan penerapan melalui provider meminta inspeksi rig aktual dan penggunaan Humanoid R6/R15 asli; rig baru memakai API Players dengan HumanoidDescription, mempertahankan Motor6D serta Animator.

## Sumber rig

`roblox-rigs.json` menyimpan ukuran, warna, CFrame serta Motor6D C0/C1 yang dibaca dari model bawaan Studio: `rbxasset://models/Thumbnails/Mannequins/R6.rbxm` dan `rbxasset://avatar/characterR15.rbxm`. Model sementara tidak diparentkan ke map dan dihancurkan setelah inspeksi.

Empat belas mesh tubuh R15 dibaca dari ID aset yang tercantum pada model bawaan. Kepala memakai `rbxasset://avatar/heads/head.mesh`. `roblox-rig-meshes.json` menyimpan posisi, normal, UV, indeks, URL sumber dan SHA-256. Script build `scripts/build_roblox_rig_assets.py` memvalidasi format mesh v2 dan menghasilkan 15 mesh, total 2762 triangle. Tidak ada pengambilan aset atau login saat viewport dipakai. Proporsi, sambungan dan mesh berasal dari Roblox; rendering preview memakai Three.js.

## Finalisasi kelanjutan chat

Kelanjutan membaca chat bersama “Perbaiki tampilan Hermes” pada tautan `cx_6ae4a66060408191904e35a62f698e29` dan mencocokkannya dengan implementasi 0.1.18 yang sudah terpasang. Perubahan sebelumnya dipertahankan. Dua kekurangan viewport bersama diperbaiki:

- Pembingkaian kamera memperhitungkan FOV vertikal dan horizontal. Objek tidak lagi terpotong karena panel menyempit. Resize mempertahankan arah orbit dan skala pembingkaian.
- Struktur model tidak lagi berhenti pada 512 objek. Daftar dimuat bertahap per 128 objek, dengan tombol dan jumlah sisa. Ini adalah struktur artefak lokal, terpisah dari Explorer map live.

## Validasi final 0.1.19

- `pnpm typecheck`: lulus.
- `pnpm test --run --maxWorkers=1`: 53 tes kontrak dan 289 tes desktop lulus pada run lengkap. Tujuh tes baru memeriksa proyeksi bounds pada lima rasio layar, resize kamera, serta keterjangkauan objek ke-513.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1`: 133 lulus, tiga opt-in dilewati. Dijalankan berurutan untuk mencegah benturan fixture Keychain.
- `pnpm build`: lulus. Vite memberi peringatan chunk bersama StudioApply lebih dari 500 kB; build tetap berhasil.
- Enam editor 3D diperiksa pada 1920×1080, 1440×900, 1280×800, 1024×700 dan 720×450. Tidak ditemukan overflow horizontal halaman atau kontrol yang melewati sisi kanan. Layar kecil memakai satu scroll halaman; preview tetap dapat dijangkau di bawah kontrol.
- Browser UI final: sudut Kanan, struktur 15 mesh R15 dan pemilihan Head berfungsi. GUI beralih ke Layar 2D. Dialog NPC berpindah ke node quest. Log warning/error browser yang diperiksa kosong. Browser memakai data bawaan editor, tanpa koneksi backend desktop; bukti ini merupakan bukti layout/interaksi lokal, bukan generasi provider atau map live.
- Tambahan 90 kombinasi layout: Terang/Nyaman, Terang/Ringkas dan Gelap/Ringkas, masing-masing pada enam editor dan lima ukuran. Semuanya tanpa overflow horizontal atau kontrol melewati tepi kanan. Tema/density aplikasi native tidak diubah.
- Log dan screenshot kelanjutan berada di `docs/test-evidence/2026-10-30/interactive-3d-final/`.

## Validasi sebelumnya (0.1.18)

- Typecheck dan build frontend lulus.
- Suite awal: 53 tes kontrak lulus, desktop 280 lulus dan dua gagal. Atribusi lama sudah dihapus sehingga tes prompt bar diperbarui. Tes navigasi Settings memakai timeout pemuatan lazy yang konsisten dengan tes navigasi lainnya. Pemeriksaan ulang kedua file: 18 tes lulus. Total kasus desktop saat itu: 282; run lengkap 0.1.19 di atas menggantikan hasil parsial ini.
- Tes khusus geometri, ekspor, rig, VFX, GUI dan kamera: 13 lulus. Setelah perbaikan volume bingkai emitter, tiga tes VFX diulang dan lulus.
- Backend Rust: 133 tes lulus, tiga tes acceptance yang membutuhkan lingkungan khusus dilewati.
- Aplikasi macOS dibuka langsung ke AI Chat. Sembilan halaman kreatif diperiksa. Drag pada canvas Animasi mengubah sudut rig; dialog NPC berpindah ke cabang pilihan; GUI berhasil beralih 3D ke layar 2D dan kembali. Panel provider tetap memakai akun tersambung.
- Browser menampilkan mesh Roblox R15; tombol sudut kanan mengubah kamera. Simulasi partikel 3D tampil tanpa error shader pada log yang diperiksa. Mode GUI 3D tampil, daftar struktur terbuka, dan pilihan CloseButton memfokuskan objek.

## Pemasangan final

ForgeKit 0.1.19 dipasang di `/Applications/ForgeKit Studio.app`, lalu dibuka kembali. Paket app dan DMG ARM64 lolos `scripts/verify_macos_bundle.py`: codesign, CRC DMG, executable pada DMG identik dan marker harness acceptance tidak disertakan. Tanda tangan masih ad-hoc; belum notarized dan belum diuji pada Mac bersih.

Seluruh 32 tabel database identik selama pemasangan. Pemeriksaan ulang setelah restart memastikan tujuh tabel chat/karya tetap identik dan `integrity_check = ok`. Versi aplikasi lama dipindahkan ke Trash untuk pemulihan; akun, karya, chat lama dan perubahan Git tetap dipertahankan.

Native final menunjukkan chat lama, akun/model tersambung dan target Studio terdeteksi. Rig R15 dirender, drag mengubah sudut orbit dan struktur menampilkan 15 bagian. Halaman NPC final juga menampilkan rig serta dialog. Tidak ada generasi provider baru atau perubahan map untuk kelanjutan ini. Animasi tanpa versi tersimpan tetap diberi label “Belum ada motion”; preview rig bukan bukti motion baru sudah dihasilkan. State tugas lama yang belum selesai dipertahankan.

## Batas pengujian

Preview lokal tidak menjalankan mesin Roblox. Retarget ke rig map khusus, collision/foot sliding, hasil material/partikel identik dengan Roblox serta perilaku Play tetap memerlukan pemeriksaan di Studio. Tidak ada generasi provider baru, upload aset, publish, atau perubahan map live untuk tugas ini. GFX/SFX dan output gambar tetap memakai preview 2D yang sesuai dengan jenis aset.

Pemeriksaan zoom teks 200%, seluruh urutan keyboard dan pengukuran kontras formal belum diulang pada kelanjutan ini. Matriks ukuran/tema/density menguji layout browser; bukti native dicatat terpisah.
