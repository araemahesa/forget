# Hunyuan3D-2 private GPU worker

## Status 4 November 2026: perbaikan warna lokal; GPU belum tersambung

ForgeKit 0.1.44 mengaktifkan tekstur warna pada setiap generasi dari halaman **Generator**. Loader pratinjau memakai jalur gambar yang diizinkan CSP; kegagalan decoding tekstur dilaporkan, bukan diganti mesh putih diam-diam. **Buka di Blender** membersihkan scene bawaan, mengimpor GLB dan mengaktifkan Material Preview.

Panduan Obsidian `model3d` dibaca dari konfigurasi vault yang sudah ada sebelum pengiriman. Snapshot panduan disimpan privat secara lokal sesuai ID job untuk pemeriksaan/audit; teks vault **tidak dikirim ke GPU dan tidak mengubah bobot atau inferensi Hunyuan**. Penilaian kesamaan gambar/warna belum otomatis. Bentuk dan warna bagian tersembunyi tetap estimasi model, bukan jaminan identik.

SSH instance Kanada lama menolak koneksi pada 4 November 2026 (`Connection refused`). Jangan menganggap worker aktif. Perlu instance aktif atau detail SSH terbaru sebelum uji generasi berwarna baru; jangan mengganti wilayah tanpa pemeriksaan lisensi Tencent. Hasil GLB lokal sebelumnya tetap tersedia.

Bukti historis 3 November: satu inferensi bertekstur selesai dalam 217.72 detik, GLB 2,972,540 byte dengan tekstur base-color tertanam. Ini bukan pengukuran rata-rata atau jaminan kualitas semua referensi. Token tetap privat, worker tetap loopback-only. Jangan menghentikan/menghapus instance tanpa keputusan pengguna; storage/bandwidth dapat tetap ditagih sesuai provider.

## License and location: stop before provisioning

**Do not deploy to the Czech Republic instance shown in the screenshot unless Tencent has separately authorized the deployment and intended use.** Czech Republic is in the EU. The pinned upstream Tencent Hunyuan 3D 2.0 Community License excludes the EU, UK and South Korea from its Territory, and restricts use/distribution/display of models and outputs outside that Territory. This is **not Apache-2.0** and not an unrestricted commercial license.

Before downloading weights or starting a GPU host, the operator must review both the source and model licenses and confirm deployment region, users, output use, acceptable-use, attribution/distribution and hosted-service terms. The license also has an additional commercial permission condition for products/services exceeding its stated one-million-MAU threshold. Third-party service deployments require clear provider identity and Tencent non-affiliation disclosures. Separate permission, if needed, must come from Tencent; an SSH tunnel does not change a prohibited server location. The setup flag is an explicit operator confirmation, not a license grant or geolocation check.

Verified public upstream references:

