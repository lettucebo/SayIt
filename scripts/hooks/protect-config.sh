#!/usr/bin/env bash
# protect-config.sh — Copilot CLI preToolUse hook handler（Bash / macOS / Linux）
#
# 由 .github/hooks/protect-config.json 以 PascalCase PreToolUse + matcher "Edit|Write" 呼叫。
# 目的：阻擋直接修改 lockfile（Cargo.lock / pnpm-lock.yaml / package-lock.json / yarn.lock），
#       並對核心設定檔（tauri.conf.json / Cargo.toml）發出提醒但不阻擋。
#
# ⚠️ 定位：這是「避免誤改」的護欄，不是安全邊界——matcher 只涵蓋 Edit/Write 類工具，
#    shell 工具本來就不經過這個 hook。
#
# Payload 相容性：
#   - PascalCase 設定 → { "tool_name": "...", "tool_input": {...} }
#   - camelCase 設定  → { "toolName": "...",  "toolArgs":  {...} }
#   - freeform 工具（apply_patch / unified diff）→ 從 patch header 取目標路徑
#
# 判定順序（與 protect-config.ps1 一致）：
#   1. 蒐集候選路徑 = 明確 path 欄位 ∪ patch/diff header 路徑
#   2. 任一候選的 basename 是 lockfile → deny
#   3. tauri.conf.json / Cargo.toml → progress 提醒後放行
#   4. 候選為空、payload 為空，或候選含無法解析的 \uXXXX 跳脫 → fail-closed
#
# 輸出契約（GitHub Copilot hooks reference）：
#   - 阻擋：stdout 輸出 {"permissionDecision":"deny","permissionDecisionReason":"..."}，exit 0
#   - 提醒：stdout 輸出 {"type":"progress",...}（display-only，會被 CLI 消化掉），exit 0
#   - 一般檔：不輸出任何東西，exit 0 → 走預設權限流程（刻意不回 allow，避免繞過使用者授權）
#   - fail-closed：deny JSON + stderr 診斷 + exit 2（preToolUse 的 exit 2 一律視為 deny）

set -uo pipefail

LOCK_FILES_RE='^(cargo\.lock|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$'
UNRESOLVED_ESCAPE_RE='\\u[0-9a-fA-F]{4}'
WARN_TAURI_CONF='tauri.conf.json'
WARN_CARGO_TOML='cargo.toml'

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

emit_deny() {
  printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n' "$(json_escape "$1")"
  exit 0
}

emit_progress() {
  printf '{"type":"progress","message":"%s"}\n' "$(json_escape "$1")"
}

fail_closed() {
  printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n' "$(json_escape "$1")"
  printf 'protect-config: %s\n' "$1" >&2
  exit 2
}

# 同時處理 / 與 \ 分隔（Windows 路徑在 JSON 內是 \\，仍以最後一個反斜線切斷）
basename_of() {
  local p="${1##*/}"
  printf '%s' "${p##*\\}"
}

INPUT=$(cat 2>/dev/null)
if [[ -z "${INPUT//[[:space:]]/}" ]]; then
  fail_closed "protect-config 收到空的 hook payload，無法判斷目標檔案，依 fail-closed 原則阻擋。"
fi

# JSON 字串內容：允許 \\（跳脫反斜線，Windows 路徑）但在 \n 等跳脫序列前停下，
# 避免 patch header 把整段 patch 內容一起吃進來。
#
# patch/diff header 只掃「非內容欄位」：Edit/Write 的 old_str / new_str / file_text 等
# 是使用者要寫進檔案的文字，裡面出現 diff 範例（例如文件裡的 ```diff 區塊）不代表
# 真的要改 lockfile；把這些欄位的值先清空再掃，避免誤擋正常的文件編輯。
CONTENT_KEYS_RE='"(old_str|new_str|old_string|new_string|file_text|content|contents|text|body|message)"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"'

