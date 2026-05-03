#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

for test_file in \
	"${ROOT_DIR}/tests/test-extension-skip-config.sh" \
	"${ROOT_DIR}/tests/test-sync-extra-extensions.sh" \
	"${ROOT_DIR}/tests/test-index-template.sh"
do
	printf '== %s ==\n' "$(basename "$test_file")"
	bash "$test_file"
done
