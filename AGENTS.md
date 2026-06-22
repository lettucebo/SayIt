# SayIt — AGENTS.md（AI Agent 指南）

> Tauri v2 (Rust) + Vue 3 + TypeScript 語音轉書面語桌面工具。按住快捷鍵說話，放開後經 Whisper 轉錄 + LLM 整理為繁體中文書面語，貼入游標位置。Provider 可選 Groq（預設）/ OpenAI / Anthropic / Azure(Microsoft Foundry)。

**權威規則文件（變更前請先讀對應檔）：**

| 文件 | 用途 |
|------|------|
| `CLAUDE.md` | IPC 契約表、最常違反禁忌、命名/SQLite 慣例（必讀總覽） |
| `_bmad-output/project-context.md` | 完整 323 條實作規則 |
| `docs/development-guide.md` | 本機開發、常見任務 checklist、Pitfalls |
| `docs/api-contracts-backend.md` | 新增 Tauri Command / Event 的 checklist |
| `_bmad-output/planning-artifacts/ux-ui-design-spec.md` | UI 色彩 / 元件規範 |

## 指令

```bash
pnpm install --frozen-lockfile   # 安裝（只用 pnpm，禁用 npm/yarn）
pnpm tauri dev                   # 開發：Vite(1420) HUD+Dashboard 雙 entry + Rust runtime
pnpm dev                         # 純前端（Tauri Command 會 timeout，僅改 UI 時用）
pnpm build                       # vue-tsc --noEmit && vite build
npx vue-tsc --noEmit             # 型別檢查
pnpm exec eslint src             # ESLint（CI 用此指令；--fix 可自動修）
pnpm test                        # Vitest unit + component（tests/unit, tests/component）
pnpm test:e2e                    # Playwright E2E（tests/e2e）
```

**跑單一測試：**

```bash
pnpm test enhancer                       # 跑檔名含 "enhancer" 的 Vitest 檔
pnpm exec vitest run -t "test 名稱片段"   # 依測試名稱過濾
cd src-tauri && cargo test find_monitor  # 跑特定 Rust 測試函式
cd src-tauri && cargo test --workspace   # 全部 Rust 測試
```

CI（`.github/workflows/ci.yml`）跑：`vue-tsc --noEmit` → `eslint src` → `pnpm test`，另在 macOS+Windows 跑 `cargo clippy --all-targets -- -D warnings` + `cargo test`。沒有 `lint` npm script。

## 架構大圖

**雙視窗** — 兩個 HTML entry 共用同一個 Rust backend：
- **HUD**（`index.html` → `App.vue` → `NotchHud.vue`，label `main`）：400x100 透明、alwaysOnTop 狀態浮窗。
- **Dashboard**（`main-window.html` → `MainApp.vue` + Router，label `main-window`）：960x680 設定/歷史/字典/統計，預設隱藏。
- 視窗間以 Rust `emit()` 廣播事件溝通，前端→Rust 用 `invoke()`。

**前端依賴方向（硬規則）：** `views/ → components/ + stores/ + composables/`；`stores/ → lib/`；`lib/ → 外部 API`。
- ❌ `views/` 不可直接 `import` `lib/`（一律經 Pinia store）。
- ❌ 元件不可直接執行 SQL（經 `lib/database.ts` + store）。

**Rust backend** — `src-tauri/src/lib.rs` 註冊所有 command；功能切成 `src/plugins/*.rs`（`hotkey_listener`、`clipboard_paste`、`audio_recorder`、`transcription`、`keyboard_monitor`、`audio_control`、`text_field_reader`、`sound_feedback`、`azure_auth`）。完整 IPC 契約（命令參數/回傳、事件名與 Payload）見 `CLAUDE.md`。

**網路信任邊界：** 前端 HTTP（chat 整理、連線測試、Entra token）走 `@tauri-apps/plugin-http`，受 `capabilities/default.json` allowlist + CSP `connect-src` 約束；Rust 的 `transcription.rs` / `azure_auth.rs` 用 `reqwest` 直連，**不**受該 allowlist 約束。

## 關鍵慣例（最常違反）

1. ❌ 瀏覽器原生 `fetch` → 用 `import { fetch } from "@tauri-apps/plugin-http"`（否則 CORS）。
2. ❌ Options API / `defineComponent` → 一律 `<script setup lang="ts">`。
3. ❌ SQLite 存 API Key → API Key 只存 `tauri-plugin-store`，不進 DB。
4. ❌ Tailwind 原生色彩（`bg-zinc-900`、`text-white`）→ 用語意變數（`bg-card`、`text-foreground`、`border-border`）。
5. ❌ `@tabler/icons-vue` → 新程式碼 icon 只用 `lucide-vue-next`（少數既有 dashboard scaffold 元件仍殘留 tabler，勿擴大使用）。
6. ❌ 手寫 UI 元件（`<nav>`/原生 `<input>`/`<table>`）→ 用 shadcn-vue（new-york style，`src/components/ui/`）。Switch/Select/RadioGroup 用 `:model-value` + `@update:model-value`（不是 `:checked`）。
7. ❌ 直接 import Tauri event API → 經 `src/composables/useTauriEvents.ts` 封裝。
8. 變更 IPC（Command/Event）後用 `tauri-reviewer` subagent 雙端對齊審查。
9. ❌ 假設 `invoke()` 的錯誤是 `Error` 實例 → Rust 錯誤 enum 經 `serialize_str` 以「純字串」reject；前端錯誤對應一律先 `extractErrorMessage(err)` 正規化再比對（見 `src/lib/errorUtils.ts`），勿把比對包在 `error instanceof Error` 內。

