#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "${ROOT_DIR}/tests/lib.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p \
	"${TMP_DIR}/public/extensions/ext-a" \
	"${TMP_DIR}/public/extensions/ext-skip"

cat > "${TMP_DIR}/public/extensions/ext-a/package.json" <<'EOF'
{
  "name": "ext-a",
  "version": "1.2.3",
  "publisher": "acme",
  "hacks": ["hack.js"]
}
EOF

cat > "${TMP_DIR}/public/extensions/ext-a/package.nls.json" <<'EOF'
{
  "displayName": "Extension A"
}
EOF

cat > "${TMP_DIR}/public/extensions/ext-a/hack.js" <<'EOF'
function(config){config.commands.push("ext-a-hack");}
EOF

cat > "${TMP_DIR}/public/extensions/ext-skip/package.json" <<'EOF'
{
  "name": "ext-skip",
  "version": "9.9.9",
  "publisher": "acme",
  "hacks": ["hack.js"]
}
EOF

cat > "${TMP_DIR}/public/extensions/ext-skip/hack.js" <<'EOF'
function(config){config.commands.push("ext-skip-hack");}
EOF

OUTPUT_FILE="${TMP_DIR}/index.html"

(
	cd "$TMP_DIR"
	VSCODE_BASEPATH='/editor' \
	VSCODE_SKIP_EXTENSIONS='ext-skip' \
	VSCODE_RESOURCE_URL_TEMPLATE='https://assets.example/{path}' \
	VSCODE_SERVICE_URL='https://service.example' \
	VSCODE_ITEM_URL='https://item.example' \
	php "${ROOT_DIR}/source/index-template.html.php" > "${OUTPUT_FILE}"
)

assert_contains 'config.commands.push("ext-a-hack");' "${OUTPUT_FILE}"
assert_not_contains 'ext-skip-hack' "${OUTPUT_FILE}"
assert_contains '&quot;extensionPath&quot;:&quot;ext-a&quot;' "${OUTPUT_FILE}"
assert_not_contains '&quot;extensionPath&quot;:&quot;ext-skip&quot;' "${OUTPUT_FILE}"
assert_contains 'https://assets.example/{path}' "${OUTPUT_FILE}"
assert_contains 'https://service.example' "${OUTPUT_FILE}"
assert_contains 'https://item.example' "${OUTPUT_FILE}"
assert_contains '<base href="/editor">' "${OUTPUT_FILE}"
