#!/usr/bin/env bash
# Checks that the TPT proxy answers and accepts the session token.
# Usage: TPT_TOKEN=<token> ./smoke-test.sh [port]
set -euo pipefail

port="${1:-7331}"
: "${TPT_TOKEN:?Set TPT_TOKEN to the session token (TPT: Copy Session Token)}"

status=$(curl -s -o /tmp/tpt-smoke.json -w '%{http_code}' \
  -H "X-TPT-Token: $TPT_TOKEN" \
  "http://127.0.0.1:$port/v1/models" || true)

echo "proxy answered HTTP $status"
case "$status" in
  200) echo "OK: the proxy is up and the upstream accepted the request." ;;
  401) echo "The token is wrong or stale. Copy it again with TPT: Copy Session Token." ;;
  000) echo "Nothing is listening on port $port. Check the TPT Output Channel for the port." ;;
  *)   echo "Upstream problem. Response:"; head -c 400 /tmp/tpt-smoke.json; echo ;;
esac
