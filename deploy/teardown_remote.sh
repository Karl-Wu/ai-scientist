#!/usr/bin/env bash
# Remove an AI Scientist + ADE installation from a Linux host.
#
# Idempotent: paths that are already gone are skipped. Only the explicit
# whitelist below is touched (no wildcard deletes outside /data).
set -u

AI_DIRS=(
  /data/ai-scientist
  /data/ai-scientist-new
  /data/ai-scientist-offline-0.15.0-linux-x64
  /data/ai-scientist-0.15.0-linux-x64.tar.gz
)
ADE_DIRS=(
  /data/ade /data/ade2 /data/ade3 /data/ade4 /data/ade5
  /data/ade-offline-0.1.0-linux-x86_64-py3.12
  /data/ade-offline-0.1.0-linux-x86_64-py3.12.tar.gz
)
STATE_DIRS=(/root/.kady)

echo "== 1. stopping processes"
pids="$(ps -eo pid,args | awk '$2 ~ /^\/(data)\/(ai-scientist|ade)[^ ]*\// {print $1}')"
if [[ -n "$pids" ]]; then
  kill -TERM $pids 2>/dev/null
  sleep 3
  pids="$(ps -eo pid,args | awk '$2 ~ /^\/(data)\/(ai-scientist|ade)[^ ]*\// {print $1}')"
  [[ -n "$pids" ]] && kill -KILL $pids 2>/dev/null
fi
# Frontend is launched as `node server.mjs` with cwd inside the install dir.
pkill -TERM -f '/data/ai-scientist[^ ]*/web/server.mjs' 2>/dev/null
sleep 1

echo "== 2. removing installation directories"
for d in "${AI_DIRS[@]}" "${ADE_DIRS[@]}" "${STATE_DIRS[@]}"; do
  if [[ -e "$d" ]]; then
    echo "   rm -rf $d ($(du -sh "$d" 2>/dev/null | awk '{print $1}'))"
    rm -rf -- "$d"
  fi
done

echo "== 3. removing CLI symlinks"
for link in /usr/local/bin/ade /root/.local/bin/ade; do
  [[ -L "$link" || -f "$link" ]] && rm -f -- "$link" && echo "   removed $link"
done

echo "== 4. removing shell integration"
rm -f /etc/profile.d/ai-scientist-ade.sh

if grep -q '^# AI Scientist ADE runtime$' /root/.bashrc 2>/dev/null; then
  cp /root/.bashrc /root/.bashrc.kady-cleanup.bak
  awk '
    $0 == "# AI Scientist ADE runtime" { skip = 1 }
    skip && /^export PATH$/ { skip = 0; next }
    !skip { print }
  ' /root/.bashrc.kady-cleanup.bak > /root/.bashrc
  if bash -n /root/.bashrc; then
    rm -f /root/.bashrc.kady-cleanup.bak
    echo "   removed ADE block from /root/.bashrc"
  else
    mv /root/.bashrc.kady-cleanup.bak /root/.bashrc
    echo "   ! bashrc edit failed syntax check; restored original"
  fi
fi

echo "== 5. removing leftovers"
rm -rf /tmp/kady-skills-clone-* /tmp/kady-remote-deploy.sh /tmp/kady-platform.env \
  /tmp/ai-scientist2-remote-install-fixed.sh /tmp/ai-scientist-*.tar.gz 2>/dev/null

echo "== 6. verification"
echo "-- remaining processes:"
ps -eo pid,args | grep -E '/data/(ai-scientist|ade)' | grep -v grep || echo "   none"
echo "-- remaining paths:"
ls -d /data/ai-scientist* /data/ade* /root/.kady 2>/dev/null || echo "   none"
echo "-- ports 9018/8000/8001:"
ss -lntp 2>/dev/null | grep -E ':(9018|8000|8001)\s' || echo "   none"
echo "-- leftover ade references in shell config:"
grep -rn '/data/ade' /root/.bashrc /etc/profile.d 2>/dev/null || echo "   none"
echo "== done"
