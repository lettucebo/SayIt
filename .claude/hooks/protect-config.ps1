# protect-config.ps1 — PreToolUse hook (Copilot CLI on Windows)
# Windows counterpart of protect-config.sh. Reads the hook JSON from stdin.
#   exit 2 = block (lock files); exit 0 = allow (optional warning on core config files).
# Uses [Environment]::Exit so the exact code propagates through: pwsh -Command "& (script)".
$ErrorActionPreference = 'SilentlyContinue'

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { [Environment]::Exit(0) }

$filePath = $null
try {
    $obj = $raw | ConvertFrom-Json
    if ($obj.tool_input) {
        if ($obj.tool_input.file_path) { $filePath = [string]$obj.tool_input.file_path }
        elseif ($obj.tool_input.path) { $filePath = [string]$obj.tool_input.path }
    }
} catch { }

if ([string]::IsNullOrWhiteSpace($filePath)) {
    if ($raw -match '"(?:file_path|path)"\s*:\s*"([^"]*)"') { $filePath = $matches[1] }
}
if ([string]::IsNullOrWhiteSpace($filePath)) { [Environment]::Exit(0) }

$base = $filePath -replace '.*[\\/]', ''

switch -Regex ($base) {
    '^(?:Cargo\.lock|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$' {
        [Console]::Error.WriteLine('{"error":"Lock 檔由套件管理工具自動產生，禁止手動修改。請用 pnpm install 或 cargo build 更新。"}')
        [Console]::Error.Flush()
        [Environment]::Exit(2)
    }
    '^tauri\.conf\.json$' {
        [Console]::Error.WriteLine('⚠️ 你正在修改 tauri.conf.json — 這是 Tauri 核心設定檔，請確認變更必要性（視窗配置、CSP、capabilities）。')
        [Environment]::Exit(0)
    }
    '^Cargo\.toml$' {
        [Console]::Error.WriteLine('⚠️ 你正在修改 Cargo.toml — 新增/移除 crate 可能影響編譯和 binary size，請確認必要性。')
        [Environment]::Exit(0)
    }
}
[Environment]::Exit(0)