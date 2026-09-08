#!/usr/bin/env bash
set -euo pipefail
set -o pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT_DIR}/deploy-remote.sh"
TMP_DIR="$(mktemp -d)"
trap 'find "$TMP_DIR" -type f -exec unlink {} \; ; rmdir "$TMP_DIR"' EXIT

run_case() {
  local name="$1"
  local fake_ssh="$2"
  local expected_sha="$3"
  local expected_exit="$4"

  set +e
  output="$(VPS_HOST=testhost \
    GITHUB_SHA="$expected_sha" \
    MCAT_DEPLOY_SSH_BIN="$fake_ssh" \
    MCAT_DEPLOY_RETRY_SLEEP_SECONDS=0 \
    MCAT_SKIP_HEALTH_CHECK=1 \
    bash "$SCRIPT" 2>&1)"
  status=$?
  set -e

  if [ "$status" -ne "$expected_exit" ]; then
    echo "FAIL: $name (expected $expected_exit, got $status)"
    echo "$output"
    return 1
  fi

  echo "PASS: $name"
  return 0
}

cat > "$TMP_DIR/fake_transport.sh" <<'EOF'
#!/usr/bin/env bash
exit 255
EOF
chmod +x "$TMP_DIR/fake_transport.sh"

cat > "$TMP_DIR/fake_deploy_error.sh" <<'EOF'
#!/usr/bin/env bash
echo "deploy failed" >&2
exit 1
EOF
chmod +x "$TMP_DIR/fake_deploy_error.sh"

cat > "$TMP_DIR/fake_success.sh" <<'EOF'
#!/usr/bin/env bash
echo "== deployed 01d2e70 by root at 2026-09-08T01:11:15Z"
exit 0
EOF
chmod +x "$TMP_DIR/fake_success.sh"

cat > "$TMP_DIR/fake_mismatch.sh" <<'EOF'
#!/usr/bin/env bash
echo "== deployed 01d2e70 by root at 2026-09-08T01:11:15Z"
exit 0
EOF
chmod +x "$TMP_DIR/fake_mismatch.sh"

cat > "$TMP_DIR/fake_short_fail.sh" <<'EOF'
#!/usr/bin/env bash
echo "== deployed deadbe by root at 2026-09-08T01:11:15Z"
exit 0
EOF
chmod +x "$TMP_DIR/fake_short_fail.sh"

run_case "transport failures x3" "$TMP_DIR/fake_transport.sh" "cafebabe" 255
run_case "deploy error rc=1" "$TMP_DIR/fake_deploy_error.sh" "cafebabe" 1
run_case "short-vs-full sha match" "$TMP_DIR/fake_success.sh" "01d2e70aa11bb22cc33dd44ee55ff6677889900ab" 0
run_case "short-vs-full sha mismatch" "$TMP_DIR/fake_mismatch.sh" "f00dbabe11bb22cc33dd44ee55ff6677889900ab" 1
run_case "short sha too short" "$TMP_DIR/fake_short_fail.sh" "deadbeef" 1

run_health_case() {
  local name="$1" code="$2" expected_exit="$3"
  printf '#!/usr/bin/env bash\nprintf "%%s" "%s"\n' "$code" > "$TMP_DIR/fake_curl_$code.sh"
  chmod +x "$TMP_DIR/fake_curl_$code.sh"
  set +e
  output="$(VPS_HOST=testhost \
    GITHUB_SHA="01d2e70aa11bb22cc33dd44ee55ff6677889900ab" \
    MCAT_DEPLOY_SSH_BIN="$TMP_DIR/fake_success.sh" \
    MCAT_DEPLOY_CURL_BIN="$TMP_DIR/fake_curl_$code.sh" \
    MCAT_DEPLOY_RETRY_SLEEP_SECONDS=0 \
    bash "$SCRIPT" 2>&1)"
  status=$?
  set -e
  if [ "$status" -ne "$expected_exit" ]; then
    echo "FAIL: $name (expected $expected_exit, got $status)"; echo "$output"; return 1
  fi
  echo "PASS: $name"
}
run_health_case "health check 401 accepted" 401 0
run_health_case "health check 403 (Cloudflare) accepted" 403 0
run_health_case "health check 200 rejected" 200 1

echo "All deploy-remote tests passed"
