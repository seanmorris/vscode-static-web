#!/usr/bin/env bash

set -euo pipefail

VSCODE_DIR="$1"
shift

for patch_file in "$@"
do
	patch_file="$(realpath "$patch_file")"

	if git -C "$VSCODE_DIR" apply --check "$patch_file" 2>/dev/null
	then
		git -C "$VSCODE_DIR" apply "$patch_file"
	# Verify inserted/deleted lines while allowing unrelated edits to nearby context.
	elif ! git -C "$VSCODE_DIR" apply --reverse -C0 --check "$patch_file" 2>/dev/null
	then
		printf 'Cannot apply VS Code patch or verify it is already applied: %s\n' "$patch_file" >&2
		exit 1
	fi
done
