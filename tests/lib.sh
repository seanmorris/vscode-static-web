#!/usr/bin/env bash

set -euo pipefail

fail()
{
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

assert_exists()
{
	local path="$1"
	[[ -e "$path" ]] || fail "Expected path to exist: $path"
}

assert_not_exists()
{
	local path="$1"
	[[ ! -e "$path" ]] || fail "Expected path to be absent: $path"
}

assert_contains()
{
	local needle="$1"
	local file="$2"

	grep -Fq -- "$needle" "$file" || fail "Expected to find [$needle] in $file"
}

assert_not_contains()
{
	local needle="$1"
	local file="$2"

	if grep -Fq -- "$needle" "$file"
	then
		fail "Did not expect to find [$needle] in $file"
	fi
}
