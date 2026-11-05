> Aktif 29 Oktober 2026: aplikasi 0.1.4 terpasang. Enam Apply memakai executor bersama; progres/final stream, pemulihan write, pemeriksaan Luau dan error boundary diperbaiki. 438 tes lulus. Provider/model, kuota resmi, Explorer, enam root artefak serta runtime GUI/NPC/animasi/cutscene diverifikasi pada cakupan yang tercatat. Akun, chat, karya dan perubahan Git dipertahankan. Batas penerimaan lengkap tercatat dalam laporan terbaru; bagian berikut adalah riwayat.

[Laporan dan bukti terbaru](PROMPT_QUALITY_2026_10_29.md).

> Update 29 October 2026: release 0.1.3 installed; all 14 native generator/editor provider executions passed in isolated data, plus live Chat gate/wind and large/deep Explorer acceptance. See [current quality report](PROMPT_QUALITY_2026_10_29.md) for tests, evidence and remaining limits. Earlier status below is historical.

# Pipeline provider, budget, dan pemulihan — 28 Oktober 2026

Dokumen ini adalah checkpoint aktif untuk perubahan provider-only. Dokumen bertanggal lebih awal dan screenshot fixture adalah riwayat, bukan bukti implementasi atau inference terbaru. Repo aktif adalah `CODE/` pada workspace salinan; perubahan lama dan kedua repo asli dipertahankan. Tidak dibuat commit/publish atau perubahan map produksi.

## Hasil dan batas implementasi

Chat, sembilan generator bersama, serta lima editor prompt memakai akun/model provider melalui executor native yang sama. Planner berbasis keyword hanya tersisa sebagai fixture `#[cfg(test)]`; tidak dikompilasi ke jalur produksi. Koneksi `local-llm`, auth runtime lokal, Ollama yang dikenali dan mode AI tanpa provider ditolak. Migrasi menonaktifkan koneksi lokal lama, tanpa menghapus chat/artefak. Renderer, DSP, preview, impor/ekspor dan edit manual tetap berfungsi.

Provider menghasilkan recipe terstruktur untuk engine ForgeKit. Ini bukan adapter mesh neural, image diffusion, suara vokal, atau video cloud. Batas primitive/rig, timeline, warna, referensi dan ukuran tetap diperiksa. Validator membuktikan struktur dan invariant domain yang tersedia; ia belum membuktikan setiap makna bahasa alami atau kualitas estetika. Permintaan di luar format tidak boleh dilabeli kemampuan media yang belum ada. Refusal/non-JSON/JSON terpotong tidak disimpan sebagai karya sukses.

Pemilihan UI yang sah dibekukan per tugas: ID koneksi berbeda dari adapter dan model. Override yang hilang, katalog yang tidak lagi memuat model pilihan, atau effort eksplisit yang tidak didukung memblokir tugas sampai pengguna memilih kembali. Tidak memilih akun/model pertama. Auto effort tidak diam-diam diganti high. Native mengambil credential reference tersimpan, memeriksa akun enabled/ready dan fingerprint identitas/revisi sebelum checkpoint/request/operasi. Uji akses eksplisit terhadap koneksi pending merupakan probe terpisah; hanya hasil inference probe yang dapat menjadikannya ready.

Fallback ForgeKit lintas akun/provider/model ditolak pada penyimpanan policy dan dipadamkan pada executor, termasuk policy lama. HTTP429 pada akun A tidak mengirim permintaan ke akun B. Router tetap satu koneksi: upstream yang tidak dilaporkan router adalah unknown. Endpoint loopback transport/gateway sah tetap diizinkan; ini tidak membuktikan cloud inference custom. Capability tools supported/unsupported/unknown berasal dari katalog bila tersedia; unsupported diblokir, unknown dicoba melalui adapter tanpa klaim dukungan yang pasti. Tidak menambahkan reasoning effort palsu.

## Akar kegagalan lima putaran

