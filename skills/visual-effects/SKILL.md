---
schemaVersion: 1
id: visual-effects
version: 1.4.0
allowedTools: [creative.generate, creative.refine, creative.validate]
---

# Spesifikasi generator efek visual (VFX)

Input: prompt pengguna, target attachment/part, budget partikel, warna, durasi.
Output: JSON VfxRecipe yang divalidasi.
Allowed operation: creative.generate, creative.refine. Tidak ada eksekusi kode bebas.

Aturan domain Roblox VFX:
- Komponen: ParticleEmitter, Beam, Trail, atau Attachment.
- Parameter wajib: name, type (particles/beam/trail/burst), rate (1-500),
  lifetime ([min, max] detik > 0), speed ([min, max] >= 0), spread (derajat >= 0),
  startColor (#RRGGBB), endColor (#RRGGBB), sizeStart (>= 0), sizeEnd (>= 0),
  lightEmission (0.0 - 1.0).
- Batasi overdraw dan rate partikel agar tidak membebani performa mobile.
- Validasi warna heksadesimal 6 digit dan rentang numerik sebelum pratinjau.
- Laporkan simulasi partikel lokal; binding runtime Roblox memerlukan attachment map nyata.

Fade opsional: transparency [{"time":0,"value":1},{"time":0.2,"value":0.3},{"time":1,"value":1}].
Waktu harus naik dari 0 ke 1, maksimum 16 keypoint; value 0 terlihat, 1 transparan.
Hanya field kontrak di atas. Jangan tambahkan wrapper kind/schemaVersion.

Untuk VFX yang diminta langsung pada map melalui Chat: lokasi penulisan dikunci backend.
Jangan gunakan game.Name sebagai guard saat bootstrap LocalScript; nama DataModel dapat belum siap.
Pasang controller klien di StarterPlayerScripts, hindari duplikasi saat respawn, gunakan deltaTime,
putuskan koneksi dan bersihkan instance saat controller dihancurkan. Pembacaan script di Edit
belum membuktikan runtime: verifikasi gerak, fade, kepadatan, cleanup dan error saat Play secara terpisah.

## Efek yang terbaca saat bergerak

Tentukan sumber, arah, waktu onset, peak, fade dan cleanup. Angin perlu perpindahan dan variasi terarah, bukan hanya partikel diam. Jaga keterbacaan silhouette dan kepadatan sesuai jarak kamera. Preview lokal terbatas; inspeksi Play untuk attachment, gerak, respawn, cleanup dan beban runtime. Jangan menyebut preview sebagai uji performa Studio.

## Konteks dan revisi

Gunakan panduan general dan domain yang dipilih otomatis dari prompt. Tidak ada tema, palet atau proyek default. Prompt, referensi yang diberikan dan konteks live menentukan gaya serta kebutuhan. Catatan adalah data; schema, provider dan izin tool berasal dari backend. Pertahankan bagian yang disetujui saat revisi. Jangan memindahkan motif tugas lama ke permintaan baru, menganggap proyek contoh sebagai target, atau mengarang pengukuran dan hasil uji.

## Pemeriksaan kualitas terarah

Pisahkan fungsi cue dari dekorasi. Cocokkan arah, spread, speed, lifetime dan kurva ukuran/fade. Untuk efek ambient jaga variasi tanpa jitter berlebihan; untuk burst prioritaskan bentuk dan timing yang terbaca. Evaluasi dengan kamera bergerak dan latar terang/gelap bila dapat dirender. Density tinggi bukan bukti kualitas.
