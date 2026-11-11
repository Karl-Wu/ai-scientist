#!/usr/bin/env bash
# Install an offline component bundle while preserving operator data.
set -Eeuo pipefail

TARGET_DIR=""
PACKAGE=""
ENV_FILE=""
SOURCE_BUNDLE_DIR=""
ADE_TARGET="/data/ade"
FRONTEND_PORT=3000
BACKEND_PORT=8000
HTTPS_PORT=""
PUBLIC_HOST=""

usage() {
  cat >&2 <<'EOF'
Usage:
  ./install-offline.sh --target /absolute/platform-directory [options]
  install-offline.sh /absolute/platform-directory installer.tar.gz platform.env
Options:
  --ade-target DIR     Default: /data/ade
  --frontend-port N    Default: 3000
  --backend-port N     Default: 8000
  --https-port N       Optional additional HTTPS listener
  --public-host HOST   Default: 127.0.0.1
EOF
  exit 2
}

while (($#)); do
  case "$1" in
    --target) TARGET_DIR="${2:?}"; shift 2 ;;
    --ade-target) ADE_TARGET="${2:?}"; shift 2 ;;
    --frontend-port) FRONTEND_PORT="${2:?}"; shift 2 ;;
    --backend-port) BACKEND_PORT="${2:?}"; shift 2 ;;
    --https-port) HTTPS_PORT="${2:?}"; shift 2 ;;
    --public-host) PUBLIC_HOST="${2:?}"; shift 2 ;;
    -h|--help) usage ;;
    --*) usage ;;
    *)
      if [[ $# -eq 3 ]]; then
        TARGET_DIR="$1"
        PACKAGE="$2"
        ENV_FILE="$3"
        shift 3
      else
        usage
      fi
      ;;
  esac
done
[[ -n "$TARGET_DIR" ]] || usage
if [[ -z "$PACKAGE" ]]; then
  SOURCE_BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [[ -f "$SOURCE_BUNDLE_DIR/platform.sh" && -d "$SOURCE_BUNDLE_DIR/packages" ]] || {
    echo "Run from an extracted AI Scientist offline bundle, or use the positional deployment form." >&2
    exit 2
  }
fi

PARENT="$(dirname "$TARGET_DIR")"
MARKER=".platform-package"
BACKUP=""
INSTALL_STAGE=""
trap '[[ -z "$INSTALL_STAGE" ]] || rm -rf "$INSTALL_STAGE"' EXIT

env_value() {
  awk -F= -v key="$1" '$1 == key {print substr($0, length($1) + 2)}' "$2"
}

absolute_dir() {
  local value="${1:?directory required}"
  mkdir -p "$(dirname "$value")"
  printf '%s/%s\n' "$(cd "$(dirname "$value")" && pwd)" "$(basename "$value")"
}

install_offline_ade() {
  local stage="$1" config="$2"
  local package="$stage/platform/ade/ade-offline.tar.gz"
  local package_stage package_id ade_home old_backup item runtime_python platform_node
  [[ -s "$package" ]] || {
    echo "ADE offline package is not bundled; ADE integration will be unavailable" >&2
    return 0
  }

  ade_home="$(absolute_dir "$(env_value ADE_HOME "$stage/platform.env")")"
  : "${ade_home:=$(absolute_dir "$stage/ade")}"
  if grep -q '^ADE_HOME=' "$config"; then
    sed -i "s#^ADE_HOME=.*#ADE_HOME=$ade_home#" "$config"
  else
    printf 'ADE_HOME=%s\n' "$ade_home" >> "$config"
  fi
  if grep -q '^ADE_PROJECT=' "$config"; then
    sed -i "s#^ADE_PROJECT=.*#ADE_PROJECT=$ade_home/workspace#" "$config"
  else
    printf 'ADE_PROJECT=%s/workspace\n' "$ade_home" >> "$config"
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    package_id="$(sha256sum "$package" | awk '{print $1}')"
  else
    package_id="$(shasum -a 256 "$package" | awk '{print $1}')"
  fi

  if [[ -x "$ade_home/bin/ade" && -f "$ade_home/runtime.json" ]] &&
     [[ "$(cat "$ade_home/.ai-scientist-package-sha256" 2>/dev/null || true)" == "$package_id" ]]; then
    echo "Reusing ADE runtime at $ade_home"
  else
    package_stage="$(mktemp -d "${ade_home}.package.XXXXXX")"
    old_backup=""
    tar -xzf "$package" -C "$package_stage" --strip-components=1

    if [[ -e "$ade_home" ]]; then
      old_backup="${ade_home}.previous-$(date -u +%Y%m%d%H%M%S)"
      mv "$ade_home" "$old_backup"
    fi

    # ADE's generated wrapper and runtime.json embed absolute paths, so the
    # official installer must write directly to the final ADE_HOME.
    if ! PATH="$stage/platform/node/bin:$PATH" \
      "$package_stage/install-offline.sh" --target "$ade_home" --node --npm; then
      rm -rf "$package_stage" "$ade_home"
      if [[ -n "$old_backup" ]]; then mv "$old_backup" "$ade_home"; fi
      return 1
    fi
    rm -rf "$package_stage"

    if [[ -n "$old_backup" ]]; then
      for item in workspace sandbox user_data bootstrap-install-report.json; do
        if [[ -e "$old_backup/$item" ]]; then
          rm -rf "$ade_home/$item"
          mv "$old_backup/$item" "$ade_home/$item"
        fi
      done
      printf '%s\n' "$old_backup" > "$stage/.ade-backup"
    fi
  fi

  printf '%s\n' "$package_id" > "$ade_home/.ai-scientist-package-sha256"
  if [[ ! -d "$ade_home/workspace/tools" && -d "$stage/platform/ade/workspace-tools" ]]; then
    mkdir -p "$ade_home/workspace/tools"
    cp -a "$stage/platform/ade/workspace-tools/." "$ade_home/workspace/tools/"
  fi
  install -m 0755 "$stage/platform/ade/ade-bootstrap" "$ade_home/bin/ade-bootstrap"
  runtime_python="$(python3 -c 'import json, os, sys; print(json.load(open(sys.argv[1]))["python"])' "$ade_home/runtime.json")"
  platform_node="$stage/platform/node/bin/node"
  python3 - "$ade_home/runtime.json" "$platform_node" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
data["node"] = sys.argv[2]
data["ADE_NODE_BINARY"] = sys.argv[2]
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY
  cat > "$ade_home/bin/ade" <<ADE_WRAPPER
#!/usr/bin/env bash
export PYTHONPATH="$ade_home/python\${PYTHONPATH:+:\$PYTHONPATH}"
export ADE_MALLOY_HOME="$ade_home/compiler"
export ADE_NODE_BINARY="$platform_node"
exec "$runtime_python" -m agentic_data_extraction "\$@"
ADE_WRAPPER
  chmod 755 "$ade_home/bin/ade"
  mkdir -p "$ade_home/etc"
  cat > "$ade_home/etc/ade.env" <<EOF
ADE_HOME=$ade_home
ADE_BIN=$ade_home/bin/ade
ADE_PROJECT=$ade_home/workspace
ADE_SKILLS_DIR=$ade_home/skills
ADE_MALLOY_HOME=$ade_home/compiler
ADE_NODE_BINARY=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["ADE_NODE_BINARY"])' "$ade_home/runtime.json")
ADE_PYTHON=$runtime_python
EOF
  "$ade_home/bin/ade" --version
  "$ade_home/bin/ade" doctor >/dev/null
  rm -rf "$ade_home/vendor"
  echo "ADE runtime: $ade_home"
  echo "ADE skills:  $ade_home/skills"
}

configure_root_ade_shell() {
  local ade_home="$1" shell_file="$HOME/.bashrc"
  [[ "$HOME" == "/root" ]] || return 0
  if [[ -d /etc/profile.d ]]; then
    cat > /etc/profile.d/ai-scientist-ade.sh <<EOF
if [ -f "$ade_home/etc/ade.env" ]; then
  . "$ade_home/etc/ade.env"
fi
case ":\$PATH:" in
  *":$ade_home/bin:"*) ;;
  *) PATH="$ade_home/bin:\$PATH" ;;
