# Animation Studio tahap 1 — 6 November 2026

Implementasi tahap pertama dari master prompt ForgeKit Animation Studio. Rencana dan capability matrix lengkap: [ANIMATION_STUDIO.md](../ANIMATION_STUDIO.md).

## Yang berubah

- **Kontrak `AnimationDocument` v2** (`packages/contracts/src/animation.ts`): `animationMode` character/object sebagai discriminated union; konvensi eksplisit (stud, Y-up, quaternion xyzw lokal relatif pose diam, detik); `motionIntent` dengan prompt asli, kebutuhan berkutipan (`excerpt`) dan `binding` ke clip/target/jendela waktu; clip dengan track rotasi/posisi, interpolasi linear/smooth/step, marker, loop/pingpong/once; batas eksplisit. Validator menolak target fiktif, quaternion tidak satuan, waktu tidak urut, dan putaran ≥180° antar key (wajib key perantara untuk putaran penuh).
- **Migrasi v1 → v2**: recipe Euler lama dibaca sebagai dokumen karakter tanpa mengubah pose; versi lama tidak ditulis ulang.
- **Validator Rust** (`src-tauri/src/animation.rs`) setara, ditambah dua aturan keras yang memicu repair provider otomatis: seam loop dan bagian yang dilarang bergerak. Mode yang dipilih di UI wajib sama dengan mode dokumen.
- **Request generator** membawa `animation` {mode, durationSeconds?, loopMode?, qualityProfile}; disimpan di snapshot tugas agar resume mempertahankan mode. Batas token output animasi naik.
- **Skill `animation-motion` 2.0.0**: prompt bebas sebagai sumber gerak (tanpa allowlist gerakan), MotionIntent, larangan, konflik kontrol vs teks dicatat sebagai asumsi, konvensi transform, mode karakter/objek, polish High Polish, revisi parsial.
- **Halaman Animasi**: tab *Animasi Karakter* / *Animasi Objek 3D*; input utama "Jelaskan animasi yang ingin kamu buat"; kontrol opsional (durasi, loop, profil kualitas default High Polish); viewport memutar dokumen tersimpan; timeline dengan langkah frame, kecepatan 0,25×–2×, marker yang bisa diklik, pemilih clip; panel laporan (status, kepatuhan prompt per kebutuhan, pemeriksaan otomatis, tahapan bukti, asumsi, yang belum diperiksa); editor dokumen v2.
- **QA otomatis** (`animationQuality.ts`, `animationScene.ts`): larangan diverifikasi numerik; aksi bergerak di jendela yang diikat ditandai "gerak terdeteksi" (makna tetap perlu tinjauan visual); seam loop pose + kecepatan; popping; kaki selip pada rig referensi lewat forward kinematics; objek dievaluasi relatif pose diam (tanpa drift). Status: `draft` / `needs_revision` / `technically_verified` — `artistically_reviewed` tidak pernah otomatis.
- **Ekspor GLB + verifikasi**: kurva di-bake 30 Hz, file dibaca ulang dengan GLTFLoader dan durasi, track serta nilai dibandingkan sebelum disimpan.
- **Panduan penerapan Studio** untuk v2 (KeyframeSequence pada Motor6D aktual; objek dengan CFrame diam × offset berbasis waktu).
- **Vault Obsidian**: salinan skill `animation-motion` diperbarui ke v2 (header lokal dipertahankan, tetap terdeduplikasi), `30 Fitur/Animasi` diperbarui, catatan baru `35 Pengetahuan/Animasi Kapabilitas dan Bukti` (status draft).

## Cara memakai

1. Buka **Kreasi → Animasi**.
2. Pilih **Animasi Karakter** atau **Animasi Objek 3D**.
3. Tulis geraknya dengan bebas (urutan, arah, kecepatan, gaya, bagian yang harus diam). Kontrol tambahan opsional.
4. Pilih akun/model, lalu Generate. Lihat pratinjau, laporan kualitas, dan checklist kepatuhan prompt.
5. Revisi dengan instruksi parsial ("perlambat bagian akhir", "tangan kiri tetap diam"), atau edit dokumen di bagian lanjutan.
6. **Ekspor GLB + verifikasi** untuk file yang sudah dibaca ulang; **Terapkan** ke Studio lewat alur persetujuan.

## Pengujian

- Contracts: 11 tes (validasi, evaluasi berbasis waktu 30 vs 60 FPS identik, shortest-path, migrasi, laporan kualitas, seam).
- Rust: 188 tes, termasuk 4 tes validator v2.
- Frontend: 419 tes, termasuk adegan (tanpa drift engsel, ekspor GLB dibaca ulang, kaki selip terdeteksi saat pinggul berputar) dan halaman (dua mode, mode terkirim, kepatuhan prompt, migrasi v1).
- Tes vault nyata: konteks animasi memuat 19 catatan; salinan skill v2 dikenali sebagai bawaan.
- Halaman diperiksa visual di browser (tanpa backend).

## Belum dilakukan (tahap 2–5)

- Generasi dengan provider live (belum ada akun AI tersambung di aplikasi saat ini).
- Inspeksi rig/objek aktual di Studio (RigProfile/BindingMap dari Motor6D/Bone), penerapan dan readback live, uji runtime (Play, blending, multiplayer, late join).
- Jalur Blender/FBX, retargeting rig kustom, IK, fisika.
- Pencatatan bukti per tugas ke vault dan promosi draft → tested.
- Tidak ada status `runtime_verified` yang diberikan.
