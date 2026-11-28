#!/usr/bin/env bash
# Stops what ./run.sh started: the web app, the API and the containers.
# Data is kept; ./run.sh --fresh is what wipes it.
set -uo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
API_PORT=${API_PORT:-3141}
WEB_PORT=${WEB_PORT:-3140}

# Servers started by run.sh: each is its own process group, so one signal ends it with its children.
for name in web api; do
  f=.run/$name.pid
  [ -f "$f" ] || continue
  kill -TERM -- "-$(cat "$f")" 2>/dev/null && echo "Stopped the $name server"
  rm -f "$f"
done

# Servers started another way (pnpm dev in a terminal). Only a process running from this folder is touched;
# its node and pnpm parents go too, or `node --watch` would bring the server back on the next file change.
for port in $WEB_PORT $API_PORT; do
  for pid in $(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    case "$cwd" in
      "$ROOT"/*) ;;
      *) echo "Port $port is held by a process outside this project (pid $pid); left alone"; continue ;;
    esac
    while [ -n "$pid" ] && [ "$pid" != 1 ]; do
      case "$(ps -o command= -p "$pid" 2>/dev/null)" in
        *node*|*pnpm*|*next*) parent=$(ps -o ppid= -p "$pid" | tr -d ' '); kill -TERM "$pid" 2>/dev/null; pid=$parent ;;
        *) break ;;
      esac
    done
    echo "Stopped the server on port $port"
  done
done

if docker info >/dev/null 2>&1; then
  docker compose -f server/docker-compose.dev.yml stop >/dev/null 2>&1 && echo "Stopped the containers (data kept)"
fi
