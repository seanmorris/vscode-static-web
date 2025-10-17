#!/bin/bash

set -euxo pipefail

. .env

PROJECT_NAME=${PROJECT_NAME} \
BUCKET_NAME=${BUCKET_NAME} \
envsubst < wrangler.template.toml > wrangler.toml

PREFIX="s3://$ENDPOINT/"

export AWS_SHARED_CREDENTIALS_FILE="$(dirname "$0")/.aws/credentials"
export AWS_CONFIG_FILE="$(dirname "$0")/.aws/config"

aws s3 sync ./public s3://${BUCKET_NAME} \
    --endpoint-url="${ENDPOINT}" \
    --exact-timestamps \
    --profile r2 \
    --delete

npx wrangler pages deploy ./pages \
    --project-name=${PROJECT_NAME} \
    --branch=master

rm wrangler.toml
