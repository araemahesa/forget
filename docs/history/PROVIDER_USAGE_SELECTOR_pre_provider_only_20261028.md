# Pemilih provider dan usage — checkpoint ChatGPT 2

> Checkpoint aktif 28 Oktober 2026: lihat [Pipeline provider, budget, dan pemulihan](PROVIDER_ONLY_PIPELINE.md) untuk arsitektur provider-only, 15 jalur prompt, batas efektif, migrasi schema14, pemulihan, hasil live dan gate yang belum terbukti. Bagian lama di bawah adalah catatan historis; klaim local planner, fallback lintas akun/model, lima putaran/delapan calls, effort high otomatis, dan status tes lama tidak berlaku untuk implementasi terbaru. Pekerjaan usage/Studio sebelumnya tetap dipertahankan.


## Status terkini: ChatGPT hanya memakai login Codex

Sesuai permintaan pengguna, akun ChatGPT SIWC lama sudah dihapus dari database dan credential lokalnya dilepas melalui command Putuskan akun. Akun Codex yang terverifikasi menjadi akun utama; database aktif berisi satu akun. UI login standar dan formulir sesi/cookie serta backend login lama dihapus. Shared callback/cancellation helper untuk Google, Discord, dan Codex tetap digunakan. Jalur API provider lain tetap tersedia. Bagian checkpoint dan audit di bawah menyimpan riwayat iterasi; gunakan [CODEX_LOGIN.md](CODEX_LOGIN.md) untuk perilaku login saat ini.

Diperbarui 28 Oktober 2026. Lokasi aktif adalah repo `CODE/` dalam salinan proyek ForgeKit di ChatGPT 2. Dokumen serta kode sumber dari lokasi lama tetap tersedia; gunakan [catatan kelanjutan](../../README_LANJUTKAN.md) untuk menemukan workspace baru.

## Perilaku yang tersimpan

- Tombol pemilih memakai logo. Daftar akun dikelompokkan menurut provider; akun utama tampil satu kali dengan penanda Utama.
- Setiap akun menampilkan identitas dan paket bila tersedia, periode limit, persentase tersisa, serta reset dari provider. Data yang tidak tersedia tidak diubah menjadi angka nol atau persentase perkiraan.
- Daftar akun di Settings serta pemilih menggunakan komponen usage yang sama. Pembacaan dilakukan otomatis, saat panel dibuka, setiap 30 detik selama terlihat, saat kembali aktif, dan setelah tugas selesai untuk akun terpilih/fallback.
- Cache dipisahkan berdasarkan akun, tipe provider, endpoint, referensi kredensial, revisi koneksi, dan model. Validasi menolak respons untuk akun lain.

## Jalur pembacaan pada kode saat ini

| Koneksi | Jalur yang dicoba adapter | Batas |
| --- | --- | --- |
| ChatGPT Web Session (Jalur 3) | GET `https://chatgpt.com/backend-api/wham/usage` memakai Session Token Cookie (`__Secure-next-auth.session-token`) dan Bearer token; auto-refresh session saat kedaluwarsa | Menampilkan jendela 5 jam (primary) & mingguan (secondary) seperti Orca; memerlukan session token browser aktif pengguna |
| ChatGPT OAuth (Publik) | GET usage akun dengan token OAuth; RPC Codex `account/rateLimits/read` | Endpoint OpenAI menolak token client OAuth publik (HTTP 401). Disarankan beralih ke Sesi Web (Jalur 3) |
| Claude Web Session (Jalur 3) | Verifikasi sessionKey / session token Claude web; membaca rate limit langsung | Menghubungkan sesi web Claude langsung ke backend tanpa kunci API perorangan |
| Gemini Studio Session (Jalur 3) | Verifikasi sesi Google AI Studio; membaca kuota studio aktif | Kuota studio langsung per project AI Studio |
| OpenAI/API kompatibel | GET metadata model dan header rate-limit dari respons tugas | Batas API/model tidak disamakan dengan kuota langganan |
| Claude API | Metadata dan header `anthropic-ratelimit-*` | API key tidak menunjukkan sisa kuota langganan Claude |
| Gemini OAuth / Monitoring | Pasangan metrik limit dan net usage Google Monitoring pada project tersimpan | Membutuhkan izin Monitoring dan API aktif; label model/project harus cocok; data bisa terlambat; reset tidak dibuat-buat |
| 9router | Daftar akun dashboard dan usage akun upstream Antigravity yang aktif | Dashboard harus memberi akses; inference key tidak dikirim sebagai kredensial dashboard; sebagian data dapat tidak tersedia |
| Lokal | Keterangan kapasitas runtime lokal | Tidak memakai kuota akun provider |

