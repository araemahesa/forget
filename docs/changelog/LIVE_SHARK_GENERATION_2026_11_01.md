# ForgeKit Studio 0.1.34: prompt hiu berhasil melalui aplikasi

Permintaan pengguna: jalankan prompt hiu dan referensi yang sudah terisi sampai hasil tersimpan.

## Bug nyata yang ditemukan

Klik Generate pada 0.1.31 menghasilkan `Transisi task tidak sah.` sebelum inference. Jalur generator mengirim tahap planning → streaming, sedangkan journal mengizinkan transisi tersebut hanya untuk chat.

## Perbaikan

Journal mengizinkan planning → streaming → validating untuk generator, serta transisi tool yang sama. Streaming berulang saat pergantian akun bersifat idempotent; tugas terminal tetap tidak dapat dibuka ulang melalui transisi tersebut. Tes regresi mencakup model3d, vfx, dan interface.

## Validasi

5 tes journal lolos. Seluruh suite backend secara serial: 151 lolos, 6 diabaikan. Percobaan paralel dihentikan karena fixture transport menunggu koneksi akibat pembatalan stream lintas tes; pengulangan serial selesai dalam 6,06 detik.

0.1.32 dibangun, tanda tangan diverifikasi, dipasang, lalu dibuka. Hash tabel chat dan karya sama sebelum/sesudah pemasangan; database dicadangkan.

## Uji langsung

Prompt asli hiu dan gambar asli dipertahankan; Generate diklik pada Model 3D memakai akun Codex berikutnya dengan GPT-6.1-Sol. Tugas `e842a3e8-03c4-4dc6-9c08-55a8a4e67651` berhasil memasuki streaming/provider_request. Percobaan ini kemudian menemukan batas transport di bawah.


## Perbaikan transport 0.1.33

Percobaan nyata `e842a3e8-03c4-4dc6-9c08-55a8a4e67651` kemudian gagal dengan `Respons AI melampaui batas 2 MiB.`. Batas ini menghitung seluruh metadata SSE per token, bukan teks model saja. Respons sah yang panjang dapat melampauinya.

Transport sekarang menerima sampai 32 MiB wire data, 4 MiB per baris/event, dan tetap membatasi teks output 2 MiB. Pembatalan, timeout, status HTTP, dan persyaratan event terminal tetap diperiksa. Fixture curl mengirim 10.000 delta dengan metadata (lebih dari 2 MiB), memverifikasi teks utuh; fixture stream terpotong tetap ditolak.

Suite backend serial 0.1.33: 151 lolos, 6 diabaikan, 6,53 detik. Uji langsung diulang setelah pemasangan.


## Pemulihan konteks 0.1.34

Tugas `0a62ede1-72f9-4669-93d2-6538af2d23d9` menerima recipe 68 bagian dan 9.168 segitiga, membangun `.blend`, membukanya ulang, serta menghasilkan tiga render. Pemeriksaan provider mengusulkan revisi kepala, badan, insang, dan aksen merah. Revisi juga berhasil dibangun. Pemeriksaan kedua kemudian terblokir `[CONTEXT_LIMIT]` karena recipe dan render putaran sebelumnya dikirim kembali secara berulang.

Konteks pemeriksaan sekarang mempertahankan seluruh instruksi/input asli dan receipt sebelum fase review, lalu hanya putaran review terbaru. Evaluasi lama tetap ada dalam checkpoint ReviewState. Pemulihan menghitung kapasitas dengan konteks yang sama, sehingga tugas lama yang terblokir dapat dilanjutkan melalui Selesaikan jawaban tanpa mengulang generasi. Tes regresi memverifikasi input/receipt asli, gambar render terbaru, sifat idempotent, dan recovery pada konteks lama yang melampaui batas.


## Hasil akhir terverifikasi

Versi 0.1.34 dipasang dan dibuka. Tugas yang sama dilanjutkan dengan tombol **Selesaikan jawaban**, bukan melalui perubahan manual database. Konteks teks sesudah pemulihan 202.557 byte, di bawah 262.144 byte. Validator menolak satu usulan review dengan mesh degenerat dan melakukan satu putaran repair.

Tugas `0a62ede1-72f9-4669-93d2-6538af2d23d9` berakhir **preview_ready**, error=null, checkpoint `reference_checked`, validation=passed. Versi tersimpan `creative-version-1793548910976-1`. UI memperlihatkan **Proses Selesai**, **Model tersimpan**, judul **Hiu Putih Besar Charcoal Crimson**, dan 9.388 triangle. Tombol Bingkai dipakai untuk memusatkan tampilan.

Bundle final cocok persis dengan recipe versi tersimpan: 68 bagian, 5.277 vertex, 9.388 segitiga, 37 material; satu referensi dipaketkan. Blender 5.2.3 LTS berhasil membuka ulang file. Semua file bundle diverifikasi ukuran dan SHA-256 terhadap manifest. Tiga render aktual tersedia: perspektif, depan, kanan. SQLite integrity_check=ok dan foreign_key_check kosong.

Salinan hasil: `/Users/ariardianto/Documents/ChatGPT/ForgeKit/outputs/hiu-2026-11-01/`. Artefak asli aplikasi tetap berada di workspace aplikasi. Tidak ada penyisipan ke Roblox Studio.

Validasi akhir: **152 tes backend lolos**, 6 tes opt-in diabaikan; satu tes Blender nyata dipanggil secara eksplisit dan lolos (build, render, revisi, pemulihan checkpoint; 41,94 detik). Bukti ada pada `docs/test-evidence/2026-11-01/live-model-0134/`.

## Batas hasil

Selesainya proses tidak berarti kesamaan visual tersertifikasi. Pemeriksaan dibatasi dua evaluasi dan satu revisi yang diterapkan; evaluasi terakhir masih berkeputusan revise. Usulan tambahan pada evaluasi terakhir tidak diterapkan setelah batas revisi. Model final tetap kandidat revisi yang sudah dibangun dan dirender. Detail serta aksen merah belum setara gambar referensi; UV, texture maps, dan microtexture tidak dihasilkan oleh kontrak recipe saat ini. Tidak ada klaim manifold atau bebas seluruh self-intersection. Gangguan jaringan atau kuota provider tetap merupakan kondisi eksternal yang dapat menyebabkan kegagalan baru.
