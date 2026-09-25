#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"
# Serialize local deployments. CI also uses a non-cancelling concurrency group.
mkdir -p .release-tmp
exec 9>.release-tmp/deploy.lock
flock -n 9 || { echo "Another release command is running." >&2; exit 1; }
exec node scripts/deploy-release.mjs "$@"