Loop lama menjalankan request, menjalankan tools dari respons, menambahkan tool outputs, lalu mengulang dalam batas lima putaran dan delapan calls. Bila putaran kelima berisi tool, seluruh pekerjaan tool dapat sudah dijalankan sebelum loop berakhir tanpa request keenam untuk jawaban akhir. Timeout transport dan clamp routing dapat memperpendek pekerjaan lebih jauh. Journal lalu menolak replay write pada request ID yang sama, sementara mengirim prompt dengan ID baru dapat mengulang perubahan. Ini adalah batas internal ForgeKit, bukan bukti kuota provider habis.

Sekarang `supervisor.rs` memiliki budget dan checkpoint bersama. `ai.rs` menerjemahkan protokol provider; `commands.rs` mengikat resolver, target, journal, cancellation dan commit. Respons final terpisah dari delta/progress; JSON final tidak dirakit dari log tools.

## Budget yang efektif

| Kelas | Pemakaian | Total provider turns | Tool calls baru | Deadline segmen awal | Reserve turns |
|---|---|---:|---:|---:|---:|
| light | Chat/editor/recipe tanpa tools | 8 | 24 (tidak diekspos bila tanpa tools) | 180 s | 2 |
| standard | tugas dengan tools | 16 | 24 | 300 s | 2 |
| complex | generator kualitas high | 24 | 40 | 600 s | 2 |

Timeout request maksimum 120 s dan dipotong oleh sisa deadline. Konteks maksimum 256 KiB; output per request maksimum 8192 token atau cap domain yang lebih kecil; estimasi output kumulatif maksimum 131072 token. Estimasi panjang bukan tagihan atau hard spending cap. Angka provider turns, calls baru, repairs dan segmen disimpan terpisah. Kualitas tetap membatasi kompleksitas recipe; tidak mengubah model/effort pengguna.

Admission batch dilakukan sebelum efek; batch yang melebihi kapasitas ditolak seluruhnya dan setiap call mendapat output protokol. Menjelang reserve, eksplorasi dihentikan, tools write ditutup, read-back terbatas diberi ruang bila diperlukan, lalu finalisasi tanpa tools. Tidak memulai request setelah deadline. Dua siklus tanpa informasi/progress baru mengarahkan finalisasi. Hasil satu-call yang valid langsung selesai tanpa loop buatan.

Semantic repair maksimal dua, terhadap kandidat dan diagnostic yang sama, menggunakan akun/model serta counter yang sama. Kandidat invalid setelah itu tetap gagal dan hasil lama dipertahankan.

Continuation membutuhkan tindakan pengguna: maksimal tiga segmen tambahan, masing-masing 120 s. Counter turn/call/output/repair tidak direset. Maksimum wall-clock alokasi adalah deadline awal ditambah paling banyak 360 s; tidak ada auto-resume tanpa batas. Tindakan ini dapat memakai kuota tambahan pada akun yang sama. Deadline segmen yang sudah habis dapat dilanjutkan hanya melalui operasi continuation resmi.

## Checkpoint dan keselamatan efek

Migrasi `0015_provider_only_tasks.sql` menaikkan `user_version` ke 14, membuat checkpoint yang terikat task, serta menonaktifkan lokal/policy fallback. Storage membuat backup sebelum migrasi; database produksi tidak dimigrasikan oleh test harness. Tugas lama tanpa checkpoint tidak diberi transcript atau receipt fiktif.

Checkpoint mencatat input/parent/context dari journal, fingerprint akun/model/effort/endpoint/revisi credential reference, snapshot skills, transcript/protocol items, turn/call budget, deadline, phase, kandidat/hash/validation, repairs dan operations. Secret tidak diekspor. Protocol items opaque dipertahankan untuk adapter, bukan ditampilkan sebagai penalaran privat.

