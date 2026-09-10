#!/bin/bash
# Z-Score 供应商信用评估系统 —— 一键启动脚本
# 用法：./start-zscore.sh
# 特点：脱离终端后台运行，关闭终端窗口也不会中断服务

set -e

# 自动定位：脚本所在目录即仓库根，web 工程在其下的 zscore-web/
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$REPO_DIR/zscore-web"
LOG_FILE="/tmp/zscore-dev.log"
PORT=3000

# 若已在运行则直接提示
if lsof -ti :$PORT > /dev/null 2>&1; then
  echo "服务已在运行 → http://localhost:$PORT"
  exit 0
fi

# 清理上次异常退出残留的锁文件
# Next.js 开发模式若被强制关闭（或终端被回收），会残留 .next/dev/lock，
# 导致下次启动自动改用 3001 等其它端口，用户按 3000 访问就会失败。
LOCK_FILE="$WEB_DIR/.next/dev/lock"
if [ -f "$LOCK_FILE" ]; then
  echo "清理上次残留的锁文件：$LOCK_FILE"
  rm -f "$LOCK_FILE"
fi

cd "$WEB_DIR"
nohup ./node_modules/.bin/next dev > "$LOG_FILE" 2>&1 &
disown

# 等待就绪（最多 30 秒）
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://localhost:$PORT/ 2>/dev/null; then
    echo "启动成功 → http://localhost:$PORT"
    echo "日志文件：$LOG_FILE"
    exit 0
  fi
  sleep 1
done

echo "启动超时，请查看日志：$LOG_FILE"
tail -20 "$LOG_FILE"
exit 1