- [Official repository and installation/API examples](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/tree/f8db63096c8282cb27354314d896feba5ba6ff8a)
- [Pinned LICENSE](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/f8db63096c8282cb27354314d896feba5ba6ff8a/LICENSE) and [NOTICE](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/f8db63096c8282cb27354314d896feba5ba6ff8a/NOTICE)
- [Pinned model snapshot](https://huggingface.co/tencent/Hunyuan3D-2/tree/9cd649ba6913f7a852e3286bad86bfa9a2d83dcf)
- [Official low-VRAM paint mode](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/f8db63096c8282cb27354314d896feba5ba6ff8a/gradio_app.py#L692-L705)

## Host prerequisites

Target: Ubuntu 22.04/24.04, RTX 3090 24 GB (compute capability 8.6), Python **3.10**, existing compatible NVIDIA driver, **CUDA Toolkit 12.4 or 12.6 including nvcc**, GCC/G++ compiler and Python development headers/venv support. CUDA shown by `nvidia-smi` is driver capability, not proof that the Toolkit/compiler exists. A CUDA 12.4-compatible driver is required; NVIDIA 550.54.15+ on Linux is the normal Toolkit 12.4 baseline. Have provider/admin resolve driver/toolkit mismatch. **These scripts never install or change drivers, run apt, provision cloud instances or spend inference credits.**

Allow roughly 50 GB free disk for model snapshots, packages/builds and caches, and preferably 32+ GB RAM for shape/paint transitions. Exact peak VRAM/RAM remain unmeasured. One live textured demo took 217.72 seconds through local save; this is not a general speed guarantee. 24 GB is a target, not a guarantee against out-of-memory failures.

Core compatibility targets: CUDA Toolkit **12.4** uses PyTorch **2.5.1**, torchvision **0.20.1**, wheel index **cu124**; Toolkit **12.6** uses PyTorch **2.6.0**, torchvision **0.21.0**, wheel index **cu126**, diffusers **0.32.2**, transformers **4.48.3**, Python **3.10**, NumPy **1.26.4**. Core versions are pinned; transitive dependencies are not a fully locked environment. Successful setup records `installed-requirements.txt` for diagnosis. Ubuntu 24.04 requires an existing Python 3.10 environment; the script does not alter the system Python.

## Setup and start

Run from repository root on an authorized GPU host:

```bash
# Only after confirming license, permitted deployment region and intended use:
./services/hunyuan3d/setup.sh --accept-license-and-permitted-region
./services/hunyuan3d/run.sh > "$HOME/.local/share/forgekit-hunyuan3d/worker.log" 2>&1
```

`PYTHON` selects the Python 3.10 executable; `HUNYUAN_HOME` changes the private installation directory (default `~/.local/share/forgekit-hunyuan3d`). Run as a dedicated unprivileged account, not root. No public inbound port is needed.

Setup fetches and verifies exact source commit `f8db63096c8282cb27354314d896feba5ba6ff8a`, downloads exact model revision `9cd649ba6913f7a852e3286bad86bfa9a2d83dcf`, builds upstream CUDA custom rasterizer and C++ differentiable renderer, checks imports and executes a real CUDA tensor operation. It pre-caches background-removal weights. Hugging Face and rembg dependencies download during this explicit setup only; no paid inference API is called. Upstream background-removal weights/transitive downloads are not version-locked by this script. Inspect their license/provenance for production.

The script creates a cryptographically random bearer token in private `token` (0600), never prints its content and never passes the token in a process argument. Existing token is not silently rotated. Transfer its value into ForgeKit's worker credential setting through a trusted private channel; never paste it into shared chat, shell commands, screenshots or logs. This is worker auth, not a cloud/provider token. Never use a cloud master/API token here. Live credential transfer uses the authorized SSH channel and private native configuration without printing token contents.

`run.sh` sets offline model flags, disables Hugging Face telemetry and uses the local snapshot. The worker binds **127.0.0.1:8765 only**, accepts no remote URLs/prompts/code, exposes no static directory, and does not enable browser CORS. Keep token and state directories owner-private. Startup refuses CUDA-unavailable hosts and unsafe token/state permissions. Only one worker process can own the state root.

Setup output is retained in private `setup.log`. Runtime errors return a generic safe message and log only job ID plus exception class, never arbitrary exception content. For failure: check CUDA/driver/toolkit, disk/RAM, model snapshot and native extension imports; do not post logs without reviewing for third-party library disclosures. The generic startup message is deliberately sanitized.

## Optional container path when Ubuntu lacks Python 3.10 / nvcc

Stock Ubuntu 24.04 is **not** ready for the direct script. If the provider already supports Docker plus NVIDIA Container Toolkit, build the included Dockerfile on the authorized GPU host. It supplies Python 3.10, CUDA Toolkit 12.4 and compiler inside the container without changing the host GPU driver. The official NVIDIA base image tag is versioned, not digest-locked. No Hunyuan source/weights are baked into the image. Container builds and GPU access have not been run in this development session.

```bash
# Repository root, Linux GPU host; build does not accept/download Hunyuan weights.
docker build -f services/hunyuan3d/Dockerfile -t forgekit-hunyuan3d:cu124 services/hunyuan3d

# Create private state owned by container's unprivileged uid 1000.
# If current host user is not uid 1000, ask admin to create/chown this new directory.
mkdir -m 700 -p "$HOME/forgekit-hunyuan-state"

# Only after license/location approval. No public port published.
docker run --rm --gpus all --network host \
  --mount "type=bind,src=$HOME/forgekit-hunyuan-state,dst=/home/worker/.local/share/forgekit-hunyuan3d" \
  forgekit-hunyuan3d:cu124 ./setup.sh --accept-license-and-permitted-region

docker run --rm --gpus all --network host \
  --mount "type=bind,src=$HOME/forgekit-hunyuan-state,dst=/home/worker/.local/share/forgekit-hunyuan3d" \
  forgekit-hunyuan3d:cu124
```

Host networking is intentional **on Linux**: the worker remains bound to host loopback so the SSH tunnel can reach it. Do not add a public proxy or use a `0.0.0.0` binding. The persistent mount contains token, model/cache, private setup log and packages. State/output root is inside the ephemeral container by default; unfinished/downloadable jobs disappear when the container is removed. `--data-dir /home/worker/.local/share/forgekit-hunyuan3d/jobs` may be passed to the final run command when persistent worker state storage is wanted, but sessions still reset on worker restart. Do not install Docker/GPU runtime on the user's host without separate approval; a provider image with documented GPU container support is preferable.

## SSH tunnel from development Mac

Use the provider's documented SSH port/key and an authorized server location:

```bash
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:8765:127.0.0.1:8765 USER@GPU_HOST
```

Set ForgeKit worker URL to `http://127.0.0.1:8765`. Replace `USER`, `GPU_HOST` and add documented SSH port/key options as needed. Do not bind the worker or tunnel to `0.0.0.0`; SSH provides transport encryption while the service remains loopback-only. HTTP bearer auth remains required inside the tunnel. GPU cloud billing continues while its instance runs. Stop it through the provider when done; closing the tunnel or app does not stop billing. Back up local results before any recycle/destroy action: the current instance has no persistent volume and those actions remove models and server results.

## Pemakaian di ForgeKit

1. Buka **Studio Kreatif → Model 3D**, halaman **Generator** setelah worker pada host berizin berjalan dan tunnel SSH aktif. Isi endpoint `http://127.0.0.1:8765` dan token worker di kolom privat; jangan gunakan token cloud/provider atau membagikan screenshot token.
2. Jalankan pemeriksaan health. `ready:true` dan `cuda_available:true` berarti pemeriksaan awal tersedia, **bukan** bukti inference bertekstur lengkap sudah berhasil.
3. Pilih referensi PNG/JPEG/WebP, isi seed dan steps sesuai batas di atas, tekstur warna selalu aktif pada halaman Generator. Tunggu job selesai; pengiriman job belum berarti model berhasil dibuat.
4. Setelah berhasil, tekan **Simpan & pratinjau GLB**. ForgeKit mengunduh GLB nyata, menyimpannya secara lokal beserta hash/informasi hasil, lalu menampilkan hasil di galeri. Buka hasil melalui Blender atau folder lokal untuk memeriksa geometri dan material. Simpan/backup workspace aplikasi agar hasil lokal tetap tersedia.

Penghapusan hasil server dilakukan best-effort **sesudah** penyimpanan lokal berhasil; kegagalan cleanup tidak membatalkan hasil lokal yang sudah tersimpan. Hasil yang belum dibersihkan kedaluwarsa setelah satu jam, dan restart worker membuang sesi sebelumnya. Unduh hasil sebelum restart. Halaman Generator memakai satu jalur GPU; tab mode lama tidak ditampilkan. Tidak ada janji auto-retopology, multiview, tekstur 4K atau kesamaan visual sempurna; hasil model nyata tetap harus diperiksa.

## HTTP contract, version 1

All requests, including health and GLB download, require `Authorization: Bearer <worker-token>`. There are no trailing-slash aliases, redirects or cross-origin browser headers. JSON errors use `{"error":"safe message"}`. Unknown job/endpoint is 404, missing/wrong auth 401, invalid input 400, unsupported content type 415, oversized body 413, full capacity 429, output not ready 409. Job IDs are 32 lowercase hexadecimal characters.

### `GET /health`

Returns `model: "tencent/Hunyuan3D-2"`, `version`, `source_revision`, `model_revision`, `ready`, `cuda_available`, `gpu` and `cuda_version`. CUDA readiness checks a real operation at startup, required local model folders and pipeline imports. **Ready does not mean that a complete textured inference has succeeded** or that every model parameter has already been loaded. CUDA-unavailable startup fails closed rather than faking health.

### `POST /v1/jobs`

`Content-Type: application/json` and a single bounded `Content-Length` are required; chunked uploads are not accepted.

```json
{
  "image_base64": "RAW_BASE64_IMAGE_BYTES_WITHOUT_DATA_URL_PREFIX",
  "seed": 1,
  "steps": 30,
  "texture": true
}
```

- Exactly one image; PNG/JPEG/WebP only, actual decoder verification, single frame. No image path, URL, text prompt or code fields accepted. EXIF orientation applied; metadata removed.
- Image bytes ≤8 MiB, request body ≤12 MiB, side lengths 16..4096, total pixels ≤4,194,304. Inference input downscaled to a maximum side of 1024. Malformed and decompression-bomb images rejected.
- `seed`: integer 0..2,147,483,647 (default 0); `steps`: integer 1..50 (default 30); `texture`: boolean (default true). Booleans are not integers. Unknown fields rejected.
- Seed and steps control shape inference. At this pinned upstream revision paint uses its own fixed seed 0 and fixed texture sampling policy; worker does not falsely promise that shape steps/seed control paint.

Returns HTTP 202:

```json
{"id":"2c502fd1e10e44dc9fd3c6bc14d22ec8","status":"queued","model":"tencent/Hunyuan3D-2"}
```

### `GET /v1/jobs/{id}`

Same fields, status one of `queued`, `running`, `succeeded`, `failed`, `cancelled`. Failed job adds sanitized `error`. Succeeded job adds `output_url: "/v1/jobs/{id}/model.glb"`. Poll about every 2 seconds; do not treat submission as successful inference.

### `GET /v1/jobs/{id}/model.glb`

Authenticated `model/gltf-binary`, ≤64 MiB, real GLB version 2, embedded binary resources only. For `texture:true`, validator requires embedded texture image and base-color texture material. Texture generation failure never silently downgrades to an untextured success. Native client must independently validate file framing/size before saving. No fake/procedural fallback is returned.

Shape and texture use official `Hunyuan3DDiTFlowMatchingPipeline` and `Hunyuan3DPaintPipeline`, explicit `hunyuan3d-dit-v2-0` and `hunyuan3d-paint-v2-0` subfolders. Shape octree resolution fixed at 256. Shape is deleted and GPU cache cleared before paint is loaded; paint remains on CUDA. Aggregate paint CPU offload is not called: live testing exposed mixed CPU/CUDA embeddings in the pinned pipeline. Shape's offload method is not used because pinned upstream implementation references `self.components` without defining it and its inference reads `self.device` directly. Per-job reloading sacrifices latency to limit overlapping models. This path completed one full textured image-to-3D demo on the Canada RTX 3090; peak memory, broader input coverage and native UI acceptance remain outstanding.

### `DELETE /v1/jobs/{id}`

Returns cancelled job record. Queued/completed jobs and outputs are deleted immediately; later polling returns 404. Running cancellation is cooperative between expensive stages, **not** an unsafe GPU thread interruption: current stage must return, generated result is discarded, files are deleted and ID disappears. A cancelled running task still occupies the single GPU slot until it returns. Client should stop polling after cancellation; in-flight polls can see 404.

Only one inference runs at a time. Capacity is four total retained jobs, including queued/running and terminal results; this caps output retention at 256 MiB plus small sanitized input files. Delete server result after client has durably saved its GLB/manifest. Client cleanup failure must not invalidate a successful local save. If cleanup is not performed, capacity returns 429 rather than silently deleting an uncollected output. Terminal jobs expire after one hour; cleanup sweep runs every five seconds. Input files are deleted after inference. State is ephemeral: restart removes prior worker session data; retrieve completed outputs before restarting. `Ctrl-C` requests cancellation and waits for current GPU stage before cleanup.

## Local checks and remaining acceptance

No model/GPU libraries are imported by unit tests. Pillow is the only image-decoding dependency; use an environment with Pillow installed:

```bash
python3 -m unittest discover -s services/hunyuan3d -v
bash -n services/hunyuan3d/setup.sh services/hunyuan3d/run.sh
```

Tests cover auth/private token permissions, decoded image and numeric bounds, GLB resource/texture checks, single-concurrent inference with mock engine, queue capacity, cancellation/deletion, safe failures, expiration and authenticated HTTP endpoints. Mock output does **not** validate real model quality.

Live Canada acceptance completed: health CUDA true, demo image submitted with `texture:true`, job succeeded, GLB downloaded and durably saved on Mac, GLB framing/mesh/embedded image/base-color texture validated, size below 64 MiB, and server cleanup requested. Measured elapsed time through local save: 217.72 seconds. Remaining checks: open the result for visual geometry/material comparison, verify native ForgeKit 0.1.43 UI flow after the scoped Tauri-permission rebuild, exercise cancellation against live inference, and measure peak VRAM/RAM. Unit-test cancellation and one successful HTTP demo do not establish those remaining checks.

## Instance Kanada — pemasangan live 3 November 2026

Instance 58969879, host Kanada, RTX3090 24GB, endpoint SSH `96.20.36.104:40042`. Aktual container Ubuntu24.04, compiler CUDA12.6 dan driver555.58.02; label template12.4 bukan inventaris aktual. Operasi CUDA awal berhasil. Python3.10 dipasang terpisah melalui `uv`, tanpa mengganti Python/PyTorch bawaan. Script memilih wheel cu126 agar compiler extension dan wheel cocok. Driver host tidak diganti. Pemasangan dependensi/model dan satu inference image-to-3D bertekstur lengkap sudah berhasil (exit 0).

Tunnel foreground untuk sesi ini sudah berjalan. Setelah tunnel terputus atau Mac reboot, klik dua kali [connect-mac.command](../services/hunyuan3d/connect-mac.command), lalu biarkan jendela Terminal terbuka saat memakai ForgeKit; passphrase dimasukkan di Terminal jika diminta. Jangan membuka tunnel kedua selama tunnel pertama aktif: keduanya akan berebut bind `127.0.0.1:8765`. Tidak ada private key atau token di script. Script memerlukan host key sudah diverifikasi. Host/port harus diperbarui bila instance berganti. Tidak ada auto-start tunnel pada Mac; supervisor GPU terpisah dan memulai worker otomatis saat supervisor instance aktif.

### Managed service dan batas data

Konfigurasi Vast khusus instance tersedia sebagai `vast-worker.sh`, `vast-worker.conf`, dan `vast-install-service.sh` pada direktori worker. Pemasangan hanya menambah layanan `forgekit-hunyuan`; tidak mengubah Caddy, portal, auth Vast atau driver. Layanan memakai loopback8765 serta tunnel SSH. Supervisor dikonfigurasi `autostart=true` dan `autorestart=unexpected`; worker otomatis dimulai saat supervisor instance aktif, bukan menyalakan instance GPU yang berhenti. Koneksi aplikasi tetap memerlukan tunnel aktif di Mac; skrip `connect-mac.command` membuka ulang tunnel, bukan layanan GPU.

Snapshot berikutnya hanya mengambil shape `config.yaml` + `model.fp16.safetensors`, base paint/delight yang diperlukan. Duplikat paint UNet safetensors dan VAE BIN tidak diambil; custom UNet tetap wajib BIN. Seleksi khusus source/model revision yang dipin, bukan opsi mengubah model sembarang. Instalasi live yang sudah berjalan bisa masih memakai pola sebelumnya; cache tidak dihapus otomatis.

### Hasil pemasangan Kanada — diperbarui setelah demo lengkap

Pemasangan source, dependensi, custom rasterizer/renderer, model snapshot, dan background-removal weights selesai exit0. Python3.10.22 serta torch2.6.0/cu126 terpisah dari bawaan. Token worker dipindahkan melalui SSH ke konfigurasi native ForgeKit mode0600 tanpa dicetak; endpoint loopback8765. Layanan supervisor `forgekit-hunyuan` berjalan setelah memperbaiki argumen logging wrapper. Tujuh tes worker pada lingkungan GPU terpasang lulus exit0. Satu job gambar demo bertekstur lengkap berhasil exit 0, hasil GLB tersimpan di Mac: 2,972,540 byte dengan satu gambar tertanam; waktu 217.72 detik sampai penyimpanan lokal. Native ForgeKit 0.1.43 masih menjalani rebuild izin Tauri; keberhasilan skrip HTTP ini tidak membuktikan alur native end-to-end. Biaya GPU tetap berjalan selama instance menyala. Workspace host tidak memiliki volume; recycle/destroy menghapus model dan hasil server. Simpan hasil di Mac sebelum tindakan tersebut.

### Perbaikan setelah uji GPU pertama

Job pertama mencapai tahap tekstur tetapi gagal karena agregat CPU offload upstream membuat embedding multiview di CPU sementara negative embedding berada di CUDA. Worker sekarang melepas shape sebelum paint dan membiarkan pipeline paint pada CUDA; tidak memanggil metode agregat offload. Source/bobot upstream tidak dimodifikasi. Uji tekstur terisolasi pada mesh sphere nyata berhasil exit0 pada RTX3090. Tujuh tes worker ulang berhasil. Uji image-to-3D lengkap berikutnya juga berhasil exit 0 dengan tekstur tertanam; hasil sphere bukan satu-satunya bukti. Receipt demo lengkap mencatat job `c622daffca834ca998b5fefc4abcba21`, SHA-256 `59c96b9466f64db782b194c24a905f83f492b00c3323e88f847c934ad813b7bb`, GLB 2,972,540 byte, satu gambar tertanam, dan waktu 217.72 detik. Receipt dan GLB disimpan lokal, tanpa token; kualitas visual dan alur native masih perlu diperiksa.

## Edit model dengan prompt — 0.1.45

Generator menyediakan **Edit dengan AI** setelah model dipilih dari **Riwayat Model**. Pilih akun/model provider, tulis perubahan, lalu tekan **Kirim perubahan**. Provider tersimpan digunakan sungguhan untuk membuat rencana JSON tervalidasi; bukan pencocokan kata kunci. Blender lokal mengimpor GLB asal, mengerjakan rencana lewat runner tetap, mengekspor dan mengimpor ulang GLB hasil sebelum menyimpan revisi terpisah. **Buka di Blender** dan **Unduh GLB** memakai model revisi yang dipilih, bukan geometri pratinjau sementara. GPU Hunyuan tidak diperlukan untuk mengedit model lokal.

- Didukung: menambah maksimal 32 komponen recipe per revisi, mengubah warna/PBR, skala, posisi/rotasi objek, dan menghapus komponen tambahan bertanda. Model asal tidak ditimpa; kembali melalui riwayat.
- Belum didukung: sculpting, deformasi/topologi mesh asal, segmentasi otomatis bagian yang menyatu, rigging, tekstur gambar baru, atau aset eksternal. Permintaan di luar kontrak harus ditolak, bukan dilaporkan selesai.
- Warna solid menggantikan koneksi base-color texture hanya pada objek yang diminta. Perubahan roughness/metalness tidak menghapus warna tekstur asal. Satu mesh Hunyuan tidak otomatis terpisah menjadi kepala, badan, dan aksesori.
- Prompt, ringkasan struktur/bounds/material objek, dan panduan Obsidian relevan dikirim ke provider pilihan; GLB mentah tidak dikirim. Model/provider memakai credential tersimpan. Riwayat percakapan lokal per model tidak menjadi chat provider penuh; revisi berikutnya menerima kondisi GLB terbaru.
- Rencana AI hanya data, tidak pernah Python/shell. Runner dipercaya tetap, command Tauri diberi satu izin khusus. Batas: prompt 16 KiB, JSON 256 KiB, 64 operasi, maksimal 256 objek mesh. Timeout provider 120 detik; timeout Blender 120 detik per tahap. Satu edit berjalan pada satu waktu.
- Revisi menyimpan hash induk, prompt, model/provider, rencana tervalidasi, hash konteks Obsidian, dan hasil impor ulang. Log Blender lokal disimpan privat. Catatan Obsidian bukan conditioning neural Hunyuan dan bukan jaminan kualitas.

Pemeriksaan mandiri runner tanpa provider (memakai fixture terisolasi, bukan model pengguna):

```bash
python3 scripts/test_hunyuan_edit.py
```
