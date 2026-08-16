#!/usr/bin/env bash
set -euo pipefail

# This script asks for both Sentry tokens privately on your local terminal,
# then transmits them as encrypted SSH input (never as command-line arguments).
# Do not put the token values in this file or paste them into chat.

VPS_HOST="${VPS_HOST:-vps}"
SENTRY_ORG="${SENTRY_ORG:-university-of-illinois-at-u-5y}"
SENTRY_PROJECT="${SENTRY_PROJECT:-mcat-javascript-nextjs}"

read -r -s -p "Sentry organization org:ci token: " SENTRY_CI_TOKEN
printf '\n'
read -r -s -p "Sentry personal event:read token: " SENTRY_READ_TOKEN
printf '\n'

if [[ -z "$SENTRY_CI_TOKEN" || -z "$SENTRY_READ_TOKEN" ]]; then
  printf '%s\n' "Both tokens are required. Nothing was changed."
  exit 1
fi

ssh "$VPS_HOST" 'cat > /tmp/mcat-sentry-token-setup.sh' <<'REMOTE_SCRIPT'
set -euo pipefail
umask 077

trap 'rm -f /tmp/mcat-sentry-token-setup.sh' EXIT

read -r ci_token
read -r read_token

if [[ -z "$ci_token" || -z "$read_token" ]]; then
  printf '%s\n' "Both tokens are required. Nothing was changed." >&2
  exit 1
fi

cd /root/repos/mcat
backup="/root/repos/mcat/data/backups/env-sentry-tokens-$(date +%Y%m%dT%H%M%SZ)"
mkdir -p /root/repos/mcat/data/backups
cp .env "$backup"

append_if_missing() {
  key="$1"
  value="$2"
  if ! grep -q "^${key}=" .env; then
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

# The nightly issue reader uses SENTRY_AUTH_TOKEN.
append_if_missing SENTRY_AUTH_TOKEN "$read_token"

# The org:ci token is kept separate for the Next.js source-map/release build hook.
append_if_missing SENTRY_CI_TOKEN "$ci_token"
append_if_missing SENTRY_ORG "$SENTRY_ORG"
append_if_missing SENTRY_PROJECT "$SENTRY_PROJECT"

chmod 600 .env
printf 'backup=%s\n' "$backup"
printf 'configured=SENTRY_AUTH_TOKEN,SENTRY_CI_TOKEN,SENTRY_ORG,SENTRY_PROJECT\n'
REMOTE_SCRIPT

ssh_command="SENTRY_ORG=$(printf '%q' "$SENTRY_ORG") SENTRY_PROJECT=$(printf '%q' "$SENTRY_PROJECT") bash /tmp/mcat-sentry-token-setup.sh"
printf '%s\n%s\n' "$SENTRY_CI_TOKEN" "$SENTRY_READ_TOKEN" | ssh "$VPS_HOST" "$ssh_command"

unset SENTRY_CI_TOKEN SENTRY_READ_TOKEN

printf '%s\n' "Tokens were stored on the VPS. No token values were printed."
