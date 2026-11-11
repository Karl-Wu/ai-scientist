#!/usr/bin/env bash
# Build an offline Linux x86_64 installer from packaged TypeScript components.
#
# Output:
#   build/dist/ai-scientist-<version>-linux-x64.tar.gz              offline installer
#   build/dist/ai-scientist-<version>-linux-x64.tar.gz.sha256       checksum
set -Eeuo pipefail

BUILD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$BUILD_ROOT/.." && pwd)"
VERSION="$(node -p "require('$SOURCE_ROOT/server/package.json').version")"
COMMIT="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
PACKAGE_NAME="ai-scientist-${VERSION}-linux-x64"
DIST="$BUILD_ROOT/dist"
STAGE="$DIST/$PACKAGE_NAME"
PACKAGE_DIR="$DIST/packages"
OFFLINE_ROOT_NAME="ai-scientist-offline-${VERSION}-linux-x64"
OFFLINE_STAGE="$DIST/$OFFLINE_ROOT_NAME"
CACHE="$BUILD_ROOT/cache"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ai-scientist-build.XXXXXX")"
trap 'rm -rf "$WORK" "$STAGE" "$OFFLINE_STAGE" "$PACKAGE_DIR"' EXIT
NODE_VERSION="${NODE_VERSION:-22.22.0}"
UV_VERSION="${UV_VERSION:-0.13.7}"
ADE_SOURCE="${ADE_SOURCE:-$SOURCE_ROOT/../agentic-data-extraction}"
ADE_PACKAGE="${ADE_PACKAGE:-}"
ADE_PACKAGE_NAME=""
ADE_NODE_FILE=""
ADE_NODE_VERSION=""
SERVER_PACKAGE="ai-scientist-server-${VERSION}-linux-x64.tgz"
WEB_PACKAGE="ai-scientist-web-${VERSION}-linux-x64.tgz"

REUSE_FRONTEND=0
NO_SKILLS=0
NO_WHEELHOUSE=0
NO_ADE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reuse-frontend) REUSE_FRONTEND=1; shift ;;
    --no-skills) NO_SKILLS=1; shift ;;
    --no-wheelhouse) NO_WHEELHOUSE=1; shift ;;
    --no-ade) NO_ADE=1; shift ;;
    --ade-package) ADE_PACKAGE="${2:?}"; shift 2 ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "$1 is required" >&2; exit 1; }; }

step "Preparing offline build"
printf '  project:  %s\n' "$SOURCE_ROOT"
printf '  version:  %s\n' "$VERSION"
printf '  commit:   %s\n' "$COMMIT"
printf '  frontend: %s\n' "$([[ "$REUSE_FRONTEND" -eq 1 ]] && echo cached-if-available || echo full-build)"
if [[ "$NO_ADE" -eq 0 ]]; then
  if [[ -n "$ADE_PACKAGE" ]]; then
    [[ -s "$ADE_PACKAGE" ]] || {
      echo "ADE package not found or empty: $ADE_PACKAGE" >&2
      exit 1
    }
    ADE_PACKAGE="$(cd "$(dirname "$ADE_PACKAGE")" && pwd)/$(basename "$ADE_PACKAGE")"
    printf '  ADE:      %s\n' "$ADE_PACKAGE"
  else
    printf '  ADE:      auto-select from %s\n' "$ADE_SOURCE"
  fi
else
  printf '  ADE:      disabled\n'
fi

download() {
  local output="$1" url="$2" attempt tmp
  [[ -s "$output" ]] && return 0
  tmp="${output}.tmp"
  rm -f "$tmp"
  for attempt in $(seq 1 5); do
    if curl --http1.1 -fL --retry 3 --retry-all-errors --connect-timeout 20 \
      --speed-time 30 --speed-limit 1024 -o "$tmp" "$url"; then
      mv "$tmp" "$output"
      return 0
    fi
    rm -f "$tmp"
    warn "Download failed (attempt $attempt/5): $url"
    [[ "$attempt" -eq 5 ]] && return 1
    sleep $((attempt * 2))
  done
}

