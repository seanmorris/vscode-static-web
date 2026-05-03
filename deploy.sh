#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

required_commands=(aws envsubst make npx rsync)

for command in "${required_commands[@]}"
do
	if ! command -v "$command" >/dev/null 2>&1
	then
		echo "Missing required command: $command" >&2
		exit 1
	fi
done

if [[ ! -f .env ]]
then
	echo "Missing .env file." >&2
	exit 1
fi

. ./.env

: "${PROJECT_NAME:?Missing PROJECT_NAME in .env}"
: "${BUCKET_NAME:?Missing BUCKET_NAME in .env}"
: "${ENDPOINT:?Missing ENDPOINT in .env}"
: "${CLOUDFLARE_ACCOUNT_ID:?Missing CLOUDFLARE_ACCOUNT_ID in .env}"
: "${CLOUDFLARE_API_TOKEN:?Missing CLOUDFLARE_API_TOKEN in .env}"

SOURCE_DIR="${SOURCE_DIR:-public}"
PAGES_DIR="${PAGES_DIR:-pages}"
PAGES_BRANCH="${PAGES_BRANCH:-master}"
WRANGLER_VERSION="${WRANGLER_VERSION:-4.87.0}"
WRANGLER_CONFIG="${ROOT_DIR}/wrangler.toml"

if [[ ! -f "${ROOT_DIR}/.aws/credentials" || ! -f "${ROOT_DIR}/.aws/config" ]]
then
	echo "Missing AWS config under ${ROOT_DIR}/.aws/." >&2
	exit 1
fi

cleanup()
{
	rm -f "$WRANGLER_CONFIG"
}

trap cleanup EXIT

make all

if [[ ! -d "$SOURCE_DIR" ]]
then
	echo "Missing build output directory: $SOURCE_DIR" >&2
	exit 1
fi

if [[ ! -f "$SOURCE_DIR/index.html" ]]
then
	echo "Missing built index: $SOURCE_DIR/index.html" >&2
	exit 1
fi

if [[ ! -d "$PAGES_DIR" || ! -f "$PAGES_DIR/_worker.js" ]]
then
	echo "Missing Pages worker entry at $PAGES_DIR/_worker.js" >&2
	exit 1
fi

mapfile -t broken_links < <(find "./${SOURCE_DIR%/}" -type l ! -exec test -e {} \; -print)

if (( ${#broken_links[@]} > 0 ))
then
	printf 'Removing broken symlinks before upload:\n' >&2
	printf '  %s\n' "${broken_links[@]}" >&2
	find "./${SOURCE_DIR%/}" -type l ! -exec test -e {} \; -delete
fi

if find "./${SOURCE_DIR%/}" -type l ! -exec test -e {} \; -print -quit | grep -q .
then
	echo "Broken symlinks remain under ${SOURCE_DIR} after cleanup." >&2
	exit 1
fi

PROJECT_NAME="$PROJECT_NAME" \
BUCKET_NAME="$BUCKET_NAME" \
envsubst < wrangler.template.toml > "$WRANGLER_CONFIG"

export AWS_SHARED_CREDENTIALS_FILE="${ROOT_DIR}/.aws/credentials"
export AWS_CONFIG_FILE="${ROOT_DIR}/.aws/config"
export CLOUDFLARE_ACCOUNT_ID
export CLOUDFLARE_API_TOKEN

aws s3 sync "./${SOURCE_DIR%/}" "s3://${BUCKET_NAME}" \
	--endpoint-url="${ENDPOINT}" \
	--exact-timestamps \
	--profile r2 \
	--delete

npx -y "wrangler@${WRANGLER_VERSION}" pages deploy "./${PAGES_DIR%/}" \
	--project-name="${PROJECT_NAME}" \
	--branch="${PAGES_BRANCH}"
