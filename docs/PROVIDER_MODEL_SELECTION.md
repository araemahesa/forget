# Provider, model, dan tingkat penalaran

> Checkpoint aktif 28 Oktober 2026: lihat [Pipeline provider, budget, dan pemulihan](PROVIDER_ONLY_PIPELINE.md) untuk arsitektur provider-only, 15 jalur prompt, batas efektif, migrasi schema14, pemulihan, hasil live dan gate yang belum terbukti. Bagian lama di bawah adalah catatan historis; klaim local planner, fallback lintas akun/model, lima putaran/delapan calls, effort high otomatis, dan status tes lama tidak berlaku untuk implementasi terbaru. Pekerjaan usage/Studio sebelumnya tetap dipertahankan.


Pembaruan pemilih logo, pengelompokan akun, dan usage 28 Oktober 2026: [PROVIDER_USAGE_SELECTOR.md](PROVIDER_USAGE_SELECTOR.md).

Perubahan 27 Oktober 2026:

- Chat dan semua generator yang memakai `useCreativeTask` menyediakan pilihan akun/provider, model, dan penalaran. Mengganti akun memuat katalog akun tersebut, bukan daftar global gabungan. Preferensi model dan penalaran disimpan per akun di perangkat.
- Setelah daftar koneksi dibaca atau akun baru ditautkan, aplikasi mengambil katalog `/models` melalui backend native. Kredensial tetap di Keychain; webview hanya menerima ID model, nama, dan kemampuan penalaran. Katalog dicache selama lima menit dan dapat dimuat ulang lewat tombol di samping pilihan model.
- Tingkat penalaran mengikuti metadata provider. Bila API tidak menyediakan kemampuan, hanya beberapa keluarga model yang sudah terdokumentasi memakai kompatibilitas terbatas; model lain memakai Otomatis. Otomatis tidak mengirim parameter penalaran.
- Backend memuat kredensial dan endpoint dari akun tersimpan, memeriksa model/penalaran terhadap katalog akun, kemudian meneruskan pilihan ke transport. OpenAI Responses menerima `reasoning.effort`; Claude menerima `output_config.effort`; Gemini/OpenAI-compatible menerima `reasoning_effort`.
- Penalaran berbeda dari pengaturan kualitas generator. Kualitas menentukan anggaran artefak; penalaran mengatur model AI yang menyusun hasil.
- Akun utama tetap ditandai di header. Pilihan akun pada chat/generator menentukan koneksi tugas tersebut; akun cadangan mengikuti kebijakan fallback yang sudah dikonfigurasi dan memakai modelnya sendiri.
- Saat katalog tidak dapat dimuat, model bawaan akun tetap tersedia. Aplikasi menampilkan opsi memuat ulang, tanpa membuat daftar model atau tingkat penalaran palsu.
- Fokus pada input teks/textarea tidak lagi menambah stroke/outline berwarna. Navigasi keyboard pada tombol dan pilihan tetap memiliki indikator fokus.

## Verifikasi

- 209 tes frontend dan 71 tes native lulus, termasuk pergantian akun, respons katalog yang datang terlambat, pilihan model/penalaran ke backend, dan bentuk parameter tiap protokol.
- Pemeriksaan baca katalog pada akun OpenAI yang memang tersambung mengembalikan 8 model beserta tingkat penalarannya. Bukti tanpa kredensial: `test-evidence/provider-model-catalog-live.json`. Pemeriksaan ini tidak mengirim prompt inferensi.
- Claude dan Gemini diverifikasi lewat fixture dan pengujian protokol; akun nyata kedua provider tersebut belum tersambung untuk uji langsung.
- Pemeriksaan visual lulus 13 pemeriksaan dengan 104 tangkapan layar pada beberapa ukuran jendela: `screenshots/chat-refactor/visual-report.json`.
- Build macOS terbaru berhasil dibuka pada 28 Oktober 2026. Dropdown native menampilkan kedelapan model; pergantian ke GPT-6.1-Sol dan penalaran High berhasil dibaca kembali. Setelah pemeriksaan, pilihan dikembalikan ke GPT-6.1 Terra dan Otomatis. Bukti: `test-evidence/provider-model-native-ui.json`. Area ketik diperiksa dalam keadaan fokus tanpa stroke berwarna.

## Rujukan protokol

- OpenAI reasoning: https://developers.openai.com/api/docs/guides/reasoning
- Model metadata Codex: https://learn.chatgpt.com/docs/app-server
- Claude Models API: https://platform.claude.com/docs/en/api/models
- Gemini OpenAI compatibility: https://ai.google.dev/gemini-api/docs/openai
