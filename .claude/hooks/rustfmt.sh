#!/usr/bin/env bash
# rustfmt.sh — PostToolUse hook
# 在 .rs 檔案編輯後自動執行 rustfmt 格式化
#
# Exit codes:
#   0 = 格式化成功或非 .rs 檔案（靜默）
#   1 = 格式化失敗（非阻斷，Claude 可看到錯誤）

set -uo pipefail

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

# 無 file_path → 靜默通過
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# 僅對 .rs 檔案觸發
case "$FILE_PATH" in
  *.rs) ;;
  *) exit 0 ;;
esac

# 確認檔案存在
if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

# 工具鏈不可用時靜默略過
command -v rustfmt >/dev/null 2>&1 || exit 0

# 執行 rustfmt
OUTPUT=$(rustfmt "$FILE_PATH" 2>&1) || true
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "❌ rustfmt 格式化失敗："
  echo "$OUTPUT"
  exit 1
fi

exit 0
