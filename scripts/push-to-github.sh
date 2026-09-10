#!/bin/bash
# scripts/push-to-github.sh —— 将本地已提交的 Z-Score 仓库推送到 GitHub
#
# 前置（必须先在 GitHub 网页完成）：
#   1. 打开 https://github.com/new
#   2. 仓库名：zscore-supplier-risk
#   3. 可见性：Public
#   4. **不要勾选** "Add a README file" / "Add .gitignore" / "Choose a license"
#      （这些会与本地提交冲突，需先在本地做初始提交再推）
#   5. 点 "Create repository"
#
# 认证（二选一）：
#   A) SSH（推荐）：先把本机 SSH 公钥添加到 GitHub → https://github.com/settings/keys
#      公钥查看：cat ~/.ssh/id_ed25519.pub   （没有则 ssh-keygen -t ed25519 生成）
#   B) HTTPS：需要 GitHub Personal Access Token (PAT)
#      生成：https://github.com/settings/tokens  勾选 "repo" 权限
#      推送时把 PAT 当密码粘贴即可（git 不会保存）
#
# 用法：
#   ./scripts/push-to-github.sh
#   或
#   ./scripts/push-to-github.sh --ssh    # 用 SSH 地址
#   ./scripts/push-to-github.sh --https  # 用 HTTPS 地址（默认）
#
# 推送成功后：访问 https://github.com/Peterolll/zscore-supplier-risk 即可

set -e

REPO="zscore-supplier-risk"
OWNER="Peterolll"
PROTO="https"

while [ $# -gt 0 ]; do
  case "$1" in
    --ssh)   PROTO="ssh";   shift ;;
    --https) PROTO="https"; shift ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

if [ "$PROTO" = "ssh" ]; then
  REMOTE="git@github.com:${OWNER}/${REPO}.git"
else
  REMOTE="https://github.com/${OWNER}/${REPO}.git"
fi

# 检查本地是否有待推送的提交
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "✗ 本地没有提交。请先在仓库根目录执行：git add -A && git commit -m '...'"
  exit 1
fi

# 确认仓库在根目录（package.json 存在）
if [ ! -f zscore-web/package.json ] && [ ! -f package.json ]; then
  echo "✗ 当前不在 Z-Score 仓库根目录（找不到 zscore-web/ 或 package.json）"
  exit 1
fi

# 确认关键安全项未被跟踪
for f in zscore_pipeline/.glm_key zscore-web/data/zscore.db zscore-web/uploads/ zscore_pipeline/output/ .workbuddy/; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "✗ 安全风险：$f 被错误跟踪！请检查 .gitignore"
    exit 1
  fi
done

# 设置/更新 remote
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
else
  git remote add origin "$REMOTE"
fi

# 确保默认分支为 main
git branch -M main 2>/dev/null || true

echo "→ 推送到 $REMOTE (分支: main)"
git push -u origin main
echo ""
echo "✓ 完成 → https://github.com/${OWNER}/${REPO}"
