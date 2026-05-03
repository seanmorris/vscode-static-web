#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "${ROOT_DIR}/tests/lib.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SOURCE_DIR="${TMP_DIR}/extra_extensions"
DEST_DIR="${TMP_DIR}/public/extensions"
MANIFEST="${TMP_DIR}/extra-extensions.list"

mkdir -p \
	"${SOURCE_DIR}/ext-good/dist" \
	"${SOURCE_DIR}/ext-good/resources" \
	"${SOURCE_DIR}/ext-good/node_modules/pkg" \
	"${SOURCE_DIR}/ext-good/.git" \
	"${SOURCE_DIR}/ext-good/src" \
	"${SOURCE_DIR}/ext-old/dist"

cat > "${SOURCE_DIR}/ext-good/package.json" <<'EOF'
{"name":"ext-good","browser":"dist/index.js"}
EOF

cat > "${SOURCE_DIR}/ext-old/package.json" <<'EOF'
{"name":"ext-old","browser":"dist/index.js"}
EOF

printf 'console.log("good");\n' > "${SOURCE_DIR}/ext-good/dist/index.js"
printf 'console.log("old");\n' > "${SOURCE_DIR}/ext-old/dist/index.js"
printf '<svg></svg>\n' > "${SOURCE_DIR}/ext-good/resources/icon.svg"
printf 'readme\n' > "${SOURCE_DIR}/ext-good/README.md"
printf 'hack\n' > "${SOURCE_DIR}/ext-good/hack.js"
printf 'source\n' > "${SOURCE_DIR}/ext-good/index.js"
printf 'ignore\n' > "${SOURCE_DIR}/ext-good/node_modules/pkg/index.js"
printf 'ignore\n' > "${SOURCE_DIR}/ext-good/.git/config"
printf 'ignore\n' > "${SOURCE_DIR}/ext-good/src/index.js"
printf 'ignore\n' > "${SOURCE_DIR}/ext-good/package-lock.json"
printf 'ignore\n' > "${SOURCE_DIR}/ext-good/build-hack.mjs"
printf 'ignore\n' > "${SOURCE_DIR}/ext-good/hack-source.js"

SYNC_EXTRA_EXTENSIONS_MANIFEST="${MANIFEST}" \
	"${ROOT_DIR}/sync-extra-extensions.sh" "${SOURCE_DIR}" "${DEST_DIR}"

assert_exists "${DEST_DIR}/ext-good/package.json"
assert_exists "${DEST_DIR}/ext-good/dist/index.js"
assert_exists "${DEST_DIR}/ext-good/resources/icon.svg"
assert_exists "${DEST_DIR}/ext-good/README.md"
assert_exists "${DEST_DIR}/ext-good/hack.js"
assert_exists "${DEST_DIR}/ext-old/dist/index.js"
assert_not_exists "${DEST_DIR}/ext-good/node_modules"
assert_not_exists "${DEST_DIR}/ext-good/.git"
assert_not_exists "${DEST_DIR}/ext-good/src"
assert_not_exists "${DEST_DIR}/ext-good/package-lock.json"
assert_not_exists "${DEST_DIR}/ext-good/build-hack.mjs"
assert_not_exists "${DEST_DIR}/ext-good/hack-source.js"
assert_contains 'ext-good' "${MANIFEST}"
assert_contains 'ext-old' "${MANIFEST}"

mkdir -p "${DEST_DIR}/ext-good/node_modules/leftover"
printf 'stale\n' > "${DEST_DIR}/ext-good/node_modules/leftover/file.js"
rm -rf "${SOURCE_DIR}/ext-old"

SYNC_EXTRA_EXTENSIONS_MANIFEST="${MANIFEST}" \
	"${ROOT_DIR}/sync-extra-extensions.sh" "${SOURCE_DIR}" "${DEST_DIR}"

assert_not_exists "${DEST_DIR}/ext-old"
assert_not_exists "${DEST_DIR}/ext-good/node_modules"
assert_contains 'ext-good' "${MANIFEST}"
assert_not_contains 'ext-old' "${MANIFEST}"