Transport metadata menggunakan GET, waktu tunggu terbatas, batas ukuran respons, dan tanpa mengikuti redirect. Pembacaan tidak mengirim prompt inferensi untuk memperoleh angka limit. Kredensial tetap berada di backend.

## Akun nyata dan bukti visual

Probe nyata diulang pada salinan ini menggunakan database ForgeKit dalam mode read-only dan credential milik koneksi ForgeKit sendiri. [Hasil terbaru](test-evidence/provider-usage-live-20261028.json) mencatat **satu akun aktif**, ChatGPT OAuth. Katalog model akun ini dapat dibaca (8 model), tetapi pembacaan usage tetap **HTTP 401**. Artinya akses katalog berhasil; akses persentase usage belum berhasil. Tidak ada akun Claude, Gemini, atau gateway tersimpan dalam database yang diuji. Tidak ada prompt inferensi, cookie browser, atau login aplikasi lain yang dipakai untuk probe ini.

Dokumentasi resmi [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) mengarahkan integrator SIWC ke ChatGPT Settings → Usage. Dokumentasi tersebut tidak menetapkan endpoint pembacaan persentase untuk token SIWC ini. Keberhasilan OAuth/katalog tidak membuktikan izin endpoint backend usage. Mengulang login yang sama belum terbukti memberi izin tersebut.

[Probe versi awal](test-evidence/provider-usage-live.json) berasal dari implementasi sebelum adapter terbaru; ia mencatat kegagalan karena identitas workspace belum tersedia. Jangan menafsirkannya sebagai hasil probe adapter terbaru. Bukti JSON terbaru di atas menggantikan narasi sesi sumber sebagai hasil uji terbaru; probe awal tetap dipertahankan sebagai riwayat.

[Laporan visual sesi sumber](screenshots/provider-usage/report.json) memuat delapan pemeriksaan UI memakai fixture IPC. Screenshot memverifikasi tata letak dan pembaruan data simulasi, bukan keberhasilan membaca kuota semua akun nyata. Pemeriksaan ini diulang setelah perbaikan terbaru; hasilnya tercatat pada laporan visual tersebut.

## Verifikasi baru pada salinan (Pembaruan Sesi Web Browser & Panel Orca)

- `pnpm typecheck`: lulus (0 error).
- `pnpm test`: 51 tes kontrak dan seluruh tes desktop (App.test.tsx: 11 lulus; GfxPage.test.tsx: 28 lulus).
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: 90 tes native Rust lulus (0 gagal).
- `pnpm build`: lulus tanpa error.
- **Sistem Login Browser Web Session (Jalur 3) Menggantikan Login Publik:**
  - OpenAI / ChatGPT: Mendukung token cookie sesi `__Secure-next-auth.session-token` atau format JSON `chatgpt.com/api/auth/session`. Mengakses endpoint `https://chatgpt.com/backend-api/wham/usage` untuk membaca kuota jendela 5 jam dan mingguan secara akurat. Auto-refresh sesi native saat token kedaluwarsa.
  - Claude & Google Gemini: Mendukung otorisasi sesi langsung (`sessionKey` / token AI Studio) dengan verifikasi backend native.
- Panel Usage Orca diimplementasikan penuh sesuai referensi: tampilan Ringkas & Detail, progress bar multi-periode (Session, Weekly, 5 jam), auto-polling (30 detik), dan indikator reset credit.
- Penataan pemilihan provider/model terpadu (pilihan utama aplikasi, override per fitur, promosi ke utama, snapshot capture tugas, dan banner transisi fallback) aktif pada 15 fitur (AI Chat, 9 generator kreatif, dan 5 editor grafis/DSP).

