#!/usr/bin/env bash
# protect-config.sh — PreToolUse hook
# 保護設定檔和 lock 檔不被 Claude 意外修改
#
# Exit codes:
#   0 = 通過（可選 stdout 警告）
#   2 = hard block（stderr JSON 格式 block reason）

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

# 無 file_path → 靜默通過
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# 取檔名（同時處理 / 與 \ 路徑分隔；Windows 路徑用反斜線）
BASENAME=${FILE_PATH##*/}
BASENAME=${BASENAME##*\\}

# Lock 檔：hard block
case "$BASENAME" in
  Cargo.lock|pnpm-lock.yaml|package-lock.json|yarn.lock)
    echo '{"error":"Lock 檔由套件管理工具自動產生，禁止手動修改。請用 pnpm install 或 cargo build 更新。"}' >&2
    exit 2
    ;;
esac

# 設定檔：警告但不阻斷
case "$BASENAME" in
  tauri.conf.json)
    echo "⚠️ 你正在修改 tauri.conf.json — 這是 Tauri 核心設定檔，請確認變更必要性（視窗配置、CSP、capabilities）。"
    exit 0
    ;;
  Cargo.toml)
    echo "⚠️ 你正在修改 Cargo.toml — 新增/移除 crate 可能影響編譯和 binary size，請確認必要性。"
    exit 0
    ;;
esac

# 其他檔案：靜默通過
exit 0
