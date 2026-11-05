#!/bin/bash
set -euo pipefail
umask 077
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT=/workspace/forgekit-hunyuan3d
[[ -s "$ROOT/token" && -s "$ROOT/model-path" && -x "$ROOT/venv/bin/python" ]] || { echo 'Run successful model setup first'; exit 1; }
WRAPPER=/opt/supervisor-scripts/forgekit-hunyuan.sh
CONF=/etc/supervisor/conf.d/forgekit-hunyuan.conf
for pair in "vast-worker.sh:$WRAPPER" "vast-worker.conf:$CONF"; do
  src="$HERE/${pair%%:*}"; dst="${pair#*:}"
  if [[ -e "$dst" ]] && ! cmp -s "$src" "$dst"; then
    echo 'Existing service differs; stop to preserve its configuration'; exit 1
  fi
done
install -m 700 "$HERE/vast-worker.sh" "$WRAPPER"
install -m 600 "$HERE/vast-worker.conf" "$CONF"
supervisorctl reread
supervisorctl update forgekit-hunyuan
supervisorctl status forgekit-hunyuan
supervisorctl status forgekit-hunyuan | grep -q RUNNING || { echo 'Worker not running; inspect /var/log/portal/forgekit-hunyuan.log'; exit 1; }
