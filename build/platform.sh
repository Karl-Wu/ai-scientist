#!/usr/bin/env bash
# Start, stop, restart, or inspect the packaged AI Scientist platform.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$ROOT/platform.env"
MARKER="$ROOT/.platform-installed"

usage() {
  cat <<'EOF'
Usage:
  platform.sh start     Prepare offline runtime and start services
  platform.sh stop      Stop both services
  platform.sh restart   Stop, then start
  platform.sh status    Show process and health status
  platform.sh logs      Tail backend and frontend logs

Ports and hosts are read from platform.env. Defaults:
  KADY_PORT=8000 (private backend)
  KADY_FRONTEND_PORT=3000 (public frontend)
Set KADY_HTTPS_PORT for an additional HTTPS frontend listener.
The public UI origin derived from KADY_PUBLIC_HOST and
KADY_FRONTEND_PORT is allowed unless KADY_ALLOWED_ORIGINS is set explicitly.
EOF
}

load_config() {
  KADY_PORT="${KADY_PORT:-8000}"
  KADY_HOST="${KADY_HOST:-127.0.0.1}"
  KADY_FRONTEND_HOST="${KADY_FRONTEND_HOST:-0.0.0.0}"
  KADY_HTTPS_PORT="${KADY_HTTPS_PORT:-}"
  KADY_HTTPS_HOST="${KADY_HTTPS_HOST:-0.0.0.0}"
  KADY_PUBLIC_HOST="${KADY_PUBLIC_HOST:-}"
  KADY_ALLOWED_ORIGINS="${KADY_ALLOWED_ORIGINS:-}"
  KADY_OFFLINE="${KADY_OFFLINE:-0}"
  KADY_PREPARE_SANDBOXES="${KADY_PREPARE_SANDBOXES:-1}"
  KADY_REQUIRE_AUTH="${KADY_REQUIRE_AUTH:-0}"
  ADE_HOME="${ADE_HOME:-}"
  ADE_PROJECT="${ADE_PROJECT:-}"

  if [[ -f "$CONFIG" ]]; then
    set -a
    # Operator-owned configuration in the deployment directory.
    # shellcheck disable=SC1090
    . "$CONFIG"
    set +a
  fi

  KADY_PORT="${KADY_PORT:-8000}"
  KADY_HOST="${KADY_HOST:-127.0.0.1}"
  KADY_FRONTEND_PORT="${KADY_FRONTEND_PORT:-3000}"
  KADY_FRONTEND_HOST="${KADY_FRONTEND_HOST:-0.0.0.0}"
  KADY_HTTPS_PORT="${KADY_HTTPS_PORT:-}"
  KADY_HTTPS_HOST="${KADY_HTTPS_HOST:-0.0.0.0}"
  KADY_PUBLIC_HOST="${KADY_PUBLIC_HOST:-$KADY_FRONTEND_HOST}"
  KADY_ALLOWED_ORIGINS="${KADY_ALLOWED_ORIGINS:-}"
  KADY_OFFLINE="${KADY_OFFLINE:-0}"
  KADY_PREPARE_SANDBOXES="${KADY_PREPARE_SANDBOXES:-1}"
  KADY_REQUIRE_AUTH="${KADY_REQUIRE_AUTH:-0}"
  ADE_HOME="${ADE_HOME:-$ROOT/ade}"
  ADE_PROJECT="${ADE_PROJECT:-$ADE_HOME/workspace}"

  local pair name value
  for pair in "KADY_PORT=$KADY_PORT" "KADY_FRONTEND_PORT=$KADY_FRONTEND_PORT"; do
    name="${pair%%=*}"
    value="${pair#*=}"
    if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
      echo "Invalid ${name}=${value}; expected 1-65535" >&2
      exit 2
    fi
  done
  if [[ "$KADY_PORT" == "$KADY_FRONTEND_PORT" ]]; then
    echo "KADY_PORT and KADY_FRONTEND_PORT must differ" >&2
    exit 2
  fi

  if [[ -n "$KADY_HTTPS_PORT" ]]; then
    if [[ ! "$KADY_HTTPS_PORT" =~ ^[0-9]+$ ]] || (( KADY_HTTPS_PORT < 1 || KADY_HTTPS_PORT > 65535 )); then
      echo "Invalid KADY_HTTPS_PORT=${KADY_HTTPS_PORT}; expected 1-65535" >&2
      exit 2
    fi
    if [[ "$KADY_HTTPS_PORT" == "$KADY_PORT" || "$KADY_HTTPS_PORT" == "$KADY_FRONTEND_PORT" ]]; then
      echo "KADY_HTTPS_PORT must differ from KADY_PORT and KADY_FRONTEND_PORT" >&2
      exit 2
    fi
  fi

  if [[ -z "$KADY_ALLOWED_ORIGINS" ]]; then
    local public_origin_host="$KADY_PUBLIC_HOST"
    if [[ "$public_origin_host" == "0.0.0.0" || "$public_origin_host" == "::" ]]; then
      public_origin_host="127.0.0.1"
    fi
    KADY_ALLOWED_ORIGINS="http://${public_origin_host}:${KADY_FRONTEND_PORT}"
  fi
}

