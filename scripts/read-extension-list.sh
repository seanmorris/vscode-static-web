#!/usr/bin/env bash

set -euo pipefail

LIST_FILE="${1:-}"

if [[ -z "$LIST_FILE" ]]
then
	printf 'Usage: %s LIST_FILE\n' "$0" >&2
	exit 1
fi

if [[ ! -f "$LIST_FILE" ]]
then
	printf 'Missing extension list file: %s\n' "$LIST_FILE" >&2
	exit 1
fi

mapfile -t entries < <(
	sed \
		-e 's/#.*$//' \
		-e 's/^[[:space:]]*//' \
		-e 's/[[:space:]]*$//' \
		"$LIST_FILE" \
	| awk 'NF'
)

printf '%s' "${entries[*]-}"