collect_candidates() {
  local scan_text
  scan_text=$(printf '%s' "$INPUT" | sed -E "s/$CONTENT_KEYS_RE/\"\\1\":\"\"/g")

  # 1) 明確 path 欄位（tool_input / toolArgs 共用同一組 key 名）
  #    收集「所有」匹配而非只取一個：內容欄位可能夾帶假的 path，任一個命中就阻擋。
  printf '%s' "$INPUT" \
    | grep -oE '"(file_path|filePath|path|file|notebook_path|target_file)"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' \
    | sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"//; s/"$//'
  # 2) apply_patch header（含 rename 目的地 *** Move to:）
  #    路徑允許 \\（Windows 路徑）與 \uXXXX（留待下方 fail-closed 檢查），但在 \n 前停下
  printf '%s' "$scan_text" \
    | grep -oE '\*\*\* (Add|Update|Delete) File: (\\\\|\\u[0-9a-fA-F]{4}|[^"\\])*' \
    | sed -E 's/^\*\*\* (Add|Update|Delete) File: //'
  printf '%s' "$scan_text" \
    | grep -oE '\*\*\* Move to: (\\\\|\\u[0-9a-fA-F]{4}|[^"\\])*' \
    | sed -E 's/^\*\*\* Move to: //'
  # 3) unified diff header
  printf '%s' "$scan_text" \
    | grep -oE '(\+\+\+|---) [ab]/(\\\\|\\u[0-9a-fA-F]{4}|[^"\\ ])*' \
    | sed -E 's#^(\+\+\+|---) [ab]/##'
}

CANDIDATES=$(collect_candidates 2>/dev/null || true)

if [[ -z "${CANDIDATES//[[:space:]]/}" ]]; then
  fail_closed "protect-config 無法從 payload 解析出目標檔案（既沒有 path 欄位也不是可辨識的 patch/diff），依 fail-closed 原則阻擋。"
fi

# ── 前置檢查：帶 \uXXXX 跳脫的路徑無法在不引入 JSON parser 的情況下可靠還原 → 保守阻擋 ──
while IFS= read -r candidate; do
  [[ -z "${candidate//[[:space:]]/}" ]] && continue
  if printf '%s' "$candidate" | grep -qE "$UNRESOLVED_ESCAPE_RE"; then
    fail_closed "protect-config 遇到含 \\uXXXX 跳脫序列的路徑（${candidate}），無法確認是否為 lockfile，依 fail-closed 原則阻擋。"
  fi
done <<<"$CANDIDATES"

WARN_MESSAGES=()
while IFS= read -r candidate; do
  [[ -z "${candidate//[[:space:]]/}" ]] && continue

  base=$(basename_of "$candidate")
  # Win32 會把尾端空白／句點與預設 ADS `::$DATA` 視為同一檔案別名。
  # Bash 版也做相同正規化，確保跨平台測試與 PowerShell 版一致。
  normalized_base=$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]')
  previous_base=''
  while [[ "$normalized_base" != "$previous_base" ]]; do
    previous_base=$normalized_base
    normalized_base=$(printf '%s' "$normalized_base" \
      | sed -e 's/[ .]*$//' -e 's/::\$data$//' -e 's/[ .]*$//')
  done
  if [[ "$normalized_base" =~ $LOCK_FILES_RE ]]; then
    emit_deny "禁止直接修改 lockfile（${base}）。Lock 檔由套件管理工具自動產生：請改用 pnpm install 或 cargo build 更新。"
  fi
  case "$normalized_base" in
    "$WARN_TAURI_CONF")
      WARN_MESSAGES+=("⚠️ 你正在修改 tauri.conf.json — 這是 Tauri 核心設定檔，請確認變更必要性（視窗配置、CSP、capabilities）。")
      ;;
    "$WARN_CARGO_TOML")
      WARN_MESSAGES+=("⚠️ 你正在修改 Cargo.toml — 新增/移除 crate 可能影響編譯和 binary size，請確認必要性。")
      ;;
  esac
done <<<"$CANDIDATES"

for message in ${WARN_MESSAGES+"${WARN_MESSAGES[@]}"}; do
  emit_progress "$message"
done

exit 0