**型別命名後綴：** `*Payload`（Event）、`*Record`（SQLite row）、`*Config`、`*Entry`、`*Dto`、`*Handle`。Vue 元件 PascalCase、常數 UPPER_SNAKE_CASE、資料夾 kebab-case。預設不寫註解，只在「為什麼非顯而易見」時加。

**SQLite 映射（`src/lib/database.ts`）：** 表名複數 snake_case；欄位 snake_case → TS camelCase 經 `mapRowToRecord()`；布林存 `INTEGER`（`row.x === 1`）；主鍵 `TEXT`（前端 `crypto.randomUUID()`）；參數語法 `$1, $2`。Migration 採遞增 `schema_version` 區塊 + `addColumnIfNotExists()`（冪等）。**❌ 絕不修改已部署的舊 migration，只追加下一版。**

## 多檔協作任務（細節見 `docs/development-guide.md` §4）

- **加 Tauri Command：** 寫 `plugins/<m>.rs` 的 `#[command]` → 在 `lib.rs` `invoke_handler!` 註冊（漏註冊會 timeout）→ 前端 `src/types/events.ts` 加 `*Payload` → `useTauriEvents.ts` 加常數。
- **加設定欄位：** `src/types/settings.ts` → `useSettingsStore.ts`（state + load/save）→ `SettingsView.vue`（shadcn-vue）→ 必要時 emit `settings:updated`。
- **加 LLM Provider：** `src/lib/llmProvider.ts`（型別 + `buildFetchParams` + `parseProviderResponse`）→ `modelRegistry.ts` → `src-tauri/capabilities/default.json`（http allowlist）→ `src-tauri/tauri.conf.json` CSP `connect-src`（**很容易漏**）。
- **加 i18n 字串：** `src/i18n/locales/` 五個語系（zh-TW, zh-CN, en, ja, ko）都要加。

## 平台與環境注意

- **Node 24**（`.nvmrc`）、**pnpm 10.28.2**（`corepack enable && corepack prepare`）、**Rust stable**。
- **`Cargo.lock` / `pnpm-lock.yaml` 禁止手動修改**；改 `tauri.conf.json` / `Cargo.toml` 需審慎（`.claude/hooks/protect-config.sh` 會攔截/警告）。
- **CSP / 安全功能必須用 `pnpm tauri build --debug` 測**，dev mode 不受 CSP 影響。
- **Windows Copilot 鍵 `VK_F23`(0x86) 硬規則**：`hotkey_listener.rs` 的低階鍵盤 hook 必須放行 F23，禁止開放為自訂熱鍵（見 `docs/adr-windows-vk-f23.md`）。macOS 本地 `cargo check` 不編譯 `#[cfg(target_os="windows")]` 區塊，Windows hook 須靠 CI/實機驗證。
- **macOS IPC binary**：`tauri::ipc::Response` raw bytes 走 JSON `number[]`，前端用 `new Uint8Array(raw)` 轉換。
- **轉錄 HTTP client 用 rustls**：`transcription.rs` `TranscriptionState::new()` 以 `.use_rustls_tls()` 建 reqwest，`Cargo.toml` reqwest features 須同時保留 `rustls-tls` **與** `rustls-tls-native-roots`。Windows native-tls/schannel 會截斷大型（>~64KB）multipart upload → Azure 回 HTTP 400「Unexpected end of Stream」；`rustls-tls-native-roots` 讓 rustls 仍信任 OS 憑證庫（企業 TLS proxy / 自簽 CA）。此 client 同時供 Groq 與 Azure Whisper 共用。
- **Azure Entra token 在 Rust 取得**：`plugins/azure_auth.rs` 的 `get_azure_entra_token`（reqwest，不帶 browser `Origin`），避免 WebView fetch 觸發 `AADSTS9002326`。scope 依 **API path** 選（`getAzureScopeForApiKind`，`src/lib/azureAuth.ts`）：v1 `/openai/v1/` → `ai.azure.com/.default`；legacy deployments 路徑 → `cognitiveservices.azure.com/.default`。Azure 設定/憑證只存 `tauri-plugin-store`，不進 SQLite。
- **發版** `./scripts/release.sh X.Y.Z`：版本號須在 `git tag` / `package.json` / `tauri.conf.json` / `Cargo.toml` 四處一致；正式版 Sentry release 一律由 `release.yml` 產生（格式 `sayit@<version>`）。

## Pre-commit Checklist

```
□ pnpm test               單元/元件測試通過
□ npx vue-tsc --noEmit    無型別錯誤
□ pnpm exec eslint src    ESLint 無錯
□ cargo check (src-tauri) Rust 編譯通過
□ 改 IPC → tauri-reviewer subagent 審查
□ 改 SQL schema → 寫 v(N+1) migration，不動舊 migration
```
