#!/usr/bin/env bash
# typecheck.sh — PostToolUse hook
# 在 .ts/.vue 檔案編輯後自動執行 vue-tsc 型別檢查
#
# Exit codes:
#   0 = 型別檢查通過（靜默）
#   1 = 型別錯誤（非阻斷，Claude 可看到錯誤並自行修正）

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

# 排除測試檔案和型別定義檔（避免不必要的檢查）
case "$FILE_PATH" in
  *.test.ts|*.spec.ts|*.d.ts) exit 0 ;;
esac

# 工具鏈不可用時靜默略過（例如 WSL bash 找不到 npx）
command -v npx >/dev/null 2>&1 || exit 0

# 執行 vue-tsc 型別檢查
OUTPUT=$(npx vue-tsc --noEmit 2>&1 | head -30) || true
EXIT_CODE=${PIPESTATUS[0]}

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "❌ vue-tsc 型別檢查失敗："
  echo "$OUTPUT"
  exit 1
fi

# 型別檢查通過 → 靜默
exit 0