install_uv() {
  local destination="$1"
  local cache_dir="$CACHE/uv"
  local uv_bin="$cache_dir/uv-${UV_VERSION}-x86_64-unknown-linux-gnu"
  local wheel_dir="$cache_dir/wheels/${UV_VERSION}"
  local wheel_archive wheel_tmp uv_bin_tmp installer installer_member

  mkdir -p "$(dirname "$destination")" "$cache_dir"

  if [[ -x "$uv_bin" ]]; then
    install -m 0755 "$uv_bin" "$destination"
    printf '  uv source: cached binary\n'
    return 0
  fi

  # Reuse a binary already packaged by a previous successful offline build.
  installer="$(find "$DIST" -maxdepth 1 -type f -name 'ai-scientist-*-linux-x64.tar.gz' -print 2>/dev/null | sort | tail -1)"
  if [[ -s "$installer" ]]; then
    installer_member="$(tar -tzf "$installer" 2>/dev/null | grep '/platform/bin/uv$' | head -1 || true)"
    if [[ -n "$installer_member" ]]; then
      rm -rf "$WORK/uv-from-installer"
      mkdir -p "$WORK/uv-from-installer"
      if tar -xzf "$installer" -C "$WORK/uv-from-installer" "$installer_member"; then
        uv_bin_tmp="$(find "$WORK/uv-from-installer" -type f -name uv -print -quit)"
        if [[ -n "$uv_bin_tmp" ]]; then
          install -m 0755 "$uv_bin_tmp" "$uv_bin"
          install -m 0755 "$uv_bin" "$destination"
          printf '  uv source: previous installer\n'
          return 0
        fi
      fi
    fi
  fi

  # PyPI wheels are much more reliable than GitHub release assets on networks
  # where github.com is throttled. The wheel carries the same Linux x86_64 uv.
  mkdir -p "$wheel_dir"
  wheel_archive="$(find "$wheel_dir" -maxdepth 1 -type f -name "uv-${UV_VERSION}-*.whl" -print -quit)"
  if [[ -z "$wheel_archive" ]]; then
    wheel_tmp="$WORK/uv-wheel"
    mkdir -p "$wheel_tmp"
    python3 -m pip download \
      --no-deps --only-binary=:all: \
      --platform manylinux_2_17_x86_64 \
      --implementation cp --abi cp312 --python-version 3.12 \
      --timeout 20 --retries 1 \
      -i "${UV_PYPI_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}" \
      -d "$wheel_tmp" "uv==${UV_VERSION}"
    wheel_archive="$(find "$wheel_tmp" -maxdepth 1 -type f -name "uv-${UV_VERSION}-*.whl" -print -quit)"
    [[ -n "$wheel_archive" ]] || {
      echo "PyPI mirror did not return a uv ${UV_VERSION} Linux x86_64 wheel" >&2
      return 1
    }
    mv "$wheel_archive" "$wheel_dir/$(basename "$wheel_archive")"
    wheel_archive="$wheel_dir/$(basename "$wheel_archive")"
  fi

  python3 - "$wheel_archive" "$uv_bin" <<'PY'
import sys
import zipfile
from pathlib import Path

wheel, output = map(Path, sys.argv[1:])
with zipfile.ZipFile(wheel) as archive:
    candidates = [
        name for name in archive.namelist()
        if name == "uv" or name.endswith("/uv")
    ]
    if len(candidates) != 1:
        raise SystemExit(f"expected one uv entry in wheel, found {candidates}")
    output.write_bytes(archive.read(candidates[0]))
PY
  chmod 0755 "$uv_bin"
  install -m 0755 "$uv_bin" "$destination"
  printf '  uv source: PyPI wheel\n'
  return 0
}

need git
need node
need npm
need python3
need curl
need tar

if ! node -e 'process.exit(process.versions.node.split(".")[0] >= 22 ? 0 : 1)'; then
  echo "Node.js >= 22 is required" >&2
  exit 1
fi

mkdir -p "$DIST" "$CACHE"
rm -rf "$STAGE" "$OFFLINE_STAGE"
mkdir -p "$STAGE"

step "Staging tracked application source at $COMMIT"
git -C "$SOURCE_ROOT" archive --format=tar "$COMMIT" | tar -xf - -C "$STAGE"
# Package the repository's current tracked working tree on top of the HEAD
# baseline. This keeps reviewed-but-unreleased fixes reproducible without
# requiring a temporary commit, while still excluding local untracked scratch.
while IFS= read -r -d '' file; do
  mkdir -p "$STAGE/$(dirname "$file")"
  cp "$SOURCE_ROOT/$file" "$STAGE/$file"
