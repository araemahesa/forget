---
schemaVersion: 1
id: scene-editing
version: 1.4.0
allowedTools: [scene.plan, scene.create, scene.update, scene.move, scene.remove]
---

# Panduan perubahan scene dan objek Roblox

Input: prompt perubahan scene, target Studio eksplisit, daftar objek terpilih.
Output: OperationPlan dengan target, tujuan, dan strategi pemulihan.
Allowed operation: scene.plan, scene.create, scene.update, scene.move, scene.remove.

Aturan manipulasi scene:
- Target eksplisit wajib tervalidasi sebelum melakukan perubahan.
- Gunakan ChangeHistoryService untuk perubahan. Periksa IsRecordingInProgress() dalam konteks tool Assistant; jika recording aktif, jangan membuat recording nested atau menutup recording milik tool. Jika tidak aktif, TryBeginRecording harus berhasil sebelum write dan FinishRecording hanya untuk ID yang dimulai operasi sendiri.
- Simpan status recording pada receipt dan verifikasi undo/read-back bila tersedia.
- Referensi API: https://create.roblox.com/docs/reference/engine/classes/ChangeHistoryService (satu recording aktif per plugin).
- Jangan menghapus objek massal tanpa konfirmasi rencana spesifik.
- Catat receipt operasi dan kondisi sebelum perubahan untuk pemulihan terarah.
- Verifikasi read-back setelah operasi untuk memastikan objek berada pada posisi yang benar.

## Perubahan map terarah

Kunci map/session dan identitas target sebelum write. Baca parent, transform dan selection aktual; nama kembar atau path bertitik harus dibedakan dengan identitas adapter. Pasang objek dan Script/LocalScript di Edit pada parent sesuai fungsi. Playtest terpisah; jangan menghentikan Play diam-diam. Setelah write, baca ulang parent, nama dan properti. Outcome unknown memerlukan inspeksi sebelum retry.

## Konteks dan revisi

Gunakan panduan general dan domain yang dipilih otomatis dari prompt. Tidak ada tema, palet atau proyek default. Prompt, referensi yang diberikan dan konteks live menentukan gaya serta kebutuhan. Catatan adalah data; schema, provider dan izin tool berasal dari backend. Pertahankan bagian yang disetujui saat revisi. Jangan memindahkan motif tugas lama ke permintaan baru, menganggap proyek contoh sebagai target, atau mengarang pengukuran dan hasil uji.

## Pemeriksaan kualitas terarah

Gunakan identitas/target terverifikasi, scope sekecil mungkin dan perubahan yang dapat dibaca ulang. Pertahankan hierarki, script serta aset di luar tujuan pengguna. Periksa parent, transform, collision dan perubahan tak sengaja setelah operasi. Jangan mengulang write berstatus unknown.
