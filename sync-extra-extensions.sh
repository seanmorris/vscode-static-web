#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="${1:-${ROOT_DIR}/extra_extensions}"
DEST_DIR="${2:-${ROOT_DIR}/public/extensions}"
MANIFEST="${ROOT_DIR}/journal/.extra-extensions.list"

mkdir -p "$DEST_DIR" "$(dirname "$MANIFEST")"

shopt -s nullglob

current_names=()

for source_path in "${SOURCE_DIR}"/*
do
	[[ -d "$source_path" ]] || continue
	current_names+=("$(basename "$source_path")")
done

if [[ -f "$MANIFEST" ]]
then
	while IFS= read -r previous_name
	do
		[[ -n "$previous_name" ]] || continue
		if [[ ! -d "${SOURCE_DIR}/${previous_name}" ]]
		then
			rm -rf "${DEST_DIR}/${previous_name}"
		fi
	done < "$MANIFEST"
fi

for extension_name in "${current_names[@]}"
do
	rsync -a --delete \
		--delete-excluded \
		--exclude='.git/' \
		--exclude='node_modules/' \
		--exclude='src/' \
		--exclude='test/' \
		--exclude='tests/' \
		--exclude='.vscode/' \
		--exclude='.yarn/' \
		--exclude='.wrangler/' \
		--exclude='.gitignore' \
		--exclude='.babelrc' \
		--exclude='.eslintrc*' \
		--exclude='.prettierrc*' \
		--exclude='.vscodeignore' \
		--exclude='.yarnrc' \
		--exclude='package-lock.json' \
		--exclude='yarn.lock' \
		--exclude='pnpm-lock.yaml' \
		--exclude='tsconfig*.json' \
		--exclude='webpack.config.*' \
		--exclude='vsc-extension-quickstart.md' \
		--exclude='CHANGELOG.md' \
		--exclude='build-hack.mjs' \
		--exclude='hack-source.js' \
		"${SOURCE_DIR}/${extension_name}/" \
		"${DEST_DIR}/${extension_name}/"
done

: > "$MANIFEST"

for extension_name in "${current_names[@]}"
do
	printf '%s\n' "$extension_name" >> "$MANIFEST"
done
