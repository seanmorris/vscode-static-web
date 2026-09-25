#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${VSCODE_WEB_STATIC_E2E_PORT:-4173}"
CHROMIUM_BIN="${PLAYWRIGHT_CHROMIUM_PATH:-/usr/bin/chromium}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
E2E_VISIBLE="${E2E_VISIBLE:-0}"
E2E_KEEP_OPEN="${E2E_KEEP_OPEN:-0}"
SERVER_LOG="$(mktemp)"
CHROME_LOG="$(mktemp)"
PROFILE_DIR="$(mktemp -d)"

if [[ "$E2E_VISIBLE" != 0 && -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]
then
	echo "E2E_VISIBLE=1 requires DISPLAY or WAYLAND_DISPLAY." >&2
	exit 1
fi

cleanup()
{
	if [[ -n "${CHROME_PID:-}" ]]
	then
		kill -- "-${CHROME_PID}" 2>/dev/null || kill "${CHROME_PID}" 2>/dev/null || true
		for _ in $(seq 1 20)
		do
			if ! kill -0 "${CHROME_PID}" 2>/dev/null
			then
				break
			fi

			sleep 0.25
		done
		kill -KILL -- "-${CHROME_PID}" 2>/dev/null || kill -KILL "${CHROME_PID}" 2>/dev/null || true
		wait "${CHROME_PID}" 2>/dev/null || true
	fi

	if [[ -n "${SERVER_PID:-}" ]]
	then
		kill "${SERVER_PID}" 2>/dev/null || true
		wait "${SERVER_PID}" 2>/dev/null || true
	fi

	for _ in $(seq 1 20)
	do
		if rm -rf "$PROFILE_DIR" 2>/dev/null
		then
			break
		fi

		sleep 0.25
	done

	if [[ -e "$PROFILE_DIR" ]]
	then
		rm -rf "$PROFILE_DIR"
	fi

	rm -f "$SERVER_LOG" "$CHROME_LOG"
}

trap cleanup EXIT

cd "$ROOT_DIR"
if [[ -z "${E2E_URL:-}" ]]
then
	make all >/dev/null

	cd "${ROOT_DIR}/public"
	"$PYTHON_BIN" -m http.server "$PORT" --bind 127.0.0.1 >"$SERVER_LOG" 2>&1 &
	SERVER_PID=$!

	for _ in $(seq 1 60)
	do
		if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1
		then
			break
		fi

		sleep 1
	done

	curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null

	TEST_URL="http://127.0.0.1:${PORT}/"
else
	TEST_URL="$E2E_URL"
fi
CHROME_ARGS=(
	--disable-gpu
	--no-sandbox
	--remote-debugging-port=0
	--remote-allow-origins=*
	--user-data-dir="$PROFILE_DIR"
	--no-first-run
	--no-default-browser-check
)

if [[ "$E2E_VISIBLE" == 0 ]]
then
	CHROME_ARGS+=(--headless)
fi

setsid "$CHROMIUM_BIN" "${CHROME_ARGS[@]}" "$TEST_URL" > /dev/null 2>"$CHROME_LOG" &
CHROME_PID=$!

DEVTOOLS_FILE="${PROFILE_DIR}/DevToolsActivePort"

for _ in $(seq 1 60)
do
	if [[ -s "$DEVTOOLS_FILE" ]]
	then
		break
	fi

	sleep 1
done

if [[ ! -s "$DEVTOOLS_FILE" ]]
then
	cat "$CHROME_LOG" >&2 || true
	echo "Chromium did not expose a DevTools port." >&2
	exit 1
fi

CDP_PORT="$(head -n 1 "$DEVTOOLS_FILE")"

node "${ROOT_DIR}/tests/real-e2e/check-real-site.mjs" "$CDP_PORT" "$TEST_URL" 60000

if [[ "$E2E_VISIBLE" != 0 && "$E2E_KEEP_OPEN" != 0 ]]
then
	printf 'Workbench booted. Press Enter to close the browser and exit.\n'
	read -r _
fi
