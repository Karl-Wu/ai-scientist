#!/usr/bin/env bash
# Build and repetitively deploy the offline package to the target server.
set -Eeuo pipefail

BUILD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$BUILD_ROOT/.." && pwd)"
HOST="${DEPLOY_HOST:-10.201.0.131}"
USER="${DEPLOY_USER:-root}"
TARGET_DIR="${DEPLOY_DIR:-/data/ai-scientist-new}"
FRONTEND_PORT="${DEPLOY_FRONTEND_PORT:-9018}"
BACKEND_PORT="${DEPLOY_BACKEND_PORT:-18000}"
HTTPS_PORT="${DEPLOY_HTTPS_PORT:-9019}"
ADE_TARGET="${DEPLOY_ADE_TARGET:-/data/ade}"
PUBLIC_HOST=""
PACKAGE=""
SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?}"; shift 2 ;;
    --user) USER="${2:?}"; shift 2 ;;
    --dir) TARGET_DIR="${2:?}"; shift 2 ;;
    --frontend-port) FRONTEND_PORT="${2:?}"; shift 2 ;;
    --backend-port) BACKEND_PORT="${2:?}"; shift 2 ;;
    --https-port) HTTPS_PORT="${2:?}"; shift 2 ;;
    --ade-target) ADE_TARGET="${2:?}"; shift 2 ;;
    --public-host) PUBLIC_HOST="${2:?}"; shift 2 ;;
    --package) PACKAGE="${2:?}"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
PUBLIC_HOST="${PUBLIC_HOST:-$HOST}"
VERSION="$(node -p "require('$SOURCE_ROOT/server/package.json').version")"
if [[ -z "$PACKAGE" ]]; then
  PACKAGE="$BUILD_ROOT/dist/ai-scientist-${VERSION}-linux-x64.tar.gz"
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  "$BUILD_ROOT/build.sh"
fi
[[ -f "$PACKAGE" ]] || { echo "Package not found: $PACKAGE" >&2; exit 3; }

DEPLOY_WORK="$(mktemp -d "${TMPDIR:-/tmp}/ai-scientist-deploy.XXXXXX")"
trap 'rm -rf "$DEPLOY_WORK"' EXIT
ENV_FILE="$DEPLOY_WORK/platform.env"
cat > "$ENV_FILE" <<EOF
# Generated for $HOST by build/deploy.sh
KADY_PORT=$BACKEND_PORT
KADY_HOST=127.0.0.1
KADY_FRONTEND_PORT=$FRONTEND_PORT
KADY_FRONTEND_HOST=0.0.0.0
KADY_HTTPS_PORT=$HTTPS_PORT
KADY_HTTPS_HOST=0.0.0.0
KADY_PUBLIC_HOST=$PUBLIC_HOST
KADY_ALLOWED_ORIGINS=http://$PUBLIC_HOST:$FRONTEND_PORT,https://$PUBLIC_HOST:$HTTPS_PORT
KADY_OFFLINE=1
KADY_REQUIRE_AUTH=0
ADE_HOME=$ADE_TARGET
ADE_PROJECT=$ADE_TARGET/workspace
EOF

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ConnectTimeout=20)
SSH=(ssh "${SSH_OPTS[@]}")
SCP=(scp "${SSH_OPTS[@]}")

REMOTE_PACKAGE="/tmp/$(basename "$PACKAGE")"
REMOTE_ENV="/tmp/ai-scientist2-platform.env"
REMOTE_INSTALL="/tmp/ai-scientist2-remote-install.sh"

echo "==> Checking $USER@$HOST"
"${SSH[@]}" "$USER@$HOST" 'test "$(uname -m)" = x86_64 && python3 --version >/dev/null'

echo "==> Uploading $(du -h "$PACKAGE" | awk '{print $1}') package"
"${SSH[@]}" "$USER@$HOST" "mkdir -p '$(dirname "$TARGET_DIR")' /tmp"
"${SCP[@]}" "$PACKAGE" "$USER@$HOST:$REMOTE_PACKAGE"
"${SCP[@]}" "$ENV_FILE" "$USER@$HOST:$REMOTE_ENV"
"${SCP[@]}" "$BUILD_ROOT/template/install-offline.sh" "$USER@$HOST:$REMOTE_INSTALL"

echo "==> Installing at $TARGET_DIR"
"${SSH[@]}" "$USER@$HOST" "bash '$REMOTE_INSTALL' '$TARGET_DIR' '$REMOTE_PACKAGE' '$REMOTE_ENV'"

echo "==> Verifying public endpoint"
for _ in $(seq 1 45); do
  if curl -fsS --connect-timeout 3 "http://${PUBLIC_HOST}:${FRONTEND_PORT}/api/kady/health" >/dev/null 2>&1; then
    echo "AI Scientist is healthy at http://${PUBLIC_HOST}:${FRONTEND_PORT}"
    exit 0
  fi
  sleep 2
done
echo "Public health check failed" >&2
exit 4
