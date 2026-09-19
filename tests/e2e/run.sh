#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${VSCODE_WEB_STATIC_E2E_PORT:-4173}"
CHROMIUM_BIN="${PLAYWRIGHT_CHROMIUM_PATH:-/usr/bin/chromium}"
E2E_VISIBLE="${E2E_VISIBLE:-0}"
E2E_HOLD_SECONDS="${E2E_HOLD_SECONDS:-0}"
SERVER_LOG="$(mktemp)"
DOM_DUMP="$(mktemp)"
VISIBLE_PROFILE_DIR=""

cleanup()
{
	if [[ -n "$VISIBLE_PROFILE_DIR" ]]
	then
		rm -rf "$VISIBLE_PROFILE_DIR"
	fi

	if [[ -n "${VISIBLE_PID:-}" ]]
	then
		kill "${VISIBLE_PID}" 2>/dev/null || true
		wait "${VISIBLE_PID}" 2>/dev/null || true
	fi

	if [[ -n "${SERVER_PID:-}" ]]
	then
		kill "${SERVER_PID}" 2>/dev/null || true
		wait "${SERVER_PID}" 2>/dev/null || true
	fi

	rm -f "$SERVER_LOG" "$DOM_DUMP"
}

trap cleanup EXIT

VSCODE_WEB_STATIC_E2E_PORT="$PORT" node "${ROOT_DIR}/tests/e2e/server.mjs" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30)
do
	if curl -fsS "http://127.0.0.1:${PORT}/editor/" >/dev/null 2>&1
	then
		break
	fi

	sleep 1
done

curl -fsS "http://127.0.0.1:${PORT}/editor/" >/dev/null

TEST_URL="http://127.0.0.1:${PORT}/editor/?itemUrl=https://override.item&serviceUrl=https://override.service&resourceUrlTemplate=https://override.resource/%7Bpath%7D"

if [[ "$E2E_VISIBLE" != 0 ]]
then
	VISIBLE_PROFILE_DIR="$(mktemp -d)"

	"$CHROMIUM_BIN" \
		--disable-gpu \
		--no-sandbox \
		--user-data-dir="$VISIBLE_PROFILE_DIR" \
		"$TEST_URL" \
		>/dev/null \
		2>/dev/null &

	VISIBLE_PID=$!
	sleep 1
fi

"$CHROMIUM_BIN" \
	--headless \
	--disable-gpu \
	--no-sandbox \
	--virtual-time-budget=3000 \
	--dump-dom \
	"$TEST_URL" \
	>"$DOM_DUMP" \
	2>/dev/null

node - "$DOM_DUMP" <<'EOF'
const fs = require('node:fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const match = html.match(/<script id="e2e-state" type="application\/json">([\s\S]*?)<\/script>/);

if (!match) {
  console.error('Missing e2e-state payload in DOM dump.');
  process.exit(1);
}

const details = JSON.parse(match[1]);

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

assert(details.editor && details.editor.kind === 'mock-editor', 'Expected mock editor to be exposed.');
assert(Array.isArray(details.commands) && details.commands.includes('ext-a-hack'), 'Expected ext-a hack command.');
assert(Array.isArray(details.commands) && !details.commands.includes('ext-skip-hack'), 'Skipped extension hack should not run.');
assert(details.gallery.itemUrl === 'https://override.item', 'Expected itemUrl override.');
assert(details.gallery.serviceUrl === 'https://override.service', 'Expected serviceUrl override.');
assert(details.gallery.resourceUrlTemplate === 'https://override.resource/{path}', 'Expected resourceUrlTemplate override.');
assert(details.requireBaseUrl === 'http://127.0.0.1:4173/editor/out', 'Expected require baseUrl to honor base path.');
assert(details.baseHref === '/editor/', 'Expected base href to preserve the configured directory for relative bundle URLs.');
assert(Array.isArray(details.extensionPaths) && details.extensionPaths.includes('ext-a'), 'Expected ext-a in built-in extension list.');
assert(Array.isArray(details.extensionPaths) && !details.extensionPaths.includes('ext-skip'), 'Skipped extension should not be listed.');
assert(details.packageNls && details.packageNls.displayName === 'Extension A', 'Expected ext-a package.nls metadata.');
assert(JSON.stringify(details.bootstrapStages) === '["nls","main","workbench"]', 'Expected production bundles to execute in dependency order.');
EOF

if [[ "$E2E_HOLD_SECONDS" != 0 ]]
then
	sleep "$E2E_HOLD_SECONDS"
fi
