#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "${ROOT_DIR}/tests/lib.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

git init -q "$TMP_DIR/repo"
printf 'before\nafter\n' > "$TMP_DIR/repo/example"
cat > "$TMP_DIR/host.patch" <<'EOF'
diff --git a/example b/example
--- a/example
+++ b/example
@@ -1,2 +1,3 @@
 before
+host integration
 after
EOF

"$ROOT_DIR/scripts/apply-vscode-patches.sh" "$TMP_DIR/repo" "$TMP_DIR/host.patch"
assert_contains 'host integration' "$TMP_DIR/repo/example"

# An existing checkout can contain local edits beside a previously applied patch.
printf 'before\nhost integration\nuser change\n' > "$TMP_DIR/repo/example"
"$ROOT_DIR/scripts/apply-vscode-patches.sh" "$TMP_DIR/repo" "$TMP_DIR/host.patch"
assert_contains 'user change' "$TMP_DIR/repo/example"

printf 'conflicting content\n' > "$TMP_DIR/repo/example"
if "$ROOT_DIR/scripts/apply-vscode-patches.sh" "$TMP_DIR/repo" "$TMP_DIR/host.patch" 2>/dev/null
then
	fail 'An incompatible checkout must stop the build.'
fi
assert_contains 'conflicting content' "$TMP_DIR/repo/example"