Checkpoint tersimpan sebelum request, sebelum dispatch tool, sesudah receipt, serta sebelum commit. Crash sesudah dispatch namun sebelum receipt menghasilkan outcome unknown. Resume membangun kembali tool outputs yang diperlukan protokol dan tidak mengulang dispatch. Call ID dengan input berubah ditolak; write intent yang sudah dikirim dengan ID baru juga ditolak, termasuk variasi spasi/urutan properti JSON. Kegagalan yang terbukti terjadi sebelum dispatch ditandai not_executed, tidak diklaim sebagai efek, dan dapat dicoba lagi dalam budget yang sama. Ini deduplikasi konservatif per tugas, bukan pembuktian semantik kesetaraan dua script berbeda. Pengulangan write sengaja dengan argumen identik harus menjadi tugas/intent baru yang ditinjau; finalization tidak membuka write lagi.

Lease file OS per task dan ownership dalam proses menahan dua klik/window/proses bersamaan; file lock dilepas OS saat proses mati. Cancellation dan parent/current task diperiksa lagi sebelum UI menerapkan kandidat. Parent editor yang berubah tidak ditimpa oleh respons terlambat. Commit AI native mensyaratkan checkpoint final, hash kandidat dan validasi lulus. Chat completion mensyaratkan konten yang sama dengan final provider dan user turn terkini. Penyimpanan manual mempunyai origin manual dan tidak meniru provenance AI.

Panggilan tugas Studio mengantre paling lama 10 detik terhadap sesi foreground; discovery UI ditunda selama tugas menunggu/berjalan. Kegagalan sebelum pengiriman dibedakan dari runtime/transport sesudah dispatch yang tetap outcome unknown.

