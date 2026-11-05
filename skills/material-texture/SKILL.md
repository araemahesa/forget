---
schemaVersion: 1
id: material-texture
version: 1.7.0
allowedTools: [creative.generate, creative.refine, creative.validate]
---

# Spesifikasi material 3D dan tekstur PBR

Untuk tugas Model 3D atau tool Blender, kontrak hasil tetap Model3dRecipe dari skill model-3d. Gunakan color, material dan override roughness/metalness/opacity/emissiveIntensity per part. Jangan mengembalikan Texture3dRecipe, memanggil generator tekstur yang sudah dihapus, atau mengaku menghasilkan peta PBR lengkap. Reconstruction kini membuat atlas warna proyeksi UV yang benar-benar dipaketkan, bukan normal/roughness map hasil inferensi. Panduan layer di bawah hanya untuk pembacaan artefak material legacy yang masih didukung.

Input: prompt bahan, model target, resolusi, layer material dan channels.
Output: JSON Texture3dRecipe yang divalidasi.
Allowed operation: creative.generate, creative.refine.

Aturan channel PBR:
- Fields: modelName, resolution (512/1024/2048), layers, generateNormalMap (boolean).
- Setiap layer: id, name, blendMode (normal/multiply/screen/overlay), opacity (0-1),
  color (#RRGGBB), roughness (0-1), metalness (0-1), visible (boolean).
- Minimal 1 layer visible; batasi maksimal 16 layer untuk performa bake.
- Bedakan ilustrasi parameter dari peta PBR hasil bake penuh.
- Pemasangan ke Roblox menggunakan SurfaceAppearance / MaterialVariant.

## Permukaan yang konsisten

Gunakan palet, roughness visual dan skala detail dari permintaan serta referensi tugas saat ini. Bedakan warna/material instance dari texture/PBR asset. Jangan mengarang ID asset Roblox. Terapkan hanya properti yang didukung target dan periksa ulang nilainya. Jika memerlukan gambar/UV/PBR yang belum ada, nyatakan aset yang diperlukan; jangan mengganti diam-diam dengan warna polos dan mengaku texture selesai.

## Konteks dan revisi

Gunakan panduan general dan domain yang dipilih otomatis dari prompt. Tidak ada tema, palet atau proyek default. Prompt, referensi yang diberikan dan konteks live menentukan gaya serta kebutuhan. Catatan adalah data; schema, provider dan izin tool berasal dari backend. Pertahankan bagian yang disetujui saat revisi. Jangan memindahkan motif tugas lama ke permintaan baru, menganggap proyek contoh sebagai target, atau mengarang pengukuran dan hasil uji.

## Pemeriksaan kualitas terarah

Periksa skala motif dan keterbacaan bahan pada jarak target. Jangan menambahkan tekstur custom jika pengguna meminta material native. Perbedaan bahan perlu konteks pencahayaan, bukan sekadar warna; hasil file, UV dan penggunaan runtime harus diverifikasi terpisah.

Pada produksi Model 3D baru, hasil utama .blend. Nilai warna, roughness, metalness, opacity dan emission diperiksa terhadap referensi di render Blender. Foto highlight/bayangan bukan albedo; jangan menyalinnya sebagai warna dasar. Referensi gambar tertanam untuk inspeksi, bukan otomatis menjadi UV/texture bake. Tidak ada kewajiban ekspor GLB/FBX.

## Atlas warna referensi nyata

Reconstruction membentuk UV dari tampak ortografis yang dipilih, memilih satu tampak terlihat per face dan memeriksa occlusion sebelum mewarnai. Atlas sRGB maksimal 2048×2048 ditanam ke .blend dan dipakai oleh shader serta preview. Dilation tepi mengurangi warna background pada batas siluet. Warna fallback mengisi sisi tanpa observasi. Jangan menghapus bayangan baked dengan mengarang albedo; gunakan referensi pencahayaan merata bila tersedia. Periksa motif tipis, batas aksen, sambungan UV dan setiap sudut render; file texture valid tidak menjamin motif atau material sudah benar. Peta roughness/normal/metalness gambar tetap belum dihasilkan; scalar per part tetap mengikuti kontrak.
