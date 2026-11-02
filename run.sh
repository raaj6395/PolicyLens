#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

BACKEND_PORT=8080
FRONTEND_PORT=5173

free_port() {
  local pids
  pids=$(lsof -ti tcp:"$1" -sTCP:LISTEN || true)
  [ -z "$pids" ] && return
  echo "Port $1 in use by PID(s) $(echo $pids), stopping them"
  kill $pids 2>/dev/null || true
  sleep 1
  pids=$(lsof -ti tcp:"$1" -sTCP:LISTEN || true)
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
}

free_port "$BACKEND_PORT"
free_port "$FRONTEND_PORT"

if [ ! -d web/node_modules ]; then
  (cd web && npm_config_cache="${TMPDIR:-/tmp}/npm-cache" npm install)
fi
if [ ! -f web/dist/index.html ]; then
  (cd web && npm run build)
fi

echo "Building backend..."
go build -o bin/server ./cmd/server

BACK=""
FRONT=""
cleanup() {
  trap - INT TERM EXIT
  echo
  echo "Stopping..."
  kill $BACK $FRONT 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

PORT="$BACKEND_PORT" ./bin/server &
BACK=$!
(cd web && exec npx vite --port "$FRONTEND_PORT" --strictPort) &
FRONT=$!

echo
echo "Backend  (API + built UI): http://localhost:$BACKEND_PORT"
echo "Frontend (dev, hot reload): http://localhost:$FRONTEND_PORT"
echo "Press Ctrl+C to stop both."
wait
