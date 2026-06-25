# SayIt — Copilot 指南

> Tauri v2 (Rust) + Vue 3 + TypeScript 語音轉書面語桌面工具。按住快捷鍵說話，放開後經 Whisper 轉錄 + LLM 整理為繁體中文書面語，貼入游標位置。Provider 可選 Groq（預設）/ OpenAI / Anthropic / Azure(Microsoft Foundry)。

本檔是精簡入口。**變更前先讀對應的權威文件**，其中規則優先於本檔：

| 文件 | 用途 |
|------|------|
| `CLAUDE.md` | 完整 IPC 契約表（Command/Event 參數與 Payload）、SQLite/命名慣例、最常違反禁忌 |
| `AGENTS.md` | 與本檔同源的總覽 |
| `_bmad-output/project-context.md` | 完整 323 條實作規則 |
| `docs/development-guide.md` | 本機開發、多檔協作任務 checklist、Pitfalls |
| `docs/api-contracts-backend.md` | 新增 Tauri Command / Event 的 checklist |
| `_bmad-output/planning-artifacts/ux-ui-design-spec.md` | UI 色彩 / 元件規範 |

## 指令

只用 **pnpm**（禁用 npm/yarn）。`Cargo.lock` / `pnpm-lock.yaml` 禁止手動修改。

```bash
pnpm install --frozen-lockfile   # 安裝
pnpm tauri dev                   # 開發：Vite(1420) HUD+Dashboard 雙 entry + Rust runtime
pnpm dev                         # 純前端（Tauri Command 會 timeout，僅改 UI 時用）
pnpm build                       # vue-tsc --noEmit && vite build（型別檢查 + 前端建置）
npx vue-tsc --noEmit             # 只跑型別檢查
pnpm exec eslint src             # ESLint（CI 用此指令，無 lint npm script；--fix 可自動修）
pnpm test                        # Vitest 單元 + 元件測試（tests/unit, tests/component）
pnpm test:e2e                    # Playwright E2E（tests/e2e，跑在 mock 過 Tauri 的 Vite dev server）
```

**跑單一測試：**

```bash
pnpm test enhancer                       # 跑檔名含 "enhancer" 的 Vitest 檔
pnpm exec vitest run -t "test 名稱片段"   # 依測試名稱過濾
cd src-tauri && cargo test find_monitor  # 跑特定 Rust 測試函式
cd src-tauri && cargo test --workspace   # 全部 Rust 測試
```

> 全套 vitest 在部分機器並行執行時會 flaky（環境時間暴增、5s timeout）；不穩時用 `pnpm exec vitest run --no-file-parallelism`。勿與 `cargo check`/`cargo test` 同時跑（CPU 競爭會拖垮 vitest）。

CI（`.github/workflows/ci.yml`）：`vue-tsc --noEmit` → `eslint src` → `pnpm test`；另在 macOS + Windows 跑 `cargo clippy --workspace --all-targets -- -D warnings` + `cargo test --workspace`。

## 架構大圖

**雙視窗，共用同一個 Rust backend**（兩個 HTML entry）：

- **HUD**（`index.html` → `App.vue` → `NotchHud.vue`，window label `main`）：透明、alwaysOnTop 狀態浮窗。
- **Dashboard**（`main-window.html` → `MainApp.vue` + Router，label `main-window`）：設定/歷史/字典/統計，預設隱藏，960x680。
- 視窗間溝通：Rust `emit()` 廣播事件；前端 → Rust 用 `invoke()`。也有「Frontend-only 事件」不經 Rust（如 `settings:updated`、`vocabulary:changed`）——清單見 `CLAUDE.md`。

**Rust backend** — `src-tauri/src/lib.rs` 用 `invoke_handler!` 註冊所有 command（**漏註冊 → 前端 invoke 會 timeout**）；功能切成 `src/plugins/*.rs`（`hotkey_listener`、`clipboard_paste`、`audio_recorder`、`transcription`、`keyboard_monitor`、`audio_control`、`text_field_reader`、`sound_feedback`、`azure_auth`、`logging`、`file_transfer`）。完整 IPC 契約見 `CLAUDE.md`。

**前端依賴方向（硬規則）：**

```
views/ ──→ components/ + stores/ + composables/
stores/ ──→ lib/
lib/   ──→ 外部 API（Groq / OpenAI / Anthropic / Azure Foundry）
```

- ❌ `views/` 不可直接 `import` `lib/`（一律經 Pinia store：`useSettingsStore` / `useHistoryStore` / `useVocabularyStore` / `useVoiceFlowStore`）。
- ❌ 元件不可直接執行 SQL（經 `src/lib/database.ts` + store）。

**網路信任邊界：** 前端 HTTP（chat 整理、連線測試、Entra token）走 `@tauri-apps/plugin-http`，受 `src-tauri/capabilities/default.json` allowlist + `tauri.conf.json` CSP `connect-src` 約束；Rust 的 `transcription.rs` / `azure_auth.rs` 用 `reqwest` 直連，**不**受該 allowlist 約束。

## 關鍵慣例（最常違反，違反會被 review 退回）

