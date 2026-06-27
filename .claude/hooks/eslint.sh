#!/usr/bin/env bash
# eslint.sh — PostToolUse hook
# 在 .ts/.vue 檔案編輯後自動執行 eslint --fix
#
# Exit codes:
#   0 = lint 通過或非目標檔案（靜默）
#   1 = lint 錯誤（非阻斷，Claude 可看到錯誤並自行修正）

set -uo pipefail

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

# 無 file_path → 靜默通過
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# 僅對 .ts / .vue 檔案觸發
case "$FILE_PATH" in
  *.ts|*.vue) ;;
  *) exit 0 ;;
esac

# 跳過 shadcn-vue 生成元件
case "$FILE_PATH" in
  */components/ui/*) exit 0 ;;
esac

# 確認檔案存在
if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

# 工具鏈不可用時靜默略過
command -v npx >/dev/null 2>&1 || exit 0

# 執行 eslint --fix
OUTPUT=$(npx eslint --fix "$FILE_PATH" 2>&1) || true
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "⚠️ eslint 發現問題："
  echo "$OUTPUT" | head -20
  exit 1
fi

exit 0
