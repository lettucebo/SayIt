# protect-config.ps1 — Copilot CLI preToolUse hook handler（PowerShell / Windows）
#
# 由 .github/hooks/protect-config.json 以 PascalCase PreToolUse + matcher "Edit|Write" 呼叫，
# 是 protect-config.sh 的 Windows 對應版本，判定結果必須等價。
#
# ⚠️ 定位：這是「避免誤改」的護欄，不是安全邊界——matcher 只涵蓋 Edit/Write 類工具，
#    shell 工具本來就不經過這個 hook。
#
# Payload 相容性：
#   - PascalCase 設定 → { "tool_name": "...", "tool_input": {...} }
#   - camelCase 設定  → { "toolName": "...",  "toolArgs":  {...} }
#   - freeform 工具（apply_patch / unified diff）→ 從 patch header 取目標路徑
#
# 判定順序（與 protect-config.sh 一致）：
#   1. 蒐集候選路徑 = 明確 path 欄位 ∪ patch/diff header 路徑
#   2. 任一候選的 basename 是 lockfile → deny
#   3. tauri.conf.json / Cargo.toml → progress 提醒後放行
#   4. 候選為空、payload 為空，或候選含無法解析的 \uXXXX 跳脫 → fail-closed
#
# 輸出契約（GitHub Copilot hooks reference）：
#   - 阻擋：stdout 輸出 {"permissionDecision":"deny","permissionDecisionReason":"..."}，exit 0
#   - 提醒：stdout 輸出 {"type":"progress",...}（display-only），exit 0
#   - 一般檔：不輸出任何東西，exit 0 → 走預設權限流程（刻意不回 allow）
#   - fail-closed：deny JSON + stderr 診斷 + exit 2（preToolUse 的 exit 2 一律視為 deny）
#
# 用 [Environment]::Exit 讓 exit code 能穿過 `pwsh -Command "& (script)"` 傳回去。

$ErrorActionPreference = 'Stop'

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
    # 某些 host（重導向 stdin/stdout）不允許設定 encoding，忽略即可
}

$LockFiles = @('Cargo.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock')
$PathKeys = @('file_path', 'filePath', 'path', 'file', 'notebook_path', 'target_file')
$UnresolvedEscapePattern = '\\u[0-9a-fA-F]{4}'

function Write-Json {
    param([hashtable] $Payload)
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Payload -Compress -Depth 5))
    [Console]::Out.Flush()
}

function Deny-Tool {
    param([string] $Reason)
    Write-Json @{ permissionDecision = 'deny'; permissionDecisionReason = $Reason }
    [Environment]::Exit(0)
}

function Fail-Closed {
    param([string] $Reason)
    Write-Json @{ permissionDecision = 'deny'; permissionDecisionReason = $Reason }
    [Console]::Error.WriteLine("protect-config: $Reason")
    [Console]::Error.Flush()
    [Environment]::Exit(2)
}

# 同時處理 / 與 \ 分隔（Windows 路徑在 JSON 內是 \\，仍以最後一個分隔符切斷）
function Get-BaseName {
    param([string] $PathValue)
    return ($PathValue -replace '.*[\\/]', '')
}

function Get-NormalizedBaseName {
    param([string] $PathValue)
    $base = Get-BaseName $PathValue
    do {
        $previous = $base
        $base = $base.TrimEnd(' ', '.')
        $base = $base -replace '(?i)::\$DATA$', ''
        $base = $base.TrimEnd(' ', '.')
    } while ($base -ne $previous)
    return $base
}

# 從已解析的物件遞迴收集路徑欄位（ConvertFrom-Json 已還原跳脫序列）
function Get-PathCandidate {
    param($Node, [int] $Depth = 0)
    $found = @()
    if ($null -eq $Node -or $Depth -gt 8) { return $found }
    if ($Node -is [string]) { return $found }
    if ($Node -is [System.Collections.IEnumerable]) {
        foreach ($item in $Node) { $found += Get-PathCandidate -Node $item -Depth ($Depth + 1) }
        return $found
    }
    if ($Node.PSObject -and $Node.PSObject.Properties) {
        foreach ($prop in $Node.PSObject.Properties) {
            if ($PathKeys -contains $prop.Name -and $prop.Value -is [string]) {
                $found += [string]$prop.Value
            } elseif ($prop.Value -isnot [string]) {
                $found += Get-PathCandidate -Node $prop.Value -Depth ($Depth + 1)
            }
        }
    }
    return $found
}

try {
    $raw = [Console]::In.ReadToEnd()
} catch {
    Fail-Closed 'protect-config 無法讀取 hook payload（stdin），依 fail-closed 原則阻擋。'
}