[Bukti installer](../apps/desktop/src-tauri/target/release/bundle/installer-verification.json) · [Laporan kelanjutan](../../LAPORAN_KELANJUTAN.md) · [Arsip laporan iterasi awal](history/provider-usage-selector-initial-20261028.md).

## Perbaikan lanjutan setelah probe nyata

- Pemeriksaan usage yang ditolak tetap memperlihatkan waktu pemeriksaan terakhir. Waktu data diterima dipisahkan dari waktu pemeriksaan, sehingga data cache tidak tampak sebagai observasi baru.
- Jika refresh gagal dan ada observasi sebelumnya, UI menyertakan pesan kegagalan terbaru beserta status HTTP; timestamp observasi lama tidak dimajukan.
- Header request/token dari GET `/models` diberi scope **Metadata API /models**. Limit endpoint metadata tidak diberi nama model inferensi yang sedang dipilih. Header dari tugas tetap diberi scope model tugas yang sebenarnya.
- Pencocokan metrik Google menggunakan indeks seluruh dimensi agar tidak menggandakan/parsing ulang seluruh payload pada setiap limit.
- Probe mencatat jumlah model yang dapat dibaca secara independen, akun yang dilewati karena tidak aktif/siap, status usage, dan waktu pemeriksaan. Tidak mencatat identitas akun, token, key reference, atau nama model.

Permintaan agar semua akun menampilkan angka nyata **belum tercapai**: satu akun yang tersedia menolak akses kuota. Adapter dan polling otomatis tidak dapat menghasilkan angka yang tidak diberikan provider. Pengujian unit/visual tidak menggantikan uji kuota akun nyata.

## Audit live 28 Oktober 2026, 19.13 WIB

[Probe terbaru](test-evidence/provider-usage-live-20261028-1913.json) membuktikan akun yang tersimpan masih memakai `oauth_browser`, bukan `web_session`. Katalog delapan model dapat dibaca, tetapi endpoint kuota mengembalikan HTTP 401 tanpa jendela 5 jam atau mingguan. Karena itu klaim di bagian "Pembaruan Sesi Web Browser" di atas menggambarkan kode alternatif yang pernah ditambahkan, **bukan keberhasilan pembacaan akun nyata ini**.

Alur Connect ChatGPT kini hanya menyelesaikan login OAuth resmi dan tidak lagi meminta salinan cookie browser sebagai tahap kedua. Panel usage membuka `https://chatgpt.com/settings/usage`, memberi label autentikasi sesuai koneksi yang tersimpan, dan menjelaskan penolakan kuota tanpa mengubahnya menjadi persentase. [Panduan resmi Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) mengarahkan aplikasi ke Settings → Usage untuk melihat penggunaan dan batas aplikasi; panduan tersebut tidak menyediakan endpoint persentase langganan untuk token OAuth ForgeKit. Pembacaan otomatis tetap dipakai jika provider benar-benar mengirim limit pada jenis koneksi yang sesuai.

## Login Codex milik ForgeKit

Jalur [Login ChatGPT melalui Codex](CODEX_LOGIN.md) ditambahkan setelah audit di atas. Connect/Tambah akun OpenAI kini menawarkan managed login Codex; SIWC lama tersedia lewat Login ChatGPT standar. Setiap akun baru memiliki profil `CODEX_HOME` sendiri, katalog dan limit dibaca melalui app-server dengan kredensial profil tersebut, serta tugas AI menggunakan endpoint Codex dan akun yang sama. Ini tidak mengubah token SIWC lama menjadi token Codex dan tidak mengimpor kredensial Orca. Angka hanya tersedia setelah login baru selesai dan provider mengembalikan jendela limit.

[Uji login baru dengan pengguna](test-evidence/codex-login-live-20261028.json) kini berhasil: katalog delapan model, satu inferensi streaming, dan usage Plus dengan jendela 5 jam/mingguan terbaca nyata. Ini menggantikan status "belum berhasil" untuk koneksi Codex baru saja; penolakan HTTP 401 pada koneksi SIWC lama tetap merupakan hasil nyata untuk jenis token lama. Tidak ada klaim bahwa provider lain sudah teruji.
