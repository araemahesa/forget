#!/usr/bin/env bash
# Ubuntu 22.04/24.04, Python 3.10, existing NVIDIA driver + CUDA Toolkit 12.4 or 12.6.
set -Eeuo pipefail
umask 077
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${HUNYUAN_HOME:-$HOME/.local/share/forgekit-hunyuan3d}"
PYTHON="${PYTHON:-python3.10}"
REV=f8db63096c8282cb27354314d896feba5ba6ff8a
MODEL_REV=9cd649ba6913f7a852e3286bad86bfa9a2d83dcf
if [[ "${1:-}" != --accept-license-and-permitted-region ]]; then
  printf '%s\n' 'STOP: Review Tencent Hunyuan3D-2 LICENSE and model license first.' \
    'EU (including Czech Republic), UK, South Korea excluded without separate permission.' \
    'Confirm deployment location, users, output use, commercial and hosted-service terms.' \
    'Only if authorized: ./setup.sh --accept-license-and-permitted-region'
  exit 2
fi
[[ "$(uname -s)" == Linux ]] || { echo 'Requires Ubuntu/Linux GPU host'; exit 1; }
for cmd in "$PYTHON" git nvidia-smi nvcc g++; do
  command -v "$cmd" >/dev/null || { echo "Missing prerequisite: $cmd (no drivers/toolkits installed automatically)"; exit 1; }
done
"$PYTHON" -c 'import sys; assert sys.version_info[:2] == (3, 10), "Python 3.10 required"'
# Match wheel and extension compiler; never replace the host-injected NVIDIA driver.
case "$(nvcc --version)" in
  *"release 12.4"*) CUDA_VERSION=12.4; CUDA_INDEX=cu124; TORCH_VERSION=2.5.1; VISION_VERSION=0.20.1 ;;
  *"release 12.6"*) CUDA_VERSION=12.6; CUDA_INDEX=cu126; TORCH_VERSION=2.6.0; VISION_VERSION=0.21.0 ;;
  *) echo 'Requires CUDA Toolkit 12.4 or 12.6; driver alone is insufficient'; exit 1 ;;
esac
export CUDA_VERSION
"$PYTHON" - <<'PYTHON_CHECK'
import pathlib,sysconfig
assert (pathlib.Path(sysconfig.get_path('include')) / 'Python.h').is_file(), 'Matching Python 3.10 development headers required'
PYTHON_CHECK
mkdir -p "$ROOT"
chmod 700 "$ROOT"
"$PYTHON" - "$ROOT" <<'SPACE_CHECK'
import shutil,sys
assert shutil.disk_usage(sys.argv[1]).free >= 50 * 1024**3, 'At least 50 GiB free disk required before setup'
SPACE_CHECK
LOG="$ROOT/setup.log"
exec 3>&1
exec >>"$LOG" 2>&1
trap 'code=$?; printf "Setup failed, exit %s. Read private log: %s\n" "$code" "$LOG" >&3' ERR
printf 'Installing worker; full output saved in private setup log.\n' >&3
"$PYTHON" -m venv "$ROOT/venv"
PY="$ROOT/venv/bin/python"
"$PY" -m pip install 'pip==25.0.1' 'setuptools==75.8.0' 'wheel==0.45.1'
"$PY" -m pip install "torch==$TORCH_VERSION" "torchvision==$VISION_VERSION" --index-url "https://download.pytorch.org/whl/$CUDA_INDEX"
"$PY" - <<'PY'
import os, torch
assert torch.cuda.is_available(), 'CUDA unavailable; check existing driver compatibility with CUDA 12.4'
torch.ones(1, device='cuda').add_(1)
torch.cuda.synchronize()
print(torch.__version__, torch.version.cuda, torch.cuda.get_device_name(0))
assert torch.version.cuda == os.environ['CUDA_VERSION']
assert torch.cuda.get_device_properties(0).total_memory >= 22 * 1024**3, 'Use RTX3090-class 24GB GPU'
PY
SRC="$ROOT/Hunyuan3D-2"
if [[ ! -e "$SRC" ]]; then
  git init "$SRC"
  git -C "$SRC" remote add origin https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git
fi
[[ "$(git -C "$SRC" remote get-url origin)" == https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git ]] || { echo 'Unexpected upstream remote'; exit 1; }
[[ -z "$(git -C "$SRC" status --porcelain --untracked-files=no)" ]] || { echo 'Upstream checkout modified; preserve changes, then use clean HUNYUAN_HOME'; exit 1; }
git -C "$SRC" fetch --depth 1 origin "$REV"
git -C "$SRC" checkout --detach "$REV"
[[ "$(git -C "$SRC" rev-parse HEAD)" == "$REV" ]]
"$PY" -m pip install -r "$HERE/requirements.txt"
# Demo web app dependencies deliberately excluded; only private worker is served.
"$PY" -m pip install --no-deps --no-build-isolation -e "$SRC"
export TORCH_CUDA_ARCH_LIST=8.6 MAX_JOBS=2
export CUDA_HOME="$(dirname "$(dirname "$(command -v nvcc)")")"
(cd "$SRC/hy3dgen/texgen/custom_rasterizer" && "$PY" -m pip install --no-build-isolation --no-deps .)
(cd "$SRC/hy3dgen/texgen/differentiable_renderer" && "$PY" -m pip install --no-build-isolation --no-deps .)
export HF_HOME="$ROOT/hf-cache" U2NET_HOME="$ROOT/rembg"
mkdir -p "$HF_HOME" "$U2NET_HOME"
"$PY" - "$ROOT" "$MODEL_REV" <<'PY'
import sys
from pathlib import Path
from huggingface_hub import snapshot_download
root = Path(sys.argv[1])
path = snapshot_download(repo_id='tencent/Hunyuan3D-2', revision=sys.argv[2],
    allow_patterns=['hunyuan3d-dit-v2-0/config.yaml', 'hunyuan3d-dit-v2-0/model.fp16.safetensors',
                    'hunyuan3d-paint-v2-0/*', 'hunyuan3d-delight-v2-0/*', 'LICENSE*', 'NOTICE*'],
    # Pinned custom paint UNet requires BIN; standard VAE uses safetensors.
    ignore_patterns=['hunyuan3d-paint-v2-0/unet/diffusion_pytorch_model.safetensors',
                     'hunyuan3d-paint-v2-0/vae/diffusion_pytorch_model.bin'])
(root / 'model-path').write_text(path + '\n')
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
from hy3dgen.texgen import Hunyuan3DPaintPipeline
from hy3dgen.rembg import BackgroundRemover
BackgroundRemover()  # Pre-download background-removal weights during explicit setup.
import custom_rasterizer_kernel, mesh_processor
print('Pinned snapshot and renderer imports available; full inference not yet verified')
PY
"$PY" - "$ROOT/token" <<'PY'
import os,secrets,sys
try:
    fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
except FileExistsError:
    pass  # Never rotate existing credentials silently.
else:
    with os.fdopen(fd, 'w') as stream:
        stream.write(secrets.token_urlsafe(48) + '\n')
PY
"$PY" -m pip freeze > "$ROOT/installed-requirements.txt"
printf 'Setup complete, exit 0. Start with services/hunyuan3d/run.sh. Model inference remains unverified.\n' >&3