configure_ade() {
  ADE_HOME="${ADE_HOME:-$ROOT/ade}"
  ADE_PROJECT="${ADE_PROJECT:-$ADE_HOME/workspace}"
  ADE_BIN="${ADE_BIN:-$ADE_HOME/bin/ade}"
  ADE_SKILLS_DIR="${ADE_SKILLS_DIR:-$ADE_HOME/skills}"

  if [[ ! -x "$ADE_BIN" ]]; then
    echo "ADE runtime is unavailable at $ADE_HOME; ADE skills/commands are disabled" >&2
    return 0
  fi

  if [[ -f "$ADE_HOME/runtime.json" ]]; then
    ADE_MALLOY_HOME="${ADE_MALLOY_HOME:-$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["ADE_MALLOY_HOME"])' "$ADE_HOME/runtime.json")}"
    ADE_NODE_BINARY="${ADE_NODE_BINARY:-$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["ADE_NODE_BINARY"])' "$ADE_HOME/runtime.json")}"
    ADE_PYTHON="${ADE_PYTHON:-$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["python"])' "$ADE_HOME/runtime.json")}"
    ADE_VERSION="${ADE_VERSION:-$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["ade_version"])' "$ADE_HOME/runtime.json")}"
  else
    ADE_MALLOY_HOME="${ADE_MALLOY_HOME:-$ADE_HOME/compiler}"
    ADE_NODE_BINARY="${ADE_NODE_BINARY:-$(command -v node || true)}"
    ADE_PYTHON="${ADE_PYTHON:-$(command -v python3 || true)}"
    ADE_VERSION="${ADE_VERSION:-unknown}"
  fi
  ADE_BOOTSTRAP="${ADE_BOOTSTRAP:-$ADE_HOME/bin/ade-bootstrap}"
  export ADE_HOME ADE_PROJECT ADE_BIN ADE_SKILLS_DIR ADE_MALLOY_HOME ADE_NODE_BINARY ADE_PYTHON ADE_BOOTSTRAP ADE_VERSION
}

install_ade_skills() {
  local source skill destination skills_dir
  [[ -d "$ADE_SKILLS_DIR" ]] || return 0
  while IFS= read -r -d '' skills_dir; do
    for source in "$ADE_SKILLS_DIR"/ade-*; do
      [[ -d "$source" && -f "$source/SKILL.md" ]] || continue
      destination="$skills_dir/$(basename "$source")"
      if [[ ! -e "$destination" ]]; then
        cp -a "$source" "$destination"
      fi
    done
  done < <(find "$ROOT/projects" -path '*/sandbox/.pi/skills' -type d -print0 2>/dev/null)
}

