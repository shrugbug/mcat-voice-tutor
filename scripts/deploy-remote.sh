#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="${VPS_HOST:-vps}"
SSH_BIN="${MCAT_DEPLOY_SSH_BIN:-ssh}"
CURL_BIN="${MCAT_DEPLOY_CURL_BIN:-curl}"
SSH_KEY_PATH="${MCAT_DEPLOY_SSH_KEY_PATH:-$HOME/.ssh/deploy_key}"
KNOWN_HOSTS_PATH="${MCAT_DEPLOY_KNOWN_HOSTS_PATH:-$HOME/.ssh/known_hosts}"
PUBLIC_URL="${MCAT_PUBLIC_URL:-https://mcat.illinihunt.org}"
RETRY_SLEEP="${MCAT_DEPLOY_RETRY_SLEEP_SECONDS:-20}"

run_remote() {
  "$SSH_BIN" \
    -i "$SSH_KEY_PATH" \
    -o IdentitiesOnly=yes \
    -o ConnectTimeout=30 \
    -o UserKnownHostsFile="$KNOWN_HOSTS_PATH" \
    "$@"
}

if [ -n "${VPS_SSH_KEY:-}" ]; then
  install -d -m 700 "$HOME/.ssh"
  printf '%s\n' "$VPS_SSH_KEY" > "$SSH_KEY_PATH"
  chmod 600 "$SSH_KEY_PATH"
fi

if [ -n "${VPS_KNOWN_HOSTS:-}" ]; then
  install -d -m 700 "$HOME/.ssh"
  printf '%s\n' "$VPS_KNOWN_HOSTS" > "$KNOWN_HOSTS_PATH"
  chmod 600 "$KNOWN_HOSTS_PATH"
fi

deploy_output=""
deploy_exit=0
for attempt in 1 2 3; do
  set +e
  deploy_output="$(run_remote "deployer@$VPS_HOST" deploy 2>&1)"
  deploy_exit=$?
  set -e

  if [ "$deploy_exit" -eq 0 ]; then
    break
  fi

  if [ "$deploy_exit" -ne 255 ]; then
    echo "ERROR: mcat-deploy returned exit code $deploy_exit" >&2
    echo "$deploy_output" >&2
    exit "$deploy_exit"
  fi

  if [ "$attempt" -lt 3 ]; then
    echo "ssh attempt $attempt failed (rc=$deploy_exit), retrying in ${RETRY_SLEEP}s"
    sleep "$RETRY_SLEEP"
  else
    exit 255
  fi
done

if [ "$deploy_exit" -ne 0 ]; then
  echo "ERROR: deploy never succeeded after retries" >&2
  exit 255
fi

deployed_sha="$(printf '%s\n' "$deploy_output" | sed -n 's/^== deployed \([0-9a-f]\{7,\}\) .*$/\1/p')"
if [ -z "$deployed_sha" ]; then
  echo "ERROR: could not parse deployed SHA from output" >&2
  exit 1
fi

if [ "${#deployed_sha}" -lt 7 ]; then
  echo "ERROR: deployed SHA ${deployed_sha} is shorter than 7 hex chars" >&2
  exit 1
fi

if ! [[ "${GITHUB_SHA:-}" == "$deployed_sha"* ]]; then
  echo "ERROR: deployed SHA $deployed_sha is not a prefix of github SHA ${GITHUB_SHA:-}" >&2
  exit 1
fi

if [ "${MCAT_SKIP_HEALTH_CHECK:-0}" != "1" ]; then
  auth_code="$($CURL_BIN -s -o /tmp/mcat-deploy-verify-body -w '%{http_code}' "$PUBLIC_URL")"
  if [ "$auth_code" != "401" ]; then
    echo "ERROR: expected 401 from $PUBLIC_URL, got $auth_code" >&2
    exit 1
  fi
fi

echo "Remote deploy verification succeeded"
