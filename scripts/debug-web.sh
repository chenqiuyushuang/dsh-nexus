#!/usr/bin/env bash
# 起一个独立的调试实例：workspace 内的 DSH_HOME + 独立端口 + 打开带 token 的地址。
# 与用户的 3080 实例完全隔离（自己的 store / 会话 / 日志）。
# 用法：scripts/debug-web.sh [端口，默认 3199] [--no-open]
set -euo pipefail
PORT="${1:-3199}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="$ROOT/_dsh_test"
LOG="$ROOT/_shots/debugserver.log"
mkdir -p "$HOME_DIR/profiles" "$ROOT/_shots"
# 首次：从用户的 web profile 复制一份（含依赖），并装上当前 tarball
if [ ! -d "$HOME_DIR/profiles/web" ]; then
  echo "[debug-web] 初始化 $HOME_DIR（从 ~/.dsh/profiles/web 复制）"
  cp -R "$HOME/.dsh/profiles/web" "$HOME_DIR/profiles/web"
fi

# 把最新的 tarball 热替换进调试 profile（不跑 pnpm，避免 store 版本不一致）
TGZ=$(ls -t "$ROOT"/dsh-nexus-*.tgz 2>/dev/null | head -1 || true)
if [ -n "$TGZ" ]; then
  TARGET="$HOME_DIR/profiles/web/node_modules/@chenqiuyushuang/dsh-nexus"
  TMP=$(mktemp -d)
  tar xzf "$TGZ" -C "$TMP"
  rm -rf "$TARGET" && mkdir -p "$TARGET"
  cp -R "$TMP/package/." "$TARGET/"
  rm -rf "$TMP"
  echo "[debug-web] 已装 $(basename "$TGZ")"
fi

echo "[debug-web] 端口 $PORT，日志 $LOG"
DSH_HOME="$HOME_DIR" dsh web --port "$PORT" --no-open > "$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
for i in $(seq 1 40); do
  URL=$(grep -o 'http://127.0.0.1:'"$PORT"'/?token=[A-Za-z0-9_-]*' "$LOG" 2>/dev/null | head -1 || true)
  [ -n "$URL" ] && break
  sleep 0.5
done
if [ -z "${URL:-}" ]; then echo "[debug-web] 启动失败，见 $LOG"; exit 1; fi
echo "[debug-web] $URL"
if [ "${2:-}" != "--no-open" ]; then open "$URL"; fi
wait $SERVER_PID