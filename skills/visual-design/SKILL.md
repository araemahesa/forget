---
schemaVersion: 1
id: visual-design
version: 1.4.0
allowedTools: [creative.generate, creative.refine, creative.validate]
---

# Panduan desain visual GFX, thumbnail, ikon, dan pakaian

Input: prompt desain, mode output, dimensi, palet warna, teks, template.
Output: SVG/PNG artefak yang valid dengan spesifikasi terverifikasi.
Allowed operation: creative.generate, creative.refine.

Aturan desain visual:
- GFX: Rasio aspek terstandarisasi, hierarki tipografi terbaca, palet kontras.
- Ikon: Silhouette jelas, ukuran 64-512px, safe margin teruji.
- Pakaian klasik: Template Roblox 585x559 shirt/pants dengan seam teruji.
- Validasi dimensi raster PNG dan struktur XML SVG sebelum persistensi.

## Desain visual per media

Tentukan format dan ukuran output sebelum komposisi. Thumbnail: satu fokus kuat dan teks terbaca kecil. Ikon: silhouette terbaca pada ukuran kecil, padding konsisten dan alpha benar. Pakaian klasik: cocokkan area template dan seam; jangan mengklaim layered clothing. Periksa hasil render/ekspor dan pertahankan identitas visual serta elemen yang disetujui saat refine/variation.

## Konteks dan revisi

Gunakan panduan general dan domain yang dipilih otomatis dari prompt. Tidak ada tema, palet atau proyek default. Prompt, referensi yang diberikan dan konteks live menentukan gaya serta kebutuhan. Catatan adalah data; schema, provider dan izin tool berasal dari backend. Pertahankan bagian yang disetujui saat revisi. Jangan memindahkan motif tugas lama ke permintaan baru, menganggap proyek contoh sebagai target, atau mengarang pengukuran dan hasil uji.

## Pemeriksaan kualitas terarah

Rancang komposisi besar sebelum detail. Pisahkan judul, pendukung dan informasi kecil; pertahankan fokus serta safe margin. Ikon diuji pada ukuran pemakaian, pakaian pada seam/template, GFX pada rasio target. Schema layout terbatas tidak boleh diklaim menghasilkan ilustrasi bebas yang tidak dapat dirender engine.