1. ❌ 瀏覽器原生 `fetch` → `import { fetch } from "@tauri-apps/plugin-http"`（否則 CORS）。
2. ❌ Options API / `defineComponent` → 一律 `<script setup lang="ts">`。
3. ❌ SQLite 存 API Key / Azure 憑證 → 只存 `tauri-plugin-store`，不進 DB。
4. ❌ Tailwind 原生色彩（`bg-zinc-900`、`text-white`）→ 用語意變數（`bg-card`、`text-foreground`、`border-border`）。
5. ❌ `@tabler/icons-vue` → 新程式碼 icon 只用 `lucide-vue-next`（既有 scaffold 殘留 tabler，勿擴大）。
6. ❌ 手寫 UI 元件（`<nav>`/原生 `<input>`/`<table>`）→ 用 shadcn-vue（new-york style，`src/components/ui/`）。Switch/Select/RadioGroup 綁定用 `:model-value` + `@update:model-value`（**不是** `:checked`）。
7. ❌ 直接 import Tauri event API → 經 `src/composables/useTauriEvents.ts` 封裝。
8. ❌ 假設 `invoke()` 錯誤是 `Error` 實例 → Rust 錯誤 enum 經 `serialize_str` 以**純字串** reject；錯誤比對一律先 `extractErrorMessage(err)` 正規化（見 `src/lib/errorUtils.ts`），勿包在 `error instanceof Error` 內。
9. 變更 IPC（Command/Event）後用 **`tauri-reviewer`** subagent 做 Rust↔Vue 雙端對齊審查。

**型別命名後綴：** `*Payload`（Event）、`*Record`（SQLite row）、`*Config`、`*Entry`、`*Dto`、`*Handle`。Vue 元件 PascalCase、常數 UPPER_SNAKE_CASE、資料夾 kebab-case。預設不寫註解，只在「為什麼非顯而易見」時加。

**SQLite 映射（`src/lib/database.ts`）：** 表名複數 snake_case；欄位 snake_case → TS camelCase 經 `mapRowToRecord()`；布林存 `INTEGER`（`row.x === 1`）；主鍵 `TEXT`（前端 `crypto.randomUUID()`）；參數語法 `$1, $2`。Migration 採遞增 `schema_version` 區塊 + `addColumnIfNotExists()`（冪等）。**❌ 絕不修改已部署的舊 migration，只追加 v(N+1)。** 注意：tauri-plugin-sql 無 connection affinity，跨 `execute()` 呼叫的 BEGIN/COMMIT 不安全。

## 多檔協作任務（細節見 `docs/development-guide.md` §4）

- **加 Tauri Command：** 寫 `plugins/<m>.rs` 的 `#[command]` → 在 `lib.rs` `invoke_handler!` 註冊 → 前端 `src/types/events.ts` 加 `*Payload` → `useTauriEvents.ts` 加常數。
- **加設定欄位：** `src/types/settings.ts` → `useSettingsStore.ts`（state + load/save）→ `SettingsView.vue`（shadcn-vue）→ 必要時 emit `settings:updated`。
- **加 LLM Provider：** `src/lib/llmProvider.ts`（型別 + `buildFetchParams` + `parseProviderResponse`）→ `modelRegistry.ts` → `capabilities/default.json`（http allowlist）→ `tauri.conf.json` CSP `connect-src`（**很容易漏**）。
- **加 i18n 字串：** `src/i18n/locales/` 五個語系（`zh-TW`, `zh-CN`, `en`, `ja`, `ko`）都要加。

## 平台與環境注意

- **Node 24**（`.nvmrc`）、**pnpm 10.28.2**（`corepack enable && corepack prepare`）、**Rust stable**。
- 改 `tauri.conf.json` / `Cargo.toml` 需審慎（`.claude/hooks/protect-config.sh` 會攔截/警告）。
- **CSP / 安全功能必須用 `pnpm tauri build --debug` 測**，dev mode 不受 CSP 影響。
- **Windows Copilot 鍵 `VK_F23`(0x86) 硬規則**：`hotkey_listener.rs` 低階鍵盤 hook 取出 `kbd` 後須立刻放行 F23，禁止開放為自訂熱鍵（見 `docs/adr-windows-vk-f23.md`）。macOS 本地 `cargo check` 不編譯 `#[cfg(target_os="windows")]` 區塊，Windows hook 須靠 CI/實機驗證。
- **macOS IPC binary**：`tauri::ipc::Response` raw bytes 走 JSON `number[]`，前端用 `new Uint8Array(raw)` 轉換。
- **轉錄 HTTP client 用 rustls**：`transcription.rs` `TranscriptionState::new()` 以 `.use_rustls_tls()` 建 reqwest；`Cargo.toml` reqwest features 須同時保留 `rustls-tls` **與** `rustls-tls-native-roots`（Windows native-tls/schannel 會截斷大型 multipart upload → Azure 回 HTTP 400）。Groq 與 Azure Whisper 共用此 client。
- **Azure Entra token 在 Rust 取得**：`plugins/azure_auth.rs` 的 `get_azure_entra_token`（reqwest，不帶 browser `Origin`，避免 `AADSTS9002326`）。scope 依 **API path** 選（`getAzureScopeForApiKind`，`src/lib/azureAuth.ts`）：v1 `/openai/v1/` chat → `ai.azure.com/.default`；deployments/Whisper 路徑 → `cognitiveservices.azure.com/.default`。
- **發版** `./scripts/release.sh X.Y.Z`：版本號須在 `git tag` / `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 四處一致；正式版 Sentry release 一律由 `release.yml` 產生（格式 `sayit@<version>`），勿手動上傳。

## 送 commit / PR 前

```
□ pnpm test               單元/元件測試通過
□ npx vue-tsc --noEmit    無型別錯誤
□ pnpm exec eslint src    ESLint 無錯
□ cargo check (src-tauri) Rust 編譯通過
□ 改 IPC → tauri-reviewer subagent 審查
□ 改 SQL schema → 寫 v(N+1) migration，不動舊 migration
```