done < <(git -C "$SOURCE_ROOT" ls-files -z)

step "Building frontend for same-origin API"
FRONTEND_CACHE="$CACHE/frontend"
frontend_digest="$(
  {
    printf 'NEXT_PUBLIC_ADK_API_URL=/api/kady\n'
    git -C "$SOURCE_ROOT" ls-files -- \
      web/package.json web/package-lock.json web/next.config.ts web/tsconfig.json web/src web/public |
      sort |
      while IFS= read -r file; do
        printf '%s\0' "$file"
        git -C "$SOURCE_ROOT" hash-object "$SOURCE_ROOT/$file"
      done
  } | shasum -a 256 | awk '{print $1}'
)"
FRONTEND_TAR="$FRONTEND_CACHE/frontend-${frontend_digest:0:24}.tar.gz"
mkdir -p "$FRONTEND_CACHE"
if [[ "$REUSE_FRONTEND" -eq 1 && -f "$FRONTEND_TAR" ]]; then
  mkdir -p "$STAGE/web/.next"
  tar -xzf "$FRONTEND_TAR" -C "$STAGE/web/.next"
else
  (
    cd "$STAGE/web"
    npm ci --no-audit --no-fund --loglevel=error
    NEXT_PUBLIC_ADK_API_URL=/api/kady npm run build
  )
  tar -czf "$FRONTEND_TAR" -C "$STAGE/web/.next" .
fi
cp "$BUILD_ROOT/template/web/server.mjs" "$STAGE/web/server.mjs"

step "Installing backend Linux x64 dependencies"
(
  cd "$STAGE/server"
  npm ci --os=linux --cpu=x64 --libc=glibc --ignore-scripts \
    --no-audit --no-fund --loglevel=error
  node scripts/patch-subagents.mjs
)

step "Installing frontend Linux x64 runtime dependencies"
rm -rf "$STAGE/web/node_modules"
(
  cd "$STAGE/web"
  npm ci --os=linux --cpu=x64 --libc=glibc --omit=dev --ignore-scripts \
    --no-audit --no-fund --loglevel=error
)

if [[ "$NO_ADE" -eq 0 ]]; then
  step "Bundling official ADE offline deployment package"
  if [[ -z "$ADE_PACKAGE" ]]; then
    ADE_PACKAGE="$(find "$ADE_SOURCE/build/dist/linux/archives" \
      -maxdepth 1 -type f -name 'ade-offline-*-linux-x86_64-py3.12.tar.gz' -print 2>/dev/null | sort | tail -1)"
  fi
  [[ -s "$ADE_PACKAGE" ]] || {
    echo "ADE Linux x86_64/Python 3.12 offline package not found; pass --ade-package or --no-ade" >&2
    exit 1
  }
  mkdir -p "$STAGE/platform/ade"
  cp "$ADE_PACKAGE" "$STAGE/platform/ade/ade-offline.tar.gz"
  if [[ -s "$ADE_PACKAGE.sha256" ]]; then
    cp "$ADE_PACKAGE.sha256" "$STAGE/platform/ade/ade-offline.tar.gz.sha256"
  fi
  cp "$BUILD_ROOT/template/ade/ade-bootstrap" "$STAGE/platform/ade/ade-bootstrap"
  chmod 755 "$STAGE/platform/ade/ade-bootstrap"
  mkdir -p "$STAGE/platform/ade/workspace-tools"
  cp "$SOURCE_ROOT/projects/default/sandbox/ade/tools/"*.py \
    "$STAGE/platform/ade/workspace-tools/"
  ADE_PACKAGE_NAME="$(basename "$ADE_PACKAGE")"

  archive_root="$(tar -tzf "$ADE_PACKAGE" | head -1)"
  tar -xOf "$ADE_PACKAGE" "${archive_root}BUILD-INFO.json" > "$WORK/ade-build-info.json"
  read -r ADE_NODE_FILE ADE_NODE_VERSION < <(python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d["node_file"], d["node_version"])' "$WORK/ade-build-info.json")
  [[ "$ADE_NODE_VERSION" == "$NODE_VERSION" ]] || {
    echo "ADE offline package bundles Node $ADE_NODE_VERSION, expected $NODE_VERSION" >&2
    exit 1
  }
