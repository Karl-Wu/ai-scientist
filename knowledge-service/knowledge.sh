#!/usr/bin/env bash
set -euo pipefail

operation=${1:-}
if [[ $# != 1 || ( "$operation" != start && "$operation" != stop ) ]]; then
    printf '用法: %s {start|stop}\n' "$0" >&2
    exit 2
fi

service_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
cd "$service_dir"
umask 077
runtime_dir=${KADY_KB_RUN_DIR:-"$service_dir/.runtime"}
mkdir -p -- "$runtime_dir"
runtime_dir=$(cd -- "$runtime_dir" && pwd -P)
pid_file="$runtime_dir/knowledge.pid"
log_file="$runtime_dir/knowledge.log"
lock_dir="$runtime_dir/control.lock"
starting_pid=

read_pid() {
    if [[ -f "$pid_file" ]]; then
        cat -- "$pid_file"
    fi
}

is_service() {
    local pid=$1 command
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
    command=$(ps -ww -p "$pid" -o command= 2>/dev/null) || return 1
    [[ "$command" == *" $service_dir/cli.mjs serve --pid-file $pid_file" ]]
}

cleanup() {
    if [[ -n "$starting_pid" ]] && is_service "$starting_pid"; then
        kill -TERM "$starting_pid" 2>/dev/null || true
    fi
    rmdir -- "$lock_dir"
}

if ! mkdir -- "$lock_dir" 2>/dev/null; then
    printf '无法获取专病知识库的操作锁。请稍后重试。\n' >&2
    exit 1
fi
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

pid=$(read_pid)
if [[ "$operation" == start ]]; then
    if is_service "$pid"; then
        printf '专病知识库已在运行，PID %s。\n' "$pid"
        exit 0
    fi

    if ! command -v node >/dev/null; then
        printf '需要 Node.js 22.19 或更新版本。\n' >&2
        exit 1
    fi
    if [[ -z "${KADY_KB_TOKEN:-}" ]]; then
        printf '请先设置 KADY_KB_TOKEN。\n' >&2
        exit 1
    fi

    rm -f -- "$pid_file"
    nohup node "$service_dir/cli.mjs" serve --pid-file "$pid_file" </dev/null >>"$log_file" 2>&1 &
    starting_pid=$!
    for ((attempt = 0; attempt < 100; attempt++)); do
        if [[ "$(read_pid)" == "$starting_pid" ]] && is_service "$starting_pid"; then
            printf '专病知识库已启动，PID %s。日志 %s\n' "$starting_pid" "$log_file"
            starting_pid=
            exit 0
        fi
        if ! kill -0 "$starting_pid" 2>/dev/null; then
            break
        fi
        sleep 0.1
    done
    printf '专病知识库启动失败，请查看日志 %s\n' "$log_file" >&2
    exit 1
fi

if ! is_service "$pid"; then
    rm -f -- "$pid_file"
    printf '专病知识库未运行。\n'
    exit 0
fi

if ! kill -TERM "$pid" 2>/dev/null && is_service "$pid"; then
    printf '无法向专病知识库进程 %s 发送停止信号。\n' "$pid" >&2
    exit 1
fi
for ((attempt = 0; attempt < 125; attempt++)); do
    if ! is_service "$pid"; then
        rm -f -- "$pid_file"
        printf '专病知识库已停止。\n'
        exit 0
    fi
    sleep 0.2
done
printf '专病知识库仍在退出，PID %s。请查看日志 %s\n' "$pid" "$log_file" >&2
exit 1
