#!/bin/bash
# Private service: no portal/Caddy changes, remote access uses SSH forwarding only.
set -euo pipefail
. /opt/supervisor-scripts/utils/logging.sh /var/log/portal/forgekit-hunyuan.log
export HUNYUAN_HOME=/workspace/forgekit-hunyuan3d
exec /bin/bash /workspace/forgekit-gpu/services/hunyuan3d/run.sh --port 8765