fi

step "Bundling Node.js $NODE_VERSION"
mkdir -p "$STAGE/platform/node"
if [[ "$NO_ADE" -eq 0 ]]; then
  # Share the Node archive inside the official ADE package instead of keeping a
  # second AI-Scientist-only download/cache for the same pinned runtime.
  tar -xzf "$ADE_PACKAGE" -C "$WORK" "${archive_root}node/${ADE_NODE_FILE}"
  tar -xJf "$WORK/${archive_root}node/${ADE_NODE_FILE}" \
    -C "$STAGE/platform/node" --strip-components=1
else
  NODE_CACHE="$CACHE/node"
  NODE_TAR="$NODE_CACHE/node-v${NODE_VERSION}-linux-x64.tar.xz"
  mkdir -p "$NODE_CACHE"
  download "$NODE_TAR" \
    "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
  tar -xJf "$NODE_TAR" -C "$STAGE/platform/node" --strip-components=1
fi

step "Bundling uv $UV_VERSION"
install_uv "$STAGE/platform/bin/uv"

if [[ "$NO_SKILLS" -eq 0 && -d "$SOURCE_ROOT/projects/default/sandbox/.pi/skills" ]]; then
  step "Bundling project skill snapshot"
  mkdir -p "$STAGE/platform/seed-skills"
  tar -C "$SOURCE_ROOT/projects/default/sandbox/.pi/skills" -cf - . | \
    tar -xf - -C "$STAGE/platform/seed-skills"
fi

if [[ "$NO_WHEELHOUSE" -eq 0 ]]; then
  step "Building Linux x64 Python wheelhouse"
  mkdir -p "$STAGE/platform/wheelhouse"
  requirements="$WORK/helper-requirements.txt"
  lock_digest="$(git -C "$SOURCE_ROOT" hash-object "$STAGE/server/src/helpers/uv.lock")"
  wheel_cache="$CACHE/wheelhouse/linux-x64-py312-$lock_digest"
  UV_CACHE_DIR="$CACHE/uv/host" uv export --project "$STAGE/server/src/helpers" --frozen --no-dev \
    --no-emit-project --no-hashes --format requirements-txt -o "$requirements"
  if [[ ! -d "$wheel_cache" || -z "$(ls -A "$wheel_cache" 2>/dev/null || true)" ]]; then
    rm -rf "$wheel_cache"
    mkdir -p "$wheel_cache"
    python3 -m pip download \
      --only-binary=:all: \
      --dest "$wheel_cache" \
      --platform manylinux2014_x86_64 \
      --platform manylinux_2_17_x86_64 \
      --platform manylinux_2_28_x86_64 \
      --platform manylinux_2_31_x86_64 \
      --platform manylinux_2_32_x86_64 \
      --platform manylinux_2_33_x86_64 \
      --platform manylinux_2_34_x86_64 \
      --platform manylinux_2_35_x86_64 \
      --platform manylinux_2_36_x86_64 \
      --platform linux_x86_64 \
      --implementation cp \
      --abi cp312 \
      --python-version 3.12 \
      -r "$requirements"
  fi
  # Keep the immutable build cache intact while making a package-owned copy.
  cp -a "$wheel_cache/." "$STAGE/platform/wheelhouse/"
  cp "$requirements" "$STAGE/platform/helper-requirements.txt"
fi

step "Packaging server and web runtime components"
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

COPYFILE_DISABLE=1 tar --no-xattrs -C "$STAGE" \
  -czf "$PACKAGE_DIR/$SERVER_PACKAGE" \
  server/package.json server/package-lock.json server/src server/scripts server/node_modules \
  server/pi-packages \
  web/src/lib

WEB_PATHS=(web/package.json web/package-lock.json web/.next web/node_modules web/server.mjs)
[[ -d "$STAGE/web/public" ]] && WEB_PATHS+=(web/public)
COPYFILE_DISABLE=1 tar --no-xattrs --exclude 'web/.next/cache' -C "$STAGE" \
  -czf "$PACKAGE_DIR/$WEB_PACKAGE" "${WEB_PATHS[@]}"

