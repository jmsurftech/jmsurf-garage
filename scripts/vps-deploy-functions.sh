#!/usr/bin/env bash
# Deploys the Supabase Edge Functions from this repository into the
# self-hosted Supabase stack running on the VPS (Coolify).
#
# Run this on the VPS:
#   bash scripts/vps-deploy-functions.sh
#
# Environment overrides:
#   FUNCTIONS_CONTAINER  name of the supabase edge-functions container
#   REPO_DIR             path to a checkout of this repository on the VPS

set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FUNCTIONS_CONTAINER="${FUNCTIONS_CONTAINER:-$(docker ps --format '{{.Names}}' | grep -m1 'supabase-edge-functions' || true)}"

if [ -z "$FUNCTIONS_CONTAINER" ]; then
  echo "Could not find the supabase edge-functions container." >&2
  echo "Set FUNCTIONS_CONTAINER=<name> and re-run." >&2
  exit 1
fi

# Locate the host directory bound to /home/deno/functions inside the container.
HOST_DIR="$(docker inspect "$FUNCTIONS_CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/home/deno/functions"}}{{.Source}}{{end}}{{end}}')"

if [ -z "$HOST_DIR" ]; then
  echo "The container $FUNCTIONS_CONTAINER has no /home/deno/functions mount." >&2
  exit 1
fi

echo "Repository:  $REPO_DIR"
echo "Container:   $FUNCTIONS_CONTAINER"
echo "Functions:   $HOST_DIR"

rsync -a --delete \
  --exclude '.git' \
  "$REPO_DIR/supabase/functions/" "$HOST_DIR/"

docker restart "$FUNCTIONS_CONTAINER" >/dev/null
echo "Edge functions deployed and runtime restarted."