Panduan scene-editing v1.0.1 memeriksa recording undo aktif dalam tool Assistant. Recording nested tidak dimulai dan recording milik tool tidak ditutup. Jika belum ada recording, operasi harus membuat dan menyelesaikan recording sendiri. Batas satu recording aktif per plugin sesuai [API ChangeHistoryService Roblox](https://create.roblox.com/docs/reference/engine/classes/ChangeHistoryService). Uji live awal menemukan recording Assistant sudah aktif dan penulisan dihentikan secara aman.

Untuk Studio, guard yang ada memeriksa katalog/schema, `studio_id`, target dan freshness sebelum operasi. Write yang hasilnya belum pasti menahan write berikutnya. `execute_luau` tetap dalam datamodel Edit. Tidak ditambahkan write generator, shell, publish atau upload otomatis. Receipt completed tidak cukup untuk membuktikan Luau memenuhi tujuan pengguna; read-back generic belum mempunyai verifikasi semantik otomatis yang dapat mengubah semua efek menjadi passed. Ini tetap dinyatakan belum diperiksa/partial pada UI.

## Status dan pemulihan

Tiga dimensi dikirim backend: execution (`not_completed/completed/partial/unknown`), verification (`not_checked/passed/failed`), response (`interrupted/completed`). Daftar receipt dan kandidat tersedia pada rincian. Task journal tetap memiliki terminal state yang dapat ditransisikan secara resmi untuk continuation; tidak menghapus perlindungan replay lama.

- **Selesaikan jawaban** melanjutkan checkpoint dengan provider yang sama tanpa tools/write.
- **Periksa hasil tanpa mengulang write** tersedia hanya bagi tugas Chat dengan target Studio tersimpan dan ruang budget. Katalog hanya baca, lalu finalisasi. Pemeriksaan juga tersedia setelah jawaban parsial selesai; respons read-back ditambahkan pada riwayat yang sama tanpa menghapus jawaban sebelumnya. User turn baru memblokir continuation terhadap percakapan lama. Ketidakcocokan/ketidakpastian tetap ditampilkan; tidak otomatis membolehkan write.
- **Batalkan finalisasi** membatalkan stream continuation yang sedang aktif.
- Rincian menampilkan kandidat, efek/unknown, counter, alasan berhenti dan identitas akun/model. Kandidat editor yang sudah valid tetap dapat ditinjau jika parent berubah atau editor dibuka ulang. Tombol hanya muncul bila backend menghitung kapabilitasnya.

Kelanjutan pekerjaan write baru tidak diekspos (`canResume=false`). Finalization/read-back tidak disamarkan sebagai kemampuan melanjutkan seluruh rencana. Task yang budget totalnya habis perlu tugas baru yang ditinjau, bukan replay dari awal. Draft dan ID recovery disimpan sehingga pindah halaman/restart tidak menghilangkan pemulihan. Semua generator/editor memakai komponen `TaskRecovery` yang sama.

Taxonomy membedakan task deadline, turn/call/context/output limit, no progress, rate/quota/auth/billing/refusal, response incomplete, request timeout, unknown result, target conflict, validation, storage dan error provider/protocol. Status sistem diberi label sebagai status sistem, bukan jawaban AI lokal.

## Matriks 15 jalur prompt

Semua baris memakai pilihan `ProviderPicker`/`ModelControls` → resolver native tersimpan → `run_connected` satu akun → `ai::execute_*_checkpoint` → `supervisor::run`. Skills resolver `agent.rs` merekam ID, versi frontmatter, SHA256 dan alasan. `result-verification` ditambahkan sesuai jalur; skill map hanya bila ada konteks. Allowed tools adalah katalog executable aktual, bukan semua nama frontmatter.

| Jalur / entry UI | IPC / planner | Skill domain | Tools | Validator / commit | Bukti |
|---|---|---|---|---|---|
| Chat / ChatPage | send_chat_message, resume_ai_task | inti/verifikasi; luau-gameplay, scene-editing, map-understanding bila relevan | snapshot read atau Studio yang tersedia, write hanya intent sah | protocol + journal/latest user/final equality | supervisor, journal, UI, native IPC live |
| model3d / Model3dPage, CreativeControls | generate_creative / creative.rs | model-3d | snapshot/Studio read saja | primitive, parts, bounds / versi+hash | HTTP parameterisasi + UI native live generate/refine |
| animation / AnimationPage | generate_creative | animation-motion | read saja | R6/R15, joints, times, quaternions / versi | HTTP parameterisasi |
| material / Texture3dPage, MaterialWorkspace | generate_creative | material-texture | read saja | PBR/layers/ranges / versi | HTTP parameterisasi |
| vfx / VfxPage | generate_creative | visual-effects | read saja | emitter/sequence/bounds / versi | HTTP parameterisasi |
| interface / GuiPage | generate_creative | roblox-interface | read saja | tree/refs/layout/style / versi | HTTP parameterisasi |
| npc / NpcDialoguePage | generate_creative | npc-dialogue | read saja | graph IDs/links/limits / versi | HTTP parameterisasi |
| cutscene / CutscenePage | generate_creative | cutscene-direction | read saja | camera/keyframes/times / versi | HTTP parameterisasi |
| music / MusicPage, AudioWorkspace | generate_creative | audio-generation | read saja | tracks/pitches/durations / versi | HTTP parameterisasi |
| sky / SkyboxPage | generate_creative | sky-atmosphere | read saja | six colors/lighting ranges / versi | HTTP parameterisasi |
| gfx / GfxPage, VisualWorkspace (thumbnail mode termasuk GFX) | generate_editor_recipe / editor_ai.rs | visual-design | tanpa tools | strict GFX schema + candidate checkpoint / UI preview | HTTP parameterisasi + UI native live |
| icon / IconsPage | generate_editor_recipe | visual-design | tanpa tools | strict icon / candidate checkpoint | HTTP parameterisasi |
| clothing / ClothingPage | generate_editor_recipe | visual-design | tanpa tools | strict clothing / candidate checkpoint | HTTP parameterisasi |
| texture / TexturesPage | generate_editor_recipe | material-texture | tanpa tools | strict texture / candidate checkpoint | HTTP parameterisasi |
| sfx / SfxPage, AudioWorkspace | generate_editor_recipe | audio-generation | tanpa tools | strict SFX / candidate checkpoint | HTTP parameterisasi |

Sembilan generate/variation/refine memakai hook dan IPC yang sama; parent recipe masuk sebagai input provider, bukan parser keyword lokal. Lima prompt editor menyertakan current spec. Manual slider, preset langsung, timeline, save/open/export tidak menjadi panggilan AI. Audit rute/palette mengarah ke halaman yang sama; tidak ditemukan executor prompt enhancer/smart action lain yang berjalan sebagai AI lokal. Halaman utilitas manual tidak diberi klaim AI.

HTTP fixture seluruh domain memberi dua output provider yang berbeda dan memeriksa perubahan output/hash, bukan hanya jumlah panggilan. Fixture invalid menguji repair bounded; missing provider ditolak. Native fixture A429/B200 membuktikan satu attempt terpilih, no synthetic assistant, dan riwayat tetap ada setelah disconnect. Fixture adalah data buatan yang diberi identitas, bukan bukti kualitas provider live seluruh domain.

## Usage akun yang tetap dipertahankan

Selector logo dan pengelompokan per provider, tanpa akun utama ganda bernama Default, tetap dipakai. Usage diperbarui saat dropdown dibuka, secara berkala selama terlihat, dan sesudah tugas/recovery. Kuota berasal dari akun yang sama. ChatGPT menggunakan limit resmi 5h/weekly bila respons tersedia; API rate limit/project balance dan subscription quota dibedakan. Provider yang tidak memberi kuota menampilkan keterbatasan, bukan persentase tebakan. Jendela pendek (termasuk 5h) tetap menampilkan jam reset walau melewati tengah malam; tanggal lengkap tersedia pada tooltip, sementara mingguan memakai tanggal. Detail endpoint/status ada pada `PROVIDER_USAGE_SELECTOR.md`.

## Bukti dan cara verifikasi

Direktori bukti: `docs/test-evidence/2026-10-28/provider-only/`.

- `native-provider-live.json`: akun utama ForgeKit sendiri, OpenAI/ChatGPT OAuth, model gpt-6.1-sol. Chat native IPC, model3d UI/WebGL, refine hanya warna dengan parent/struktur identik, GFX UI dengan judul/ukuran yang diminta. Tidak mengimpor login aplikasi lain; credential tidak disalin ke evidence. Database/artifact acceptance terisolasi.
- `native-fixture.json`: HTTP fixture lokal melalui native WKWebView/IPC/curl, tanpa provider upstream.
- TypeScript lulus; 51 kontrak + 241 desktop + 107 Rust = **399 tes lulus**. Build frontend dan release native lulus. Hasil rinci pada `verification.json` dan log tes; integritas DMG pada `bundle-verification.json`. Tanda tangan ad-hoc, belum notarized atau diuji instalasi mesin bersih. Warning chunk geometri >500 kB tetap ada. Screenshot diberi identitas native review, bukan rekaman saat setiap request berlangsung.

Perintah: `pnpm typecheck`, `pnpm test --run`, `pnpm build`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`. Native harness memerlukan build opt-in `pnpm tauri build --debug --features runtime-acceptance,custom-protocol --no-bundle`. Siapkan DB terpisah memakai example `provider_only_prepare` (source dibuka readonly; destination wajib berbeda), lalu jalankan binary dengan `FORGEKIT_ACCEPTANCE_PHASE=provider-only-live`. Ini memanggil akun nyata dan dapat memakai kuotanya. Routing fixture: `python3 apps/desktop/src-tauri/tests/verify_connections_runtime.py`.

Harness `creative-acceptance.js` lama menggunakan fixture planner lokal dan merupakan bukti historis sebelum provider-only; jangan menjalankannya sebagai acceptance implementasi ini. Harness acceptance tidak disertakan pada build release biasa. Paket release diperiksa codesign ad-hoc, CRC DMG, executable mounted identik dan marker harness absen; bukan notarization atau uji instalasi mesin bersih.

## Hasil Studio live dan batas yang tersisa

`native-studio-live.json` merekam provider yang sama membuat satu LocalScript `StarterPlayer.StarterPlayerScripts.ForgeKitWindAcceptance` pada map Baseplate baru **Place1, PlaceId 0**. Task `c88ff41a-b0c8-43c6-8a6b-6ae466cad304` selesai pada turn 5, kemudian pemeriksaan read-only dari checkpoint mencapai turn kumulatif 12/16, segment 1. Jumlah receipt berpotensi write tetap 2 sebelum/sesudah continuation (satu inspeksi melalui execute_luau secara konservatif masuk kategori ini); tidak ada dispatch write baru.

Pemeriksaan task sebelumnya yang gagal recording juga dilanjutkan secara read-only: ditemukan mismatch nyata, folder StarterPlayerScripts masih kosong. Provider menyatakan pemasangan belum berhasil. Receipt write tidak diulang. Satu percobaan read-back sempat timeout pada RPC Codex; checkpoint tetap tersimpan. Kategori timeout RPC sekarang ditandai request_timeout, teruji tanpa mengubah batas waktu.

Pembacaan independen MCP pada Edit mengonfirmasi **tepat satu LocalScript** dan source yang sama. Play Client mengonfirmasi satu folder runtime, **20 garis** tipis, anchored/noncolliding, TickCount meningkat, serta posisi relatif kamera berubah. Console kosong dalam pengamatan. Dua screenshot Studio menunjukkan garis di dekat kamera/player. Play dihentikan; folder runtime hilang, script Edit tetap satu. Bukti: `studio-source-readback.json`, `studio-runtime-verification.json`, `studio-wind-play-{1,2}.png`. Ini map uji baru, bukan map produksi; tidak dipublish atau diupload.

Sampel runtime 1,14 detik mengamati sekitar 14 tick/detik pada sesi ini. Gerak berjalan dengan deltaTime, tetapi hasil ini **belum membuktikan kehalusan konsisten/60fps**. Undo/redo belum terbukti melalui pemeriksaan independen. Model3d/GFX live tidak membuktikan kualitas seluruh domain, subscription provider lain, atau neural media. Generic Luau belum mempunyai verifier semantik umum; status produk tetap partial/not_checked walau read-back provider sesuai, dan resume tidak membuka write baru ketika hasil belum pasti. Kelanjutan pekerjaan write baru tidak diekspos. Belum ada uji Windows, notarization, atau instalasi mesin bersih.

Review native dilakukan melalui bundle debug opt-in dan DB terpisah. Jendela acceptance sempat memerlukan zoom/resize untuk first paint; ini dicatat sebagai batas harness, bukan dianggap bukti tampilan produksi normal. Screenshot picker awal menunjukkan usage unavailable karena command usage belum terdaftar pada harness; handler tersebut telah diperbaiki. Review ulang build debug9 melalui UI native berhasil menampilkan **96% tersisa untuk 5h dan 86% mingguan** pada 22.06 WIB. Probe metadata readonly setelahnya mengonfirmasi nilai yang sama, katalog 8 model, source codex dan plan Plus (`provider-usage-live-final.json`). Tidak ada inference untuk membaca kuota. Perubahan terakhir format jam lintas tengah malam diverifikasi regresi frontend dan release4, setelah screenshot review ini. `native-review-current.png` adalah hasil lama yang tetap terlihat saat review; bukan bukti sukses prompt gerbang yang kebetulan sedang berjalan di jendela. Jendela review dibiarkan terbuka karena terdapat aktivitas pengguna; data acceptance tetap terisolasi. Bukti native dibaca sesuai timestamp dan identitasnya.