step "Assembling offline installer"
mkdir -p "$OFFLINE_STAGE/platform" "$OFFLINE_STAGE/packages"
find "$STAGE/platform" -mindepth 1 -maxdepth 1 -exec mv {} "$OFFLINE_STAGE/platform/" \;
cp "$STAGE/env-file.mjs" "$STAGE/env-file.d.mts" "$OFFLINE_STAGE/"
cp "$BUILD_ROOT/platform.sh" "$OFFLINE_STAGE/platform.sh"
cp "$BUILD_ROOT/platform.env.example" "$OFFLINE_STAGE/platform.env.example"
cp "$BUILD_ROOT/template/install-offline.sh" "$OFFLINE_STAGE/install-offline.sh"
chmod 755 "$OFFLINE_STAGE/platform.sh" "$OFFLINE_STAGE/install-offline.sh"
ln "$PACKAGE_DIR/$SERVER_PACKAGE" "$OFFLINE_STAGE/packages/$SERVER_PACKAGE"
ln "$PACKAGE_DIR/$WEB_PACKAGE" "$OFFLINE_STAGE/packages/$WEB_PACKAGE"

cat > "$OFFLINE_STAGE/README.txt" <<EOF
AI Scientist $VERSION offline installer
Target: Linux x86_64, Python 3.12
Source commit: $COMMIT

Install:
  ./install-offline.sh --target /absolute/platform-directory

After installation:
  cd /absolute/platform-directory
  ./platform.sh start
  ./platform.sh stop
  ./platform.sh restart
  ./platform.sh status

Ports default to backend 8000 and frontend 3000; edit platform.env to change
them. The backend remains private behind /api/kady on the frontend port.
EOF

python3 - "$PACKAGE_DIR" "$OFFLINE_STAGE" "$COMMIT" "$VERSION" "$NODE_VERSION" "$UV_VERSION" \
  "$ADE_PACKAGE_NAME" "$SERVER_PACKAGE" "$WEB_PACKAGE" <<'PY'
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

package_dir, offline_stage, commit, version, node, uv, ade_package, server_pkg, web_pkg = sys.argv[1:]

def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()

components = {
    server_pkg: digest(Path(package_dir, server_pkg)),
    web_pkg: digest(Path(package_dir, web_pkg)),
}
Path(offline_stage, "components.json").write_text(json.dumps({
    "schema_version": 1,
    "components": components,
}, indent=2) + "\n", encoding="utf-8")
Path(offline_stage, "build-info.json").write_text(json.dumps({
    "schema_version": 2,
    "artifact_kind": "offline-installer",
    "name": "ai-scientist",
    "version": version,
    "commit": commit,
    "target": "linux-x64",
    "python": "3.12",
    "node": node,
    "uv": uv,
    "ade_offline_package": ade_package or None,
    "components": components,
    "offline": True,
    "built_at": datetime.now(timezone.utc).isoformat(),
}, indent=2) + "\n", encoding="utf-8")
PY

step "Creating archive"
printf '  component packages: %s\n' "$(du -sh "$PACKAGE_DIR" | awk '{print $1}')"
printf '  installer payload: %s\n' "$(du -sh "$OFFLINE_STAGE" | awk '{print $1}')"
rm -f "$DIST/$PACKAGE_NAME.tar.gz" "$DIST/$PACKAGE_NAME.tar.gz.sha256"
COPYFILE_DISABLE=1 tar --no-xattrs -C "$DIST" \
  -czf "$DIST/$PACKAGE_NAME.tar.gz" "$OFFLINE_ROOT_NAME"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$DIST" && sha256sum "$PACKAGE_NAME.tar.gz" > "$PACKAGE_NAME.tar.gz.sha256")
else
  (cd "$DIST" && shasum -a 256 "$PACKAGE_NAME.tar.gz" > "$PACKAGE_NAME.tar.gz.sha256")
fi
rm -rf "$STAGE" "$OFFLINE_STAGE" "$PACKAGE_DIR"

printf '\nBuild complete:\n  %s\n  %s\n' \
  "$DIST/$PACKAGE_NAME.tar.gz" "$DIST/$PACKAGE_NAME.tar.gz.sha256"
