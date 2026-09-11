#!/bin/sh
# 重装 Nexus 到 dsh web profile（必须先停掉 dsh web，否则重启后仍是旧代码）。
# 用法：sh scripts/reinstall.sh
#   1) 停掉占用 3080 的进程（旧版 dsh web）
#   2) 先移除旧依赖再装当前版本（profile 里可能残留指向已删除 tarball 的依赖）
#   3) 打印启动与校验命令
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -e "console.log(require('$ROOT/package.json').version)")"
TGZ="$ROOT/dsh-nexus-$VERSION.tgz"
[ -f "$TGZ" ] || { echo "缺少安装包：$TGZ"; echo "先在仓库里跑：npm run build && npm pack"; exit 1; }

PID="$(lsof -nP -iTCP:3080 -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
if [ -n "$PID" ]; then
  echo "→ 停止旧版 dsh web（PID $PID）"
  kill "$PID" 2>/dev/null || true
  sleep 2
fi

echo "→ 移除旧依赖（失败可忽略：可能本来就不存在）"
dsh plugin --profile web remove @chenqiuyushuang/dsh-nexus >/dev/null 2>&1 || true

echo "→ 安装 Nexus $VERSION"
dsh plugin --profile web add "file:$TGZ"

echo ""
echo "✔ 安装完成。接下来："
echo "   1) 启动：dsh web    ← 打开终端里打印的带 token 地址"
echo "   2) 校验：cd \"$ROOT\" && npm run verify:install"
echo "   3) 设置 →「记忆」：顶部应出现「疑似无效记忆」横幅，列表约 6 行"