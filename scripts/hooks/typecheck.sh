#!/usr/bin/env bash
# typecheck.sh — 選用的 TypeScript 型別檢查 handler（非修改型）
#
# 這支腳本「沒有」被 .github/hooks/ 註冊為自動 hook：每次編輯都跑 vue-tsc 太昂貴。
# 保留為可手動或在自訂 hook 設定中呼叫的檢查工具。
#
# 用法（兩種輸入方式皆可）：
#   scripts/hooks/typecheck.sh src/lib/enhancer.ts        # 直接給檔案路徑
#   echo "$HOOK_JSON" | scripts/hooks/typecheck.sh        # 讀 hook JSON（PascalCase / camelCase 皆可）
#
# Exit codes:
#   0 = 通過或非目標檔案
#   2 = 缺少目標檔案／不在 Git repository
#   127 = pnpm/corepack 或 git 不可用
#   vue-tsc 的原始 exit code = 型別檢查失敗（不吞掉）

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
  echo "typecheck: 請提供 .ts/.vue 檔案路徑，或從 stdin 傳入可解析的 hook JSON。" >&2
  exit 2
fi

# 僅對 .ts / .vue 檔案觸發
case "$FILE_PATH" in
  *.ts | *.vue) ;;
  *) exit 0 ;;
esac

# 排除測試檔案和型別定義檔（避免不必要的檢查）
case "$FILE_PATH" in
  *.test.ts | *.spec.ts | *.d.ts) exit 0 ;;
esac

# 工具鏈不可用時靜默略過（例如 WSL bash 找不到 pnpm）
if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
else
  echo "typecheck: 找不到 pnpm 或 corepack，未執行型別檢查。" >&2
  exit 127
fi
if ! command -v git >/dev/null 2>&1; then
  echo "typecheck: 找不到 git，無法定位 repository root。" >&2
  exit 127
fi

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "typecheck: 目前位置不在 Git repository。" >&2
  exit 2
}
cd "$REPO_ROOT" || exit 2

# vue-tsc 是全專案檢查，沒有單檔模式；輸出保留原始 exit code
OUTPUT=$("${PNPM[@]}" exec vue-tsc --noEmit 2>&1)
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "❌ vue-tsc 型別檢查失敗（exit $EXIT_CODE）："
  printf '%s\n' "$OUTPUT" | head -30
  exit "$EXIT_CODE"
fi

exit 0
