#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${HUNYUAN_HOME:-$HOME/.local/share/forgekit-hunyuan3d}"
[[ -x "$ROOT/venv/bin/python" && -f "$ROOT/model-path" ]] || { echo 'Run setup.sh first'; exit 1; }
export HF_HOME="$ROOT/hf-cache" U2NET_HOME="$ROOT/rembg"
[[ -s "$U2NET_HOME/u2net.onnx" ]] || { echo 'Background-removal weights missing; rerun setup (runtime download refused)'; exit 1; }
# No model downloads, remote custom code, telemetry or proxy HTTP service at runtime.
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1
cd "$ROOT/Hunyuan3D-2"
exec "$ROOT/venv/bin/python" "$HERE/worker.py" \
  --token-file "$ROOT/token" --model-dir "$(cat "$ROOT/model-path")" "$@"
