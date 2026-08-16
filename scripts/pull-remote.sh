#!/usr/bin/env bash
# Pulls both production databases from the VPS for offline tuning.
#
# Both remote dbs are journal_mode=wal. A plain rsync of a live .db can copy a torn page set or
# miss commits still sitting in the -wal, so each is snapshotted server-side with SQLite's online
# backup API first, then transferred.
set -euo pipefail

HOST="${MCAT_VPS_HOST:-vps}"
APP_DIR="/root/repos/mcat"
DEST="data/remote"
REMOTE_TMP=""

mkdir -p "$DEST"

cleanup_remote() {
  local status=$?
  trap - EXIT
  if [ -n "$REMOTE_TMP" ]; then
    if ! ssh "$HOST" "rm -f -- ${REMOTE_TMP}"; then
      echo "WARNING: could not remove remote snapshot ${HOST}:${REMOTE_TMP} - it may still contain real student data. Remove it manually." >&2
    fi
  fi
  exit "$status"
}

trap cleanup_remote EXIT

pull_one() {
  local remote_name="$1" local_name="$2" remote_tmp

  echo "Pulling ${remote_name} -> ${DEST}/${local_name}"
  remote_tmp=$(ssh "$HOST" "mktemp /tmp/mcat-pull-XXXXXX.db")
  if [[ ! "$remote_tmp" =~ ^/tmp/mcat-pull-[[:alnum:]]+\.db$ ]]; then
    echo "ERROR: remote mktemp returned an unexpected path." >&2
    exit 1
  fi
  REMOTE_TMP="$remote_tmp"

  ssh "$HOST" "cd ${APP_DIR} && sqlite3 data/${remote_name} \".backup '${REMOTE_TMP}'\""
  rsync -q "${HOST}:${REMOTE_TMP}" "${DEST}/${local_name}"
  ssh "$HOST" "rm -f -- ${REMOTE_TMP}"
  REMOTE_TMP=""
}

pull_one "mcat.db" "prod.db"
pull_one "demo.db" "demo.db"

for f in prod demo; do
  count=$(sqlite3 "${DEST}/${f}.db" "SELECT COUNT(*) FROM categories")
  echo "  ${f}.db: ${count} categories"
  if [ "$count" -eq 0 ]; then
    echo "ERROR: ${f}.db has no categories -- refusing a snapshot that would tune on nothing." >&2
    exit 1
  fi
done

echo "Pull complete."
