#!/usr/bin/env bash
# Stands in for an asset manager's strategy system: sends new target weights to `hodl-agent listen`
# at a fixed interval, alternating 60/40 and 40/60.
# Usage: HODL_SIGNAL_SECRET=<secret> [PORT=8787] [INTERVAL_SECONDS=900] ./examples/signal-loop.sh
set -euo pipefail

: "${HODL_SIGNAL_SECRET:?Set HODL_SIGNAL_SECRET (the same value listen uses)}"
PORT="${PORT:-8787}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-900}"

signals=('{"weights":{"cbBTC":60,"WETH":40}}' '{"weights":{"cbBTC":40,"WETH":60}}')
i=0
while true; do
  body="${signals[$((i % 2))]}"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) sending $body"
  curl -sS -X POST "http://127.0.0.1:${PORT}/signal" \
    -H "content-type: application/json" \
    -H "x-signal-secret: ${HODL_SIGNAL_SECRET}" \
    -d "$body" -w "  -> HTTP %{http_code}\n" || echo "  -> listen is not reachable"
  i=$((i + 1))
  sleep "$INTERVAL_SECONDS"
done
