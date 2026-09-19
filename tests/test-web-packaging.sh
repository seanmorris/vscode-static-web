#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "${ROOT_DIR}/tests/lib.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cp "$ROOT_DIR/Makefile" "$ROOT_DIR/sync-extra-extensions.sh" "$TMP_DIR/"
cp -a "$ROOT_DIR/source" "$ROOT_DIR/scripts" "$ROOT_DIR/patch" "$TMP_DIR/"
mkdir -p "$TMP_DIR/journal" "$TMP_DIR/extra_extensions/file-bus" \
	"$TMP_DIR/third_party/vscode/out" "$TMP_DIR/third_party/vscode-web/out" \
	"$TMP_DIR/third_party/vscode-web/extensions/ext-a"

printf 'development output\n' > "$TMP_DIR/third_party/vscode/out/development.js"
printf 'production bundle\n' > "$TMP_DIR/third_party/vscode-web/out/bundle.js"
printf '{"name":"ext-a","publisher":"test","version":"1.0.0"}\n' \
	> "$TMP_DIR/third_party/vscode-web/extensions/ext-a/package.json"
printf '{"name":"file-bus","publisher":"test","version":"1.0.0"}\n' \
	> "$TMP_DIR/extra_extensions/file-bus/package.json"
touch "$TMP_DIR/third_party/vscode/.gitignore"
touch "$TMP_DIR/journal/.pull-dependencies" "$TMP_DIR/journal/.patched" "$TMP_DIR/journal/.compiled-web"

run_make()
{
	if ! make -s -C "$TMP_DIR" "$@" > "$TMP_DIR/make.log" 2>&1
	then
		cat "$TMP_DIR/make.log" >&2
		fail 'Fixture build failed.'
	fi
}

run_make all VSCODE_SKIP_EXTENSIONS=ext-a
assert_contains 'production bundle' "$TMP_DIR/public/out/bundle.js"
assert_not_exists "$TMP_DIR/public/out/development.js"
assert_not_exists "$TMP_DIR/public/extensions/ext-a"
assert_exists "$TMP_DIR/public/extensions/file-bus/package.json"
assert_not_contains '&quot;extensionPath&quot;:&quot;ext-a&quot;' "$TMP_DIR/public/index.html"

# Changing the skip list must restore packaged extensions without a core rebuild.
run_make all VSCODE_SKIP_EXTENSIONS=
assert_exists "$TMP_DIR/public/extensions/ext-a/package.json"
assert_contains '&quot;extensionPath&quot;:&quot;ext-a&quot;' "$TMP_DIR/public/index.html"

# A failed production task must not leave a successful build stamp.
cat > "$TMP_DIR/failing-yarn" <<'EOF'
#!/usr/bin/env bash
exit 17
EOF
chmod +x "$TMP_DIR/failing-yarn"
rm "$TMP_DIR/journal/.compiled-web"
if make -s -C "$TMP_DIR" journal/.compiled-web YARN="$TMP_DIR/failing-yarn" > "$TMP_DIR/failure.log" 2>&1
then
	fail 'Expected a failing production build to stop Make.'
fi
assert_not_exists "$TMP_DIR/journal/.compiled-web"
