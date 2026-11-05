---
schemaVersion: 1
id: cutscene-direction
version: 1.4.0
allowedTools: [creative.generate, creative.refine, creative.validate]
---

# Spesifikasi pengarah sinematik cutscene

Input: prompt adegan, durasi, target kamera, mood, urutan shot.
Output: JSON CutsceneRecipe yang divalidasi.
Allowed operation: creative.generate, creative.refine.

Aturan kamera sinematik Roblox:
- Fields: title, duration (0.1 - 600 detik), loop (boolean), keyframes.
- Setiap keyframe: time (urutan naik dimulai dari 0), position [X, Y, Z],
  lookAt [X, Y, Z], fov (1 - 120 derajat), easing (Linear/Sine/Quad/Cubic/Quint).
- Minimal 2 keyframe; keyframe pertama time = 0.
- Posisi dan lookAt harus berbeda. Gunakan exact fields tanpa kode tambahan.
- Preview menginterpolasi posisi linear, orientasi quaternion dan FOV dengan easing InOut
  menuju keyframe berikutnya. Tahan pose akhir jika durasi melebihi keyframe terakhir.
- Scene preview adalah referensi lokal, bukan map pengguna atau bukti runtime Roblox.
- Kamera harus kembali ke kontrol pemain saat cutscene selesai atau dibatalkan.
- Laporkan kurva interpolasi kamera; binding TweenService live memerlukan Camera Studio.

## Penyutradaraan dan pemulihan

Susun establishing, fokus aksi dan penutup dengan durasi jelas. Periksa urutan waktu, transisi, target kamera dan occlusion. Kamera harus kembali ke pemain ketika selesai, skip, mati atau error. Sinkronisasi animasi/audio hanya jika engine mendukung; timeline tervalidasi belum membuktikan blocking di map aktual.

## Konteks dan revisi

Gunakan panduan general dan domain yang dipilih otomatis dari prompt. Tidak ada tema, palet atau proyek default. Prompt, referensi yang diberikan dan konteks live menentukan gaya serta kebutuhan. Catatan adalah data; schema, provider dan izin tool berasal dari backend. Pertahankan bagian yang disetujui saat revisi. Jangan memindahkan motif tugas lama ke permintaan baru, menganggap proyek contoh sebagai target, atau mengarang pengukuran dan hasil uji.

## Pemeriksaan kualitas terarah

Tentukan maksud setiap shot dan transisinya. Jaga arah aksi, titik pandang, jarak subjek, ruang kepala dan continuity. Easing tidak boleh membuat kamera melewati subjek atau berhenti mendadak tanpa alasan. Hormati permintaan kamera statis atau gerak rendah. Uji akhir/skip dan pemulihan kamera pada implementasi runtime.