prepare_runtime() {
  local node="$ROOT/platform/node/bin/node"
  local uv="$ROOT/platform/bin/uv"
  local wheelhouse="$ROOT/platform/wheelhouse"
  local requirements="$ROOT/platform/helper-requirements.txt"
  local sandbox_requirements="$ROOT/platform/sandbox-requirements.txt"

  [[ -x "$node" ]] || { echo "Bundled Node runtime is missing" >&2; exit 3; }
  [[ -d "$ROOT/server/node_modules" ]] || { echo "server dependencies are missing" >&2; exit 3; }
  [[ -d "$ROOT/web/node_modules" ]] || { echo "web dependencies are missing" >&2; exit 3; }

  configure_ade
  install_ade_skills

  mkdir -p "$ROOT/projects" "$ROOT/logs" "$ROOT/run" "$ROOT/platform/uv-cache"
  if [[ ! -f "$CONFIG" ]]; then
    cp "$ROOT/platform.env.example" "$CONFIG"
  fi

  if [[ -n "$KADY_HTTPS_PORT" ]]; then
    KADY_TLS_KEY="${KADY_TLS_KEY:-$ROOT/platform/tls/key.pem}"
    KADY_TLS_CERT="${KADY_TLS_CERT:-$ROOT/platform/tls/cert.pem}"
    if [[ ! -s "$KADY_TLS_KEY" || ! -s "$KADY_TLS_CERT" ]]; then
      echo "Generating self-signed frontend certificate..."
      mkdir -p "$ROOT/platform/tls"
      local tls_name="$KADY_PUBLIC_HOST"
      if [[ "$tls_name" == "0.0.0.0" || "$tls_name" == "::" ]]; then
        tls_name="127.0.0.1"
      fi
      if [[ "$tls_name" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        tls_san="IP:$tls_name"
      else
        tls_san="DNS:$tls_name"
      fi
      openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 \
        -keyout "$KADY_TLS_KEY" -out "$KADY_TLS_CERT" \
        -subj "/CN=$tls_name" -addext "subjectAltName=$tls_san" >/dev/null 2>&1
      chmod 600 "$KADY_TLS_KEY"
    fi
  fi

  if [[ ! -f "$MARKER" ]]; then
    if [[ -x "$uv" && -f "$requirements" && -d "$wheelhouse" && -n "$(ls -A "$wheelhouse" 2>/dev/null || true)" ]]; then
      echo "Preparing offline Python helper environment..."
      local python_bin
      python_bin="$(command -v python3 || true)"
      [[ -n "$python_bin" ]] || { echo "python3 is required" >&2; exit 3; }
      if ! "$python_bin" -c 'import sys; sys.exit(sys.version_info < (3, 12))'; then
        echo "Python 3.12 or newer is required for offline preview helpers" >&2
        exit 3
      fi
      (
        cd "$ROOT/server/src/helpers"
        UV_PYTHON_DOWNLOADS=never "$uv" venv --clear .venv --python "$python_bin"
        UV_OFFLINE=1 UV_NO_INDEX=1 UV_CACHE_DIR="$ROOT/platform/uv-cache" \
          "$uv" pip install --python .venv/bin/python \
          --offline --no-index --find-links "$wheelhouse" \
          -r "$requirements"
      ) || {
        echo "Python preview helpers could not be prepared; previews will degrade" >&2
        rm -rf "$ROOT/server/src/helpers/.venv"
      }
    else
      echo "No offline Python wheelhouse found; preview helpers will degrade" >&2
    fi

    if [[ -d "$ROOT/platform/seed-skills" && -z "$(ls -A "$ROOT/projects/default/sandbox/.pi/skills" 2>/dev/null || true)" ]]; then
      mkdir -p "$ROOT/projects/default/sandbox/.pi/skills"
      cp -a "$ROOT/platform/seed-skills/." "$ROOT/projects/default/sandbox/.pi/skills/"
    fi
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "$MARKER"
  fi
}

prepare_sandbox_environments() {
  local uv="$ROOT/platform/bin/uv"
  local wheelhouse="$ROOT/platform/wheelhouse"
  local sandbox_requirements="$ROOT/platform/sandbox-requirements.txt"
  local pyproject sandbox status
  local node="$ROOT/platform/node/bin/node"
  local uv_timeout_command=""
  [[ -x "$uv" && -f "$sandbox_requirements" && -d "$wheelhouse" ]] || return 0
  if command -v timeout >/dev/null 2>&1; then
    uv_timeout_command="timeout 60"
  fi

  if [[ -x "$node" && -d "$ROOT/server/node_modules" ]]; then
    (cd "$ROOT/server" && "$node" node_modules/tsx/dist/cli.mjs src/sandbox-migrate.ts)
  fi

  while IFS= read -r -d '' pyproject; do
    sandbox="$(dirname "$pyproject")"
    grep -q 'scanpy' "$pyproject" || continue
    echo "Preparing sandbox analysis runtime: $sandbox"
    status=0
    (
      cd "$sandbox"
      UV_PYTHON_DOWNLOADS=never $uv_timeout_command "$uv" sync \
        --offline --no-index --find-links "$wheelhouse" \
        --python "$(command -v python3)"
    ) || status=1
    if [[ "$status" -ne 0 ]]; then
      # Project dependencies are user-owned and may intentionally require
      # packages outside the packaged wheelhouse. Prewarming must never block
      # the Web service; the project's next `uv run` can resolve them itself.
      echo "Sandbox analysis runtime prewarm skipped: $sandbox" >&2
    fi
  done < <(find "$ROOT/projects" -path '*/sandbox/pyproject.toml' -type f -print0 2>/dev/null)
}

start() {
  load_config
  prepare_runtime
  if [[ "$KADY_PREPARE_SANDBOXES" == "1" ]]; then
    prepare_sandbox_environments
  fi

  if [[ -f "$ROOT/run/platform.pid" ]]; then
    local oldpid
    oldpid="$(cat "$ROOT/run/platform.pid" 2>/dev/null || true)"
    if [[ "$oldpid" =~ ^[0-9]+$ ]] && kill -0 "$oldpid" 2>/dev/null; then
      echo "AI Scientist is already running (pid $oldpid)"
      return 0
    fi
  fi

  local port
  for port in "$KADY_PORT" "$KADY_FRONTEND_PORT"; do
    if command -v ss >/dev/null 2>&1 && ss -lnt "sport = :$port" 2>/dev/null | grep -q LISTEN; then
      echo "Port $port is already in use" >&2
      return 5
    fi
  done

  export PATH="$ROOT/platform/node/bin:$ROOT/platform/bin:${ADE_HOME%/}/bin:$PATH"
  export KADY_PORT KADY_HOST KADY_FRONTEND_PORT KADY_FRONTEND_HOST KADY_PUBLIC_HOST
  export KADY_ALLOWED_ORIGINS
  export KADY_HTTPS_PORT KADY_HTTPS_HOST KADY_TLS_KEY KADY_TLS_CERT
  export KADY_OFFLINE KADY_REQUIRE_AUTH
  export KADY_WHEELHOUSE="$ROOT/platform/wheelhouse"
  if [[ -d "$ROOT/platform/office-assets/zeta-2025-05-13" ]]; then
    export KADY_OFFICE_ASSETS_DIR="$ROOT/platform/office-assets/zeta-2025-05-13"
  fi
  export ADE_HOME ADE_PROJECT ADE_BIN ADE_SKILLS_DIR ADE_MALLOY_HOME ADE_NODE_BINARY ADE_PYTHON ADE_BOOTSTRAP ADE_VERSION
  export NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
  if [[ "$KADY_OFFLINE" == "1" ]]; then
    export UV_OFFLINE=1 UV_NO_INDEX=1 UV_PYTHON_DOWNLOADS=never
    export UV_FIND_LINKS="$ROOT/platform/wheelhouse"
    export UV_CACHE_DIR="$ROOT/platform/uv-cache"
  fi

  local node="$ROOT/platform/node/bin/node"
  : > "$ROOT/logs/backend.log"
  : > "$ROOT/logs/frontend.log"
  : > "$ROOT/logs/prep.log"

  start_group() {
    local name="$1" dir="$2"; shift 2
    local log="$ROOT/logs/$name.log"
    if command -v setsid >/dev/null 2>&1; then
      (cd "$ROOT/$dir" && exec setsid "$@" >>"$log" 2>&1 < /dev/null) &
    else
      (cd "$ROOT/$dir" && exec "$@" >>"$log" 2>&1 < /dev/null) &
    fi
    local pid=$!
    echo "$pid" > "$ROOT/run/$name.pid"
    printf '%s' "$pid"
  }

  local backend_pid frontend_pid
  backend_pid="$(start_group backend server "$node" node_modules/tsx/dist/cli.mjs src/index.ts)"
  frontend_pid="$(start_group frontend web "$node" server.mjs)"
  printf '%s %s\n' "$backend_pid" "$frontend_pid" > "$ROOT/run/platform.children"
  printf '%s\n' "$frontend_pid" > "$ROOT/run/platform.pid"

  local i
  for i in $(seq 1 150); do
    if curl -fsS "http://127.0.0.1:${KADY_PORT}/health" >/dev/null 2>&1 &&
       curl -fsS "http://127.0.0.1:${KADY_FRONTEND_PORT}/" >/dev/null 2>&1 &&
       { [[ -z "$KADY_HTTPS_PORT" ]] ||
         curl -kfsS "https://127.0.0.1:${KADY_HTTPS_PORT}/" >/dev/null 2>&1; }; then
      touch "$ROOT/run/platform.ready"
      local display_host="$KADY_PUBLIC_HOST"
      [[ "$display_host" == "0.0.0.0" || "$display_host" == "::" ]] && display_host="127.0.0.1"
      echo "AI Scientist is running"
      echo "  Frontend: http://${display_host}:${KADY_FRONTEND_PORT}"
      if [[ -n "$KADY_HTTPS_PORT" ]]; then
        echo "  HTTPS:    https://${display_host}:${KADY_HTTPS_PORT}"
      fi
      echo "  Backend:  private ${KADY_HOST}:${KADY_PORT}, proxied at /api/kady"
      return 0
    fi
    if ! kill -0 "$backend_pid" 2>/dev/null || ! kill -0 "$frontend_pid" 2>/dev/null; then
      echo "A service exited during startup; see logs/backend.log and logs/frontend.log" >&2
      return 6
    fi
    sleep 1
  done

  echo "Services did not become ready within 150 seconds" >&2
  stop
  return 7
}

stop() {
  local name file pid i stopped=0
  for name in frontend backend; do
    file="$ROOT/run/$name.pid"
    [[ -f "$file" ]] || continue
    pid="$(cat "$file" 2>/dev/null || true)"
    if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
      rm -f "$file"
      continue
    fi
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $name (pid $pid)"
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      for i in $(seq 1 40); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
      fi
      stopped=1
    else
      echo "$name is not running"
    fi
    rm -f "$file"
  done
  rm -f "$ROOT/run/platform.pid" "$ROOT/run/platform.children" "$ROOT/run/platform.ready"
  [[ "$stopped" -eq 1 ]] || echo "AI Scientist is not running"
  return 0
}

status() {
  load_config
  if [[ -f "$ROOT/run/platform.pid" ]]; then
    local pid
    pid="$(cat "$ROOT/run/platform.pid" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      echo "process: running (frontend pid $pid)"
    else
      echo "process: stopped"
      return 1
    fi
  else
    echo "process: stopped"
    return 1
  fi

  if curl -fsS "http://127.0.0.1:${KADY_FRONTEND_PORT}/api/kady/health" >/dev/null 2>&1; then
    echo "health: healthy"
    echo "frontend: http://${KADY_PUBLIC_HOST}:${KADY_FRONTEND_PORT}"
    if [[ -n "$KADY_HTTPS_PORT" ]]; then
      curl -kfsS "https://127.0.0.1:${KADY_HTTPS_PORT}/api/kady/health" >/dev/null 2>&1 &&
        echo "https: healthy at https://${KADY_PUBLIC_HOST}:${KADY_HTTPS_PORT}"
    fi
    if [[ -n "${ADE_BIN:-}" && -x "${ADE_BIN:-}" ]]; then
      echo "ade: ${ADE_BIN}"
      echo "ade skills: ${ADE_SKILLS_DIR:-}"
    fi
    return 0
  fi
  echo "health: unhealthy"
  return 1
}

logs() {
  [[ -f "$ROOT/logs/backend.log" || -f "$ROOT/logs/frontend.log" ]] || { echo "No logs yet" >&2; return 1; }
  tail -n 100 -f "$ROOT/logs/backend.log" "$ROOT/logs/frontend.log"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  logs) logs ;;
  -h|--help|help|"") usage ;;
  *) echo "Unknown command: $1" >&2; usage; exit 2 ;;
esac
