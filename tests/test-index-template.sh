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
  "browser": "dist/index",
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
mkdir -p "$TMP_DIR/public/extensions/ext-a/dist"
printf 'exports.activate = () => {};\n' > "$TMP_DIR/public/extensions/ext-a/dist/index.js"

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
assert_contains '<base href="/editor/">' "${OUTPUT_FILE}"
assert_contains 'window.vscodeEditorReady = new Promise' "${OUTPUT_FILE}"
assert_contains 'resolveVSCodeEditorReady?.(editor);' "${OUTPUT_FILE}"
assert_contains "{kind: 'vscode-react', type: 'ready'}" "${OUTPUT_FILE}"
assert_contains 'src="./out/vs/workbench/workbench.web.main.nls.js?v=' "${OUTPUT_FILE}"
assert_contains 'src="./out/vs/workbench/workbench.web.main.js?v=' "${OUTPUT_FILE}"
assert_contains 'src="./out/vs/code/browser/workbench/workbench.js?v=' "${OUTPUT_FILE}"
assert_not_contains "require(['vs/code/browser/workbench/workbench']" "${OUTPUT_FILE}"

# Replacing a bootstrap bundle must invalidate every cached bootstrap URL.
mkdir -p "$TMP_DIR/public/out/vs/workbench"
printf 'new production bundle\n' > "$TMP_DIR/public/out/vs/workbench/workbench.web.main.js"
(
	cd "$TMP_DIR"
	VSCODE_SKIP_EXTENSIONS=ext-skip php "$ROOT_DIR/source/index-template.html.php" > "$TMP_DIR/changed.html"
)
printf 'exports.activate = () => "updated";\n' > "$TMP_DIR/public/extensions/ext-a/dist/index.js"
(
	cd "$TMP_DIR"
	VSCODE_SKIP_EXTENSIONS=ext-skip php "$ROOT_DIR/source/index-template.html.php" > "$TMP_DIR/extension-changed.html"
)
node - "$OUTPUT_FILE" "$TMP_DIR/changed.html" "$TMP_DIR/extension-changed.html" <<'EOF'
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const versions = path => [...readFileSync(path, 'utf8').matchAll(/(?:src|href)="\.\/out\/[^"?]+\?v=([a-f0-9]{16})"/g)].map(match => match[1]);
const before = versions(process.argv[2]);
const after = versions(process.argv[3]);
assert.equal(before.length, 6);
assert.equal(after.length, 6);
assert.equal(new Set(before).size, 1);
assert.equal(new Set(after).size, 1);
assert.notEqual(before[0], after[0]);
assert.deepEqual(versions(process.argv[4]), after, 'An extension update must preserve core asset URLs');
const entry = path => JSON.parse(readFileSync(path, 'utf8').match(/id="vscode-workbench-builtin-extensions"\s+data-settings="([^"]+)"/)[1].replaceAll('&quot;', '"'))[0].packageJSON.browser;
assert.match(entry(process.argv[2]), /^dist\/index\.[a-f0-9]{16}\.js$/);
assert.equal(entry(process.argv[2]), entry(process.argv[3]));
assert.notEqual(entry(process.argv[3]), entry(process.argv[4]));
const {dirname, join} = require('node:path');
const staged = join(dirname(process.argv[4]), 'public/extensions/ext-a');
assert.equal(readFileSync(join(staged, entry(process.argv[4])), 'utf8'), readFileSync(join(staged, 'dist/index.js'), 'utf8'));
EOF