esac
export PATH
EOF
  fi
  grep -q '^# AI Scientist ADE runtime$' "$shell_file" 2>/dev/null && return 0
  cat >> "$shell_file" <<EOF

# AI Scientist ADE runtime
if [ -f "$ade_home/etc/ade.env" ]; then
  . "$ade_home/etc/ade.env"
fi
case ":\$PATH:" in
  *":$ade_home/bin:"*) ;;
  *) PATH="$ade_home/bin:\$PATH" ;;
esac
export PATH
EOF
}

install_ade_bootstrap_prompt() {
  local platform_root="$1"
  local ade_home="$2"
  local sandbox="$3"
  local ade_bin="$ade_home/bin/ade"
  local ade_version
  local ade_root="$sandbox/ade"
  local prompt_dir="$sandbox/.pi/prompts"
  local prompt_file="$prompt_dir/ade-bootstrap.md"
  local prompt_tmp

  [[ -x "$ade_bin" ]] || {
    echo "ADE executable is missing; cannot install ade-bootstrap prompt" >&2
    return 1
  }
  ade_version="$("$ade_bin" --version)"

  mkdir -p "$prompt_dir" "$ade_root"
  if [[ -s "$prompt_file" ]] && ! grep -q '^<!-- ai-scientist: ade-bootstrap-' "$prompt_file"; then
    echo "ADE prompt template preserved (user-customized): $prompt_file"
    return 0
  fi
  prompt_tmp="$(mktemp "$prompt_dir/.ade-bootstrap.XXXXXX")"
  cat > "$prompt_tmp" <<EOF
---
description: 收敛 ADE 工作区到 ade/ 并规范化表名（幂等，默认返回上次记录）
---

<!-- ai-scientist: ade-bootstrap-v2 -->

无论工作区当前是什么状态，跑完后必须满足第 1 节的两条不变量。

**默认模式不重复执行**：输入没变时直接返回上一次的执行记录。只有用户明确要求
"重新初始化"时才加 \`--reinit\`，明确要求"强制重跑"时才加 \`--force\`。

## 0. 路径

- \`ADE=$ade_bin\`（$ade_version）
- \`SANDBOX=$sandbox\`
- \`ADE_ROOT=\$SANDBOX/ade\` ← 所有 ade 命令的 \`--project\`
- 执行记录：\`\$ADE_ROOT/bootstrap-report.json\`

原始数据在 \`\$SANDBOX/user_data/\`，**不在** \`\$ADE_ROOT\` 下，只读。

## 1. 两条不变量

### 1.1 目录归属：ADE 产物只在 \$ADE_ROOT 内

ADE 会写这五样东西：\`sources/\`、\`semantic/\`、\`extractions/\`、\`runtime/\`、\`host-context.json\`。
它们只能出现在 \`\$ADE_ROOT\` 下。若在 \`\$SANDBOX\` 根发现（把 \`ade init\` 指到业务目录的典型后果）：

1. \`mkdir -p "\$ADE_ROOT/_legacy_v0"\`
2. 逐个 \`mv "\$SANDBOX/<name>" "\$ADE_ROOT/_legacy_v0/"\`；目标已存在时改名为 \`<name>.dupN\`
3. **不删除**，只在报告里列出

旧版本的隐藏目录 \`\$SANDBOX/.ade/\` 也要并入：内容整体移进 \`\$ADE_ROOT\`，同名冲突存档到
\`\$ADE_ROOT/_legacy_v0/old-hidden-*\`，空的 \`.ade\` 目录删除。脚本会自动做这件事。

数据文件（parquet、mapping、report）同样只放 \`\$ADE_ROOT/staging/\`、\`\$ADE_ROOT/mapping.json\`、
\`\$ADE_ROOT/bootstrap-report.json\`。\`\$ADE_ROOT/.ade/project.json\` 是 ADE 布局检查要求的标记，
属于唯一允许的隐藏项。

### 1.2 表名：必须匹配 \`^[a-z][a-z0-9_]*\`
EOF
  mv "$prompt_tmp" "$prompt_file"
  chmod 0644 "$prompt_file"
  echo "ADE prompt template: $prompt_file"
}

install_all_ade_bootstrap_prompts() {
  local platform_root="$1"
  local ade_home="$2"
  local sandbox
  mkdir -p "$platform_root/projects/default/sandbox"
  while IFS= read -r -d '' sandbox; do
    install_ade_bootstrap_prompt "$platform_root" "$ade_home" "$sandbox"
  done < <(find "$platform_root/projects" -mindepth 2 -maxdepth 2 -type d -path '*/sandbox' -print0 2>/dev/null)
}

TARGET_DIR="$(absolute_dir "$TARGET_DIR")"
PARENT="$(dirname "$TARGET_DIR")"
mkdir -p "$PARENT"

if [[ -d "$TARGET_DIR" ]]; then
  if [[ ! -f "$TARGET_DIR/$MARKER" ]]; then
    echo "Refusing to replace non-platform directory: $TARGET_DIR" >&2
    exit 2
  fi
  if [[ -x "$TARGET_DIR/platform.sh" ]]; then
    "$TARGET_DIR/platform.sh" stop || true
  fi
  BACKUP="${TARGET_DIR}.previous-$(date -u +%Y%m%d%H%M%S)"
  mv "$TARGET_DIR" "$BACKUP"
fi

if [[ -d "$TARGET_DIR" && -z "$(ls -A "$TARGET_DIR" 2>/dev/null || true)" ]]; then
  rmdir "$TARGET_DIR"
fi

STAGE="$(mktemp -d "$PARENT/.ai-scientist2-new.XXXXXX")"
INSTALL_STAGE="$STAGE"
if [[ -n "$PACKAGE" ]]; then
  tar -xzf "$PACKAGE" -C "$STAGE" --strip-components=1
  mv "$ENV_FILE" "$STAGE/platform.env"
else
  cp -a "$SOURCE_BUNDLE_DIR/platform" "$STAGE/platform"
  cp "$SOURCE_BUNDLE_DIR/env-file.mjs" "$SOURCE_BUNDLE_DIR/env-file.d.mts" "$STAGE/"
  cp "$SOURCE_BUNDLE_DIR/platform.sh" "$SOURCE_BUNDLE_DIR/platform.env.example" "$STAGE/"
  cp "$SOURCE_BUNDLE_DIR/components.json" "$STAGE/"
  mkdir -p "$STAGE/packages"
  cp -a "$SOURCE_BUNDLE_DIR/packages/." "$STAGE/packages/"
  PUBLIC_HOST="${PUBLIC_HOST:-127.0.0.1}"
  cat > "$STAGE/platform.env" <<EOF
KADY_PORT=$BACKEND_PORT
KADY_HOST=127.0.0.1
KADY_FRONTEND_PORT=$FRONTEND_PORT
KADY_FRONTEND_HOST=0.0.0.0
KADY_PUBLIC_HOST=$PUBLIC_HOST
KADY_ALLOWED_ORIGINS=http://$PUBLIC_HOST:$FRONTEND_PORT
KADY_OFFLINE=1
KADY_REQUIRE_AUTH=0
ADE_HOME=$ADE_TARGET
ADE_PROJECT=$ADE_TARGET/workspace
EOF
  if [[ -n "$HTTPS_PORT" ]]; then
    sed -i "/^KADY_ALLOWED_ORIGINS=/d" "$STAGE/platform.env"
    cat >> "$STAGE/platform.env" <<EOF
KADY_HTTPS_PORT=$HTTPS_PORT
KADY_HTTPS_HOST=0.0.0.0
KADY_ALLOWED_ORIGINS=http://$PUBLIC_HOST:$FRONTEND_PORT,https://$PUBLIC_HOST:$HTTPS_PORT
EOF
  fi
fi

python3 - "$STAGE" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

stage = Path(sys.argv[1])
manifest = json.loads((stage / "components.json").read_text(encoding="utf-8"))
for name, expected in manifest["components"].items():
    path = stage / "packages" / name
    if not path.is_file():
        raise SystemExit(f"Missing component package: {name}")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected:
        raise SystemExit(f"Component checksum mismatch: {name}")
print(f"Verified {len(manifest['components'])} runtime component packages")
PY

server_package="$(find "$STAGE/packages" -maxdepth 1 -type f -name 'ai-scientist-server-*.tgz' -print -quit)"
web_package="$(find "$STAGE/packages" -maxdepth 1 -type f -name 'ai-scientist-web-*.tgz' -print -quit)"
[[ -n "$server_package" && -n "$web_package" ]] || {
  echo "Server/web component package is missing" >&2
  exit 2
}
tar -xzf "$server_package" -C "$STAGE"
tar -xzf "$web_package" -C "$STAGE"
rm -rf "$STAGE/packages"

printf '%s\n' "AI Scientist offline platform" > "$STAGE/$MARKER"
if [[ -n "$BACKUP" ]]; then
  for item in projects logs .env; do
    if [[ -e "$BACKUP/$item" ]]; then
      rm -rf "$STAGE/$item"
      mv "$BACKUP/$item" "$STAGE/$item"
    fi
  done
fi

chmod +x "$STAGE/platform.sh"
mv "$STAGE" "$TARGET_DIR"
INSTALL_STAGE=""

# Install ADE only after the platform stage reaches its final path. The ADE
# installer embeds absolute Node paths, so it can safely share this platform's
# Node/npm runtime instead of extracting its own vendor copy.
install_offline_ade "$TARGET_DIR" "$TARGET_DIR/platform.env"
configure_root_ade_shell "$(env_value ADE_HOME "$TARGET_DIR/platform.env")"
install_all_ade_bootstrap_prompts "$TARGET_DIR" "$(env_value ADE_HOME "$TARGET_DIR/platform.env")"

if ! "$TARGET_DIR/platform.sh" start; then
  echo "New deployment failed to start; previous release kept at $BACKUP" >&2
  exit 3
fi

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$(awk -F= '/^KADY_FRONTEND_PORT=/{print $2}' "$TARGET_DIR/platform.env")/api/kady/health" >/dev/null 2>&1; then
    [[ -z "$BACKUP" ]] || rm -rf "$BACKUP"
    [[ ! -f "$TARGET_DIR/.ade-backup" ]] || rm -rf "$(cat "$TARGET_DIR/.ade-backup")"
    echo "Deployment healthy at $TARGET_DIR"
    exit 0
  fi
  sleep 1
done

echo "Deployment started but health check did not pass; previous release kept at $BACKUP" >&2
exit 4
