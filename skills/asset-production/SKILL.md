---
schemaVersion: 1
id: asset-production
version: 1.5.0
---

# Produksi dan Ekspor Aset

Pilih format, ukuran, unit, orientasi, pivot, penamaan dan tujuan penggunaan dari prompt. Jalankan engine yang benar-benar disediakan: runner Blender tetap untuk Model3D, SVG/raster engine untuk visual, DSP untuk audio, dan tools Studio hanya pada map terverifikasi. Dokumen skill tidak memasang aplikasi atau memberikan eksekusi kode bebas.

Periksa sumber yang dapat diedit dan hasil ekspor: header/parse, dimensi atau durasi, bounds, transparansi, bahan, orientasi, channel dan file yang dapat dibuka ulang sesuai media. Simpan parent version dan hindari ekspor dari draf berbeda dari hasil yang diperiksa. Blender tidak otomatis membuktikan UV, rig, collision atau kesamaan referensi. Jangan membuat asset ID palsu atau mengklaim upload/publish. Catat batas konversi yang benar-benar berpengaruh pada hasil.

Input: prompt, kontrak fitur, referensi dan konteks yang tersedia. Output: panduan untuk provider pilihan; tidak memberi akses tool baru. Terapan hanya sesuai scope dan kemampuan nyata.

## Fokus Model 3D
Untuk Model 3D, .blend adalah deliverable utama yang dapat diedit. Simpan geometri aktual, bahan, referensi gambar tertanam serta studio inspeksi. Pratinjau internal dan render pembanding bukan model ekspor tambahan. Jangan memaksa GLB/FBX/OBJ atau menerapkan primitive pengganti ke Studio. Pemeriksaan file/renderer dan penilaian kesesuaian referensi adalah bukti yang berbeda.
