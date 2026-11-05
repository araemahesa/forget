# Lampiran multimodal dan drag & drop — ForgeKit 0.1.8

AI Chat menerima file lewat tombol **+** di samping pesan atau drag & drop ke area penulisan. Model 3D generator memakai pemroses lampiran yang sama. Maksimal tiga file per permintaan, 10 MiB per gambar dan 32 MiB per file lain; pilihan bertahap dan penghapusan terlihat sebagai kartu. Pesan bisa dikirim dengan lampiran tanpa mengetik prompt; prompt bawaan meminta AI menjelaskan isinya.

Format yang diterima: PNG/JPG/JPEG/WebP; PDF; MP4/MOV/WebM/MKV; MP3/WAV/M4A/OGG/FLAC/AAC; GLB/FBX/OBJ/STL/PLY/BLEND; TXT/MD/JSON/CSV/LUA/LUAU/JS/TS/PY/HTML/CSS/XML. Format lain ditolak dengan pesan jelas. Native Tauri memakai drop DOM untuk menghindari akses filesystem luas; hanya file yang diberikan pengguna dikirim sebagai byte ke command pemroses. Gambar tetap dikecilkan menjadi PNG. File lain diproses lokal:

- PDF: teks hingga 12 halaman atau 24.000 byte dan gambar hingga tiga halaman pertama menggunakan Poppler.
- Video: frame pada 0, 5, dan 15 detik bila tersedia menggunakan FFmpeg. Audio ditranskripsi bila tersedia; bila gagal, kartu mencatat bahwa audio tidak dianalisis.
- Suara: FFmpeg menghasilkan PCM 16 kHz, lalu Whisper.cpp dengan `ggml-base.bin` lokal menghasilkan transkrip 120 detik pertama. Transkrip dapat salah mengenali ucapan.
- Model 3D: Blender mengimpor format terpilih, menolak geometri kosong atau lebih dari 2.000 objek/1 juta vertex, kemudian merender tiga tampak Workbench dan mencatat ukuran. Eksekusi skrip otomatis Blender dinonaktifkan. Tekstur, rig, animasi, dan file eksternal yang tidak disertakan tidak dianalisis.
- Teks dan kode: UTF-8 hingga 24.000 byte, sisanya ditandai terpotong.

AI menerima hasil ekstraksi berupa teks dan PNG yang sudah dibatasi, bukan file biner asli. Isi lampiran diberi label sebagai data referensi, bukan instruksi. Batas dan kegagalan ekstraksi ditampilkan sebelum tombol kirim aktif. Kartu, isi hasil ekstraksi dan konteks pesan disimpan dalam jurnal chat. Tidak ada perubahan skema database atau akses shell dari frontend.

Sarana lokal dipasang dari Homebrew resmi: `poppler`, `whisper.cpp`; `ffmpeg` dan Blender sudah ada. Model Whisper `ggml-base.bin` tersedia di folder model aplikasi. Instalasi ini perlu tersedia juga di Mac lain untuk format terkait; ketidaktersediaannya ditampilkan sebagai error. UI dan build aplikasi hanya mengemas kode ForgeKit, tidak mengemas installer Homebrew atau model suara.

Verifikasi akhir dicatat setelah paket terpasang.
