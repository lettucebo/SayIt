#!/usr/bin/env bash
# rustfmt.sh — 選用的 Rust 格式檢查 handler（非修改型，用 --check 而非就地改寫）
#
# 這支腳本「沒有」被 .github/hooks/ 註冊為自動 hook：自動格式化會在使用者不知情下改動工作樹。
# 保留為可手動或在自訂 hook 設定中呼叫的檢查工具。
#
# 用法（兩種輸入方式皆可）：
#   scripts/hooks/rustfmt.sh src-tauri/src/lib.rs         # 直接給檔案路徑
#   echo "$HOOK_JSON" | scripts/hooks/rustfmt.sh          # 讀 hook JSON（PascalCase / camelCase 皆可）
#
# Exit codes:
#   0 = 格式正確或非 .rs 檔案
#   2 = 缺少目標檔案／檔案不存在
#   127 = rustfmt 不可用
#   rustfmt 的原始 exit code = 格式不符或執行失敗（不吞掉）

set -uo pipefail

RUST_EDITION="2021"

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
  echo "rustfmt: 請提供 .rs 檔案路徑，或從 stdin 傳入可解析的 hook JSON。" >&2
  exit 2
fi

# 僅對 .rs 檔案觸發
case "$FILE_PATH" in
  *.rs) ;;
  *) exit 0 ;;
esac

if [[ ! -f "$FILE_PATH" ]]; then
  echo "rustfmt: 找不到檔案：$FILE_PATH" >&2
  exit 2
fi

# 工具鏈不可用時明確失敗，避免手動驗證出現假綠燈
if ! command -v rustfmt >/dev/null 2>&1; then
  echo "rustfmt: 找不到 rustfmt，未執行格式檢查。" >&2
  exit 127
fi

# --check：只回報差異，不改寫工作樹（edition 必須與 src-tauri/Cargo.toml 一致）
OUTPUT=$(rustfmt --check --edition "$RUST_EDITION" "$FILE_PATH" 2>&1)
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "❌ rustfmt 格式檢查未通過（exit $EXIT_CODE）— 請執行 cargo fmt --manifest-path src-tauri/Cargo.toml："
  printf '%s\n' "$OUTPUT" | head -30
  exit "$EXIT_CODE"
fi

exit 0
