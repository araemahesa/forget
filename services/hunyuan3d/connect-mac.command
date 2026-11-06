#!/bin/bash
# Opens the SSH tunnel to the rented Hunyuan3D GPU worker (Vast.ai or similar).
# The worker host changes whenever a new instance is rented, so it is read from the
# environment or ~/.config/forgekit/hunyuan-worker.env instead of being hard-coded:
#   FORGEKIT_WORKER_HOST=root@203.0.113.10
#   FORGEKIT_WORKER_PORT=40042
set -euo pipefail
CONFIG="$HOME/.config/forgekit/hunyuan-worker.env"
if [[ -f "$CONFIG" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG"
fi
: "${FORGEKIT_WORKER_HOST:?Set FORGEKIT_WORKER_HOST (e.g. root@203.0.113.10) in $CONFIG}"
: "${FORGEKIT_WORKER_PORT:?Set FORGEKIT_WORKER_PORT (SSH port of the instance) in $CONFIG}"
exec /usr/bin/ssh -N -T -o BatchMode=no -o StrictHostKeyChecking=yes \
  -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 -i "$HOME/.ssh/forgekit_vast" -p "$FORGEKIT_WORKER_PORT" \
  -L 127.0.0.1:8765:127.0.0.1:8765 "$FORGEKIT_WORKER_HOST"
