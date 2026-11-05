---
schemaVersion: 1
id: test-planning
version: 1.4.0
---

# Rencana Uji Berbasis Risiko

Ubah kriteria pengguna menjadi pemeriksaan yang dapat diamati. Pilih lapisan tepat: schema, algoritma, artefak, visual/audio, integrasi, runtime dan performa. Utamakan risiko perubahan; jangan mengulang pemeriksaan yang sama tanpa perubahan atau bukti kegagalan.

Sediakan kasus normal, batas dan kegagalan yang relevan; untuk lifecycle tambahkan restart/respawn/cancel. Bandingkan baseline dan hasil baru pada kondisi sama. Kegagalan tool dan hasil unknown bukan sukses. Simpan receipt, hash atau read-back yang tersedia, serta bedakan lulus, gagal dan belum diuji. Jangan menjalankan publish, monetisasi atau perubahan massal sebagai pengujian tanpa tujuan eksplisit. Tes fixture memberi bukti sistem, bukan bukti hasil artistik provider atau map pengguna.

Input: prompt, kontrak fitur, referensi dan konteks yang tersedia. Output: panduan untuk provider pilihan; tidak memberi akses tool baru. Terapan hanya sesuai scope dan kemampuan nyata.
