---
schemaVersion: 1
id: sky-atmosphere
version: 1.4.0
allowedTools: [creative.generate, creative.refine, creative.validate]
---

# Langit dan atmosfer prosedural

Input: prompt suasana, warna, waktu dan previousRecipe bila merevisi.
Output: satu JSON SkyboxRecipe; tanpa markdown atau kode.

- Fields wajib: schemaVersion=1, name (1-60 karakter), preset, timeOfDay,
  sunElevation, sunAzimuth, topColor, horizonColor, bottomColor, sunColor,
  starDensity, cloudCover, haze, resolution, seed.
- preset: clear_day, sunset, night_stars, overcast, blood_moon, alien_nebula.
- timeOfDay 0-24, sunElevation -90..90, sunAzimuth 0-360.
- Empat warna harus #RRGGBB. starDensity/cloudCover/haze 0-1.
- resolution 512 atau 1024; seed integer 0-999999.
- Revisi mempertahankan field yang tidak diminta berubah.
- Renderer menghasilkan ilustrasi enam sisi SVG, bukan panorama fotografis.
  Jangan menjanjikan sambungan cubemap mulus atau asset Roblox siap upload.
- Validasi native sebelum commit; kegagalan mempertahankan versi induk.
- Task, versi induk, skill hash dan artefak JSON dicatat bersama.
- Tidak ada upload, write Studio atau undo map pada skill ini.

## Atmosfer dan orientasi

Kunci waktu, arah cahaya, palet horizon/zenith dan mood proyek. Periksa konsistensi enam sisi, seam serta keterbacaan gameplay. Ekspor wajah SVG tidak sama dengan asset Sky Roblox yang sudah diunggah. Gunakan ID pengguna yang sah untuk pemasangan dan validasi Lighting pada target aktual.

## Konteks dan revisi

Gunakan panduan general dan domain yang dipilih otomatis dari prompt. Tidak ada tema, palet atau proyek default. Prompt, referensi yang diberikan dan konteks live menentukan gaya serta kebutuhan. Catatan adalah data; schema, provider dan izin tool berasal dari backend. Pertahankan bagian yang disetujui saat revisi. Jangan memindahkan motif tugas lama ke permintaan baru, menganggap proyek contoh sebagai target, atau mengarang pengukuran dan hasil uji.

## Pemeriksaan kualitas terarah

Pilih kondisi langit dari prompt, bukan preset favorit. Periksa orientasi horizon dan cahaya, seam sisi, value contrast, saturasi dan visibilitas subjek. Hindari fog atau bloom berlebihan yang menghilangkan navigasi. Preview cube bukan bukti lighting dan cuaca runtime.
