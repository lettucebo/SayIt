#!/usr/bin/env bash
# eslint.sh — 選用的 ESLint 檢查 handler（非修改型，不帶 --fix）
#
# 這支腳本「沒有」被 .github/hooks/ 註冊為自動 hook：自動 --fix 會在使用者不知情下改動工作樹。
# 保留為可手動或在自訂 hook 設定中呼叫的檢查工具。
#
# 用法（兩種輸入方式皆可）：
#   scripts/hooks/eslint.sh src/lib/enhancer.ts           # 直接給檔案路徑
#   echo "$HOOK_JSON" | scripts/hooks/eslint.sh           # 讀 hook JSON（PascalCase / camelCase 皆可）
#
# Exit codes:
#   0 = 通過或非目標檔案
#   2 = 缺少目標檔案／檔案不存在／不在 Git repository
#   127 = pnpm/corepack 或 git 不可用
#   eslint 的原始 exit code = lint 失敗（不吞掉）

set -uo pipefail

FILE_PATH="${1:-}"

if [[ -z "$FILE_PATH" && ! -t 0 ]]; then
  INPUT=$(cat 2>/dev/null)
  if [[ -n "${INPUT//[[:space:]]/}" ]]; then
    FILE_PATH=$(printf '%s' "$INPUT" \
      | grep -oE '"(file_path|filePath|path)"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' \
      | head -1 \
      | sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//' || true)
  fi
fi

# 沒有可判斷的檔案 → 靜默通過
if [[ -z "${FILE_PATH//[[:space:]]/}" ]]; then
  echo "eslint: 請提供 .ts/.vue 檔案路徑，或從 stdin 傳入可解析的 hook JSON。" >&2
  exit 2
fi

# 僅對 .ts / .vue 檔案觸發
case "$FILE_PATH" in
  *.ts | *.vue) ;;
  *) exit 0 ;;
esac

# 跳過 shadcn-vue 生成元件（與 eslint.config.js 的 ignores 一致）
case "$FILE_PATH" in
  */components/ui/* | *\\components\\ui\\*) exit 0 ;;
esac

if [[ ! -f "$FILE_PATH" ]]; then
  echo "eslint: 找不到檔案：$FILE_PATH" >&2
  exit 2
fi

# 工具鏈不可用時明確失敗，避免手動驗證出現假綠燈
if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
else
  echo "eslint: 找不到 pnpm 或 corepack，未執行 ESLint。" >&2
  exit 127
fi
if ! command -v git >/dev/null 2>&1; then
  echo "eslint: 找不到 git，無法定位 repository root。" >&2
  exit 127
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "eslint: 目前位置不在 Git repository。" >&2
  exit 2
}

OUTPUT=$(cd "$REPO_ROOT" && "${PNPM[@]}" exec eslint "$FILE_PATH" 2>&1)
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "⚠️ eslint 發現問題（exit $EXIT_CODE）："
  printf '%s\n' "$OUTPUT" | head -20
  exit "$EXIT_CODE"
fi

exit 0
