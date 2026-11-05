#!/bin/bash
# ponytail: one authorized Vast instance; update host/port after renting a replacement.
set -euo pipefail
exec /usr/bin/ssh -N -T -o BatchMode=no -o StrictHostKeyChecking=yes \
  -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 -i "$HOME/.ssh/forgekit_vast" -p 40042 \
  -L 127.0.0.1:8765:127.0.0.1:8765 root@96.20.36.104