if ([string]::IsNullOrWhiteSpace($raw)) {
    Fail-Closed 'protect-config 收到空的 hook payload，無法判斷目標檔案，依 fail-closed 原則阻擋。'
}

# ── 1. 明確 path 欄位：先用 JSON 解析（跳脫已還原），失敗或漏抓時退回原文正則 ──
$candidates = @()
try {
    $payload = $raw | ConvertFrom-Json
    $toolArgs = $null
    if ($null -ne $payload.tool_input) { $toolArgs = $payload.tool_input }
    elseif ($null -ne $payload.toolArgs) { $toolArgs = $payload.toolArgs }
    elseif ($null -ne $payload.tool_args) { $toolArgs = $payload.tool_args }

    if ($null -ne $toolArgs -and $toolArgs -isnot [string]) {
        $candidates += Get-PathCandidate -Node $toolArgs
    }
} catch {
    # JSON 解析失敗 → 只靠下面的原文正則，不直接放行
}

# 原文正則：涵蓋 JSON 解析失敗、非預期巢狀、以及內容夾帶的假 path
# JSON 字串內容允許 \\（Windows 路徑），在 \n 等跳脫序列前停下。
$rawPathPattern = '"(?:' + ($PathKeys -join '|') + ')"\s*:\s*"((?:[^"\\]|\\.)*)"'
foreach ($m in [regex]::Matches($raw, $rawPathPattern)) {
    $candidates += $m.Groups[1].Value
}

# ── 2. patch / diff header（含 rename 目的地 *** Move to:） ────────────────
# 只掃「非內容欄位」：Edit/Write 的 old_str / new_str / file_text 等是要寫進檔案的文字，
# 裡面出現 diff 範例（例如文件裡的 ```diff 區塊）不代表真的要改 lockfile。
$contentKeysPattern = '"(old_str|new_str|old_string|new_string|file_text|content|contents|text|body|message)"\s*:\s*"(?:[^"\\]|\\.)*"'
$scanText = [regex]::Replace($raw, $contentKeysPattern, '"$1":""')

# 路徑允許 \\（Windows 路徑）與 \uXXXX（留待下方 fail-closed 檢查），但在 \n 前停下
foreach ($m in [regex]::Matches($scanText, '\*\*\* (?:Add|Update|Delete) File: ((?:\\\\|\\u[0-9a-fA-F]{4}|[^"\\])*)')) {
    $candidates += $m.Groups[1].Value.Trim()
}
foreach ($m in [regex]::Matches($scanText, '\*\*\* Move to: ((?:\\\\|\\u[0-9a-fA-F]{4}|[^"\\])*)')) {
    $candidates += $m.Groups[1].Value.Trim()
}
foreach ($m in [regex]::Matches($scanText, '(?:\+\+\+|---) [ab]/((?:\\\\|\\u[0-9a-fA-F]{4}|[^"\\ ])*)')) {
    $candidates += $m.Groups[1].Value.Trim()
}

$candidates = @($candidates | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

# ── 3. 完全找不到目標檔案 → fail-closed ───────────────────────────────────
if ($candidates.Count -eq 0) {
    Fail-Closed 'protect-config 無法從 payload 解析出目標檔案（既沒有 path 欄位也不是可辨識的 patch/diff），依 fail-closed 原則阻擋。'
}

# ── 4. 前置檢查：帶 \uXXXX 跳脫的路徑無法確認目標 → 保守阻擋（與 Bash 版一致） ──
foreach ($candidate in $candidates) {
    if ([regex]::IsMatch([string]$candidate, $UnresolvedEscapePattern)) {
        Fail-Closed "protect-config 遇到含 \uXXXX 跳脫序列的路徑（$candidate），無法確認是否為 lockfile，依 fail-closed 原則阻擋。"
    }
}

# ── 5. 逐一判定 ───────────────────────────────────────────────────────────
$warnings = @()
foreach ($candidate in $candidates) {
    $value = [string]$candidate
    $base = Get-NormalizedBaseName $value
    if ($LockFiles -contains $base) {
        Deny-Tool "禁止直接修改 lockfile（$base）。Lock 檔由套件管理工具自動產生：請改用 pnpm install 或 cargo build 更新。"
    }
    if ($base -eq 'tauri.conf.json') {
        $warnings += '⚠️ 你正在修改 tauri.conf.json — 這是 Tauri 核心設定檔，請確認變更必要性（視窗配置、CSP、capabilities）。'
    } elseif ($base -eq 'Cargo.toml') {
        $warnings += '⚠️ 你正在修改 Cargo.toml — 新增/移除 crate 可能影響編譯和 binary size，請確認必要性。'
    }
}

foreach ($warning in ($warnings | Select-Object -Unique)) {
    Write-Json @{ type = 'progress'; message = $warning }
}

[Environment]::Exit(0)
