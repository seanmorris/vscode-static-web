#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SKIP_FILE="${TMP_DIR}/extensions-skip.list"

cat > "${SKIP_FILE}" <<'EOF'
# Ignore comments and blank lines.
alpha

beta
EOF

default_value="$(
	make -pn -f "${ROOT_DIR}/Makefile" EXTENSIONS_SKIP_FILE="${SKIP_FILE}" 2>/dev/null \
	| sed -n 's/^VSCODE_SKIP_EXTENSIONS[[:space:]]*[:?+]*=[[:space:]]*//p' \
	| tail -n 1
)"

if [[ "${default_value}" != "alpha beta" ]]
then
	printf 'FAIL: expected default skip list to resolve to [alpha beta], got [%s]\n' "${default_value}" >&2
	exit 1
fi

override_value="$(
	make -pn -f "${ROOT_DIR}/Makefile" EXTENSIONS_SKIP_FILE="${SKIP_FILE}" VSCODE_SKIP_EXTENSIONS='override-a override-b' 2>/dev/null \
	| sed -n 's/^VSCODE_SKIP_EXTENSIONS[[:space:]]*[:?+]*=[[:space:]]*//p' \
	| tail -n 1
)"

if [[ "${override_value}" != "override-a override-b" ]]
then
	printf 'FAIL: expected explicit override to win, got [%s]\n' "${override_value}" >&2
	exit 1
fi
