#!/usr/bin/env bash
# Starts Prachaar locally: the containers, the database, the API and the web app.
#   ./run.sh           keep the data
#   ./run.sh --fresh   wipe the database first
# Stop everything with ./stop.sh. Logs are in .run/.
set -euo pipefail
cd "$(dirname "$0")"
API_PORT=${API_PORT:-8000}
WEB_PORT=${WEB_PORT:-3000}
COMPOSE="docker compose -f server/docker-compose.dev.yml"
mkdir -p .run

for port in $API_PORT $WEB_PORT; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is in use. Run ./stop.sh first." >&2
    exit 1
  fi
done

# On a Mac, Docker runs inside Colima.
if ! docker info >/dev/null 2>&1 && command -v colima >/dev/null; then colima start; fi
$COMPOSE up -d --wait

if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  echo "Created server/.env with the mock model, which costs nothing. Edit it to use a real model."
fi
[ -d server/node_modules ] || (cd server && pnpm install --frozen-lockfile)
[ -d web/node_modules ] || (cd web && pnpm install --frozen-lockfile)

if [ "${1:-}" = "--fresh" ]; then
  echo "Wiping the database..."
  $COMPOSE exec -T postgres psql -U marketing -d postgres -q \
    -c 'drop database if exists marketing with (force)' \
    -c 'drop database if exists marketing_dbos with (force)' \
    -c 'create database marketing'
fi

# The database is built from the committed migrations. One made by `pnpm db:reset` has no migration
# history, so migrating it fails: --fresh rebuilds it.
if ! (cd server && pnpm -s db:migrate && pnpm -s seed); then
  echo "The database could not be migrated. ./run.sh --fresh rebuilds it, and deletes its data." >&2
  exit 1
fi

# Job control gives each server its own process group, so stop.sh can end it with its children.
set -m
(cd server && PORT=$API_PORT exec nohup pnpm dev) > .run/api.log 2>&1 &
echo $! > .run/api.pid
(cd web && API_PORT=$API_PORT exec nohup pnpm dev -p "$WEB_PORT") > .run/web.log 2>&1 &
echo $! > .run/web.pid
set +m

wait_for() {
  for _ in $(seq 1 90); do
    curl -sf -o /dev/null --max-time 2 "$1" && return 0
    sleep 1
  done
  return 1
}
wait_for "http://127.0.0.1:$API_PORT/api/health" || { echo "The API did not start. See .run/api.log" >&2; exit 1; }
wait_for "http://127.0.0.1:$WEB_PORT/app/brands" || { echo "The web app did not start. See .run/web.log" >&2; exit 1; }

echo "Prachaar is running: http://127.0.0.1:$WEB_PORT/app"
echo "Model: $(grep '^AI_MODEL=' server/.env | cut -d= -f2-)"
echo "Logs: .run/api.log and .run/web.log. Stop with ./stop.sh"
