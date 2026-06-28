# SayIt — AGENTS.md（AI Agent 唯一指南）

> Tauri v2 (Rust) + Vue 3 + TypeScript 語音轉書面語桌面工具。按住快捷鍵說話，放開後經 Whisper 轉錄 + LLM 整理為繁體中文書面語，貼入游標位置。Provider 可選 Groq（預設）/ OpenAI / Anthropic / Azure(Microsoft Foundry)。

> 📌 **本檔是唯一權威 AI agent 指南**（已整合舊 `CLAUDE.md` 與 `.github/copilot-instructions.md`）。本檔規則優先；更深層細節見下表權威文件。

每當你有任何的方案建議，都要提出每個方案的優點、缺點以及你的建議。

**權威文件（變更前請先讀對應檔，其中規則優先於概述）：**

| 文件 | 用途 |
|------|------|
| `_bmad-output/project-context.md` | 完整 323 條實作規則 |
| `docs/development-guide.md` | 本機開發、多檔協作任務 checklist、Pitfalls |
| `docs/api-contracts-backend.md` | 新增 Tauri Command / Event 的 checklist |
| `_bmad-output/planning-artifacts/ux-ui-design-spec.md` | UI 色彩 / 元件規範 |
| `_bmad-output/planning-artifacts/architecture.md` | 架構決策文件 |
| `design.pen` | Pencil MCP 設計稿（UI 實作前必須先完成） |

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
pnpm test:coverage               # 覆蓋率報告
./scripts/release.sh X.Y.Z       # 發版（更新版本號 + tag + push）
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

```
 ┌─────────────────────────────────────────────────┐
 │                  Tauri Backend (Rust)            │
 │  lib.rs ─ plugins/ ─ clipboard_paste.rs          │
 │                      hotkey_listener.rs          │
 │                      keyboard_monitor.rs …       │
 │  ┌─── invoke() ──┐     ┌─── emit() ────┐         │
 │  ▼               ▼     ▼               ▼         │
 │ ┌──────────┐  ┌──────────────────────────┐       │
 │ │   HUD    │  │      Dashboard           │       │
 │ │ index.   │  │   main-window.html       │       │
 │ │ html     │  │   MainApp.vue + Router   │       │
 │ │ App.vue  │  │   4 views + DB + Store   │       │
 │ │ NotchHud │  │   shadcn-vue UI          │       │
 │ └──────────┘  └──────────────────────────┘       │
 │  label:main    label:main-window                 │
 │  400x100       960x680 (min 720x480)             │
 │  transparent   decorations, resizable            │
 │  alwaysOnTop   預設隱藏                          │
 └─────────────────────────────────────────────────┘
```

- **HUD**（`index.html` → `App.vue` → `NotchHud.vue`，window label `main`）：透明、alwaysOnTop 狀態浮窗。
- **Dashboard**（`main-window.html` → `MainApp.vue` + Router，label `main-window`）：設定/歷史/字典/統計，預設隱藏，960x680。
- 視窗間溝通：Rust `emit()` 廣播事件；前端 → Rust 用 `invoke()`。也有「Frontend-only 事件」不經 Rust（清單見下方 IPC 契約表）。

**Rust backend** — `src-tauri/src/lib.rs` 用 `generate_handler!` 註冊所有 command（**漏註冊 → 前端 invoke 會 timeout**）；功能切成 `src/plugins/*.rs`（`hotkey_listener`、`clipboard_paste`、`audio_recorder`、`transcription`、`keyboard_monitor`、`audio_control`、`text_field_reader`、`sound_feedback`、`azure_auth`、`logging`、`file_transfer`）。

**前端依賴方向（硬規則）：**

```
  views/ ──→ components/ + stores/ + composables/
  stores/ ──→ lib/
  lib/   ──→ 外部 API（Groq / OpenAI / Anthropic / Azure Foundry）

  ❌ views/ 不可直接 import lib/（一律經 Pinia store：useSettingsStore / useHistoryStore / useVocabularyStore / useVoiceFlowStore）
  ❌ 元件不可直接執行 SQL（經 src/lib/database.ts + store）
```

**網路信任邊界：** 前端 HTTP（chat 整理、連線測試、Entra token）走 `@tauri-apps/plugin-http`，受 `src-tauri/capabilities/default.json` allowlist + `tauri.conf.json` CSP `connect-src` 約束；Rust 的 `transcription.rs` / `azure_auth.rs` 用 `reqwest` 直連，**不**受該 allowlist 約束。

## IPC 契約表

### Tauri Commands（Frontend → Rust）

| Command | Rust 位置 | 前端呼叫點 | 參數 | 回傳 |
|---------|-----------|-----------|------|------|
| `request_app_restart` | `lib.rs` | main-window.ts | — | `()` |
| `update_hotkey_config` | `lib.rs` | useSettingsStore | `trigger_key: TriggerKey, trigger_mode: TriggerMode` | `Result<(), String>` |
| `get_hud_target_position` | `lib.rs` | — | `app: AppHandle` | `Result<HudTargetPosition, String>` |
| `set_file_logging_enabled` | `plugins/logging.rs` | useSettingsStore, logger.ts | `enabled: bool` | `()` |
| `open_log_folder` | `plugins/logging.rs` | logger.ts（SettingsView） | — | `Result<(), String>` |
| `cleanup_old_logs` | `plugins/logging.rs` | main-window.ts | `days: u32, app: AppHandle` | `Result<Vec<String>, String>` |
| `mute_system_audio` | `plugins/audio_control.rs` | useVoiceFlowStore | `state: State<AudioControlState>` | `Result<(), String>` |
| `restore_system_audio` | `plugins/audio_control.rs` | useVoiceFlowStore | `state: State<AudioControlState>` | `Result<(), String>` |
| `paste_text` | `plugins/clipboard_paste.rs` | useVoiceFlowStore | `text: String` | `Result<(), ClipboardError>` |
| `copy_to_clipboard` | `plugins/clipboard_paste.rs` | HistoryView | `text: String` | `Result<(), ClipboardError>` |
| `capture_target_window` | `plugins/clipboard_paste.rs` | useVoiceFlowStore | — | `()` |
| `check_accessibility_permission_command` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | — | `bool` |
| `open_accessibility_settings` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | — | `Result<(), String>` |
| `reinitialize_hotkey_listener` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | `app: AppHandle` | `Result<(), String>` |
| `reset_hotkey_state` | `plugins/hotkey_listener.rs` | useVoiceFlowStore | `state: State<HotkeyListenerState>` | `()` |
| `start_hotkey_recording` | `plugins/hotkey_listener.rs` | SettingsView | `state: State<HotkeyListenerState>` | `()` |
| `cancel_hotkey_recording` | `plugins/hotkey_listener.rs` | SettingsView | `state: State<HotkeyListenerState>` | `()` |
| `start_quality_monitor` | `plugins/keyboard_monitor.rs` | useVoiceFlowStore | `app: AppHandle` | `()` |
| `start_correction_monitor` | `plugins/keyboard_monitor.rs` | useVoiceFlowStore | `app: AppHandle` | `()` |
| `read_focused_text_field` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `Result<Option<String>, String>` |
| `read_selected_text` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `Result<Option<String>, String>` |
| `get_default_input_device_name` | `plugins/audio_recorder.rs` | SettingsView | — | `Option<String>` |
| `list_audio_input_devices` | `plugins/audio_recorder.rs` | SettingsView | — | `Vec<AudioInputDeviceInfo>` |
| `start_audio_preview` | `plugins/audio_recorder.rs` | SettingsView | `app, preview_state: State<AudioPreviewState>, device_name: String` | `Result<(), String>` |
| `stop_audio_preview` | `plugins/audio_recorder.rs` | SettingsView | `preview_state: State<AudioPreviewState>` | `()` |
| `start_recording` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `app, state: State<AudioRecorderState>, device_name: String` | `Result<(), AudioRecorderError>` |
| `stop_recording` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `state: State<AudioRecorderState>` | `Result<StopRecordingResult, AudioRecorderError>` |
| `save_recording_file` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `id: String, app, state: State<AudioRecorderState>` | `Result<String, String>` |
| `read_recording_file` | `plugins/audio_recorder.rs` | HistoryView | `id: String, app: AppHandle` | `Result<Response, String>` |
| `delete_all_recordings` | `plugins/audio_recorder.rs` | SettingsView | `app: AppHandle` | `Result<u32, String>` |
| `cleanup_old_recordings` | `plugins/audio_recorder.rs` | main-window.ts | `days: u32, app: AppHandle` | `Result<Vec<String>, String>` |
| `transcribe_audio` | `plugins/transcription.rs` | useVoiceFlowStore | `state, transcription_state, api_key, vocabulary_term_list?, model_id?, language?, provider?, endpoint?, deployment?, api_version?, auth_mode?` | `Result<TranscriptionResult, TranscriptionError>` |
| `retranscribe_from_file` | `plugins/transcription.rs` | useVoiceFlowStore | `file_path, api_key, vocabulary_term_list?, model_id?, language?, provider?, endpoint?, deployment?, api_version?, auth_mode?` | `Result<TranscriptionResult, TranscriptionError>` |
| `test_whisper_connection` | `plugins/transcription.rs` | connectionTest.ts（SettingsView） | `transcription_state, api_key, model_id?, provider?, endpoint?, deployment?, api_version?, auth_mode?` | `Result<(), TranscriptionError>` |
| `get_azure_entra_token` | `plugins/azure_auth.rs` | azureAuth.ts（getAzureAccessToken） | `tenant_id, client_id, client_secret, scope` | `Result<AzureTokenResult, String>`（`{ accessToken, expiresIn }`） |
| `save_text_file` | `plugins/file_transfer.rs` | SettingsView（備份匯出） | `path: String, content: String` | `Result<(), String>` |
| `read_text_file` | `plugins/file_transfer.rs` | SettingsView（備份匯入） | `path: String` | `Result<String, String>`（過大回符號錯誤字串 `"FILE_TOO_LARGE"`） |
| `play_start_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()` |
| `play_stop_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()` |
| `play_error_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()` |
| `play_learned_sound` | `plugins/sound_feedback.rs` | NotchHud.vue | — | `()` |

### Rust → Frontend Events

| Event | Rust 發送點 | 常量 | Payload |
|-------|------------|------|---------|
| `hotkey:pressed` | hotkey_listener.rs | `HOTKEY_PRESSED` | `HotkeyEventPayload` |
| `hotkey:released` | hotkey_listener.rs | `HOTKEY_RELEASED` | `HotkeyEventPayload` |
| `hotkey:toggled` | hotkey_listener.rs | `HOTKEY_TOGGLED` | `HotkeyEventPayload` |
| `hotkey:error` | hotkey_listener.rs | `HOTKEY_ERROR` | `HotkeyErrorPayload` |
| `hotkey:mode-toggle` | hotkey_listener.rs | `HOTKEY_MODE_TOGGLE` | `()` |
| `escape:pressed` | hotkey_listener.rs | `ESCAPE_PRESSED` | `()` |
| `hotkey:recording-captured` | hotkey_listener.rs | `HOTKEY_RECORDING_CAPTURED` | `RecordingCapturedPayload` |
| `hotkey:recording-rejected` | hotkey_listener.rs | `HOTKEY_RECORDING_REJECTED` | `RecordingRejectedPayload` |
| `quality-monitor:result` | keyboard_monitor.rs | `QUALITY_MONITOR_RESULT` | `QualityMonitorResultPayload` |
| `correction-monitor:result` | keyboard_monitor.rs | `CORRECTION_MONITOR_RESULT` | `CorrectionMonitorResultPayload` |
| `audio:waveform` | audio_recorder.rs | `AUDIO_WAVEFORM` | `WaveformPayload { levels: [f32; 6] }` |
| `audio:preview-level` | audio_recorder.rs | `AUDIO_PREVIEW_LEVEL` | `AudioPreviewLevelPayload { level: f32 }` |

### Frontend-only Events（不經 Rust）

| Event | 常量 | 發送方 | 接收方 |
|-------|------|--------|--------|
| `voice-flow:state-changed` | `VOICE_FLOW_STATE_CHANGED` | HUD VoiceFlow | Dashboard |
| `transcription:completed` | `TRANSCRIPTION_COMPLETED` | VoiceFlow | Main Window |
| `settings:updated` | `SETTINGS_UPDATED` | SettingsStore | All Windows |
| `vocabulary:changed` | `VOCABULARY_CHANGED` | VocabularyStore | All Windows |
| `vocabulary:learned` | `VOCABULARY_LEARNED` | VoiceFlowStore | HUD NotchHud |
| `database:ready` | `DATABASE_READY` | Dashboard（main-window.ts，DB migration 完成後） | HUD（App.vue / waitForDatabaseReady） |
| `database:ready-ping` | `DATABASE_READY_PING` | HUD（請 Dashboard 重新廣播，解決競態） | Dashboard（收到後 replay `database:ready`） |

> 變更 IPC（Command/Event）後，用 **`ipc-review` / `tauri-reviewer` subagent** 做 Rust↔Vue 雙端對齊審查（Command 註冊、Event 名稱、Payload 型別）。

## 關鍵慣例（最常違反，違反會被 review 退回）

1. ❌ 瀏覽器原生 `fetch` → `import { fetch } from "@tauri-apps/plugin-http"`（否則 CORS）。
2. ❌ Options API / `defineComponent` → 一律 `<script setup lang="ts">`。
3. ❌ SQLite 存 API Key / Azure 憑證 → 只存 `tauri-plugin-store`，不進 DB。
4. ❌ Tailwind 原生色彩（`bg-zinc-900`、`text-white`）→ 用語意變數（`bg-card`、`text-foreground`、`border-border`）。
5. ❌ `@tabler/icons-vue` → 新程式碼 icon 只用 `lucide-vue-next`（既有 scaffold 殘留 tabler，勿擴大）。
6. ❌ 手寫 UI 元件（`<nav>`/原生 `<input>`/`<table>`）→ 用 shadcn-vue（new-york style，`src/components/ui/`）。
7. ❌ 直接 import Tauri event API → 經 `src/composables/useTauriEvents.ts` 封裝。
8. ❌ 假設 `invoke()` 錯誤是 `Error` 實例 → Rust 錯誤 enum 經 `serialize_str` 以**純字串** reject；錯誤比對一律先 `extractErrorMessage(err)` 正規化（見 `src/lib/errorUtils.ts`），勿包在 `error instanceof Error` 內。
9. ❌ 未經設計直接實作 UI → 先用 Pencil MCP 完成 `design.pen` 設計稿，再寫程式碼。
10. 變更 IPC（Command/Event）後用 **`tauri-reviewer`** subagent 做 Rust↔Vue 雙端對齊審查。

## shadcn-vue 元件使用規則

### 禁止手寫替代品

| 需求 | ❌ 禁止 | ✅ 必須使用 |
|------|--------|-----------|
| 側邊欄 | 手寫 `<nav>` | `SidebarProvider` + `Sidebar` + `SidebarMenu` 等 |
| 側邊欄切換 | 自訂 emit + ref | `SidebarTrigger`（內建 `toggleSidebar()`） |
| 可點擊元素 | 原生 `<button>` + 手寫樣式 | `<Button>` + variant prop |
| 表單輸入 | 原生 `<input>` / `<select>` / `<textarea>` | `Input` / `Select` / `Textarea` |
| 表格 | 原生 `<table>` | `Table` + `TableHeader` + `TableBody` 等 |
| 開關 | 原生 checkbox | `Switch` |
| 選項組 | 原生 `<input type="radio">` | `RadioGroup` + `RadioGroupItem` |

### 元件 API 規範

- **variant 優先**：用 `variant="destructive"` 而非 `class="text-destructive border-destructive"`。
- **Switch / Select / RadioGroup 綁定**：`:model-value` + `@update:model-value`（**不是** `:checked`）。RadioGroup payload 型別為 `AcceptableValue`（需 runtime narrowing）。
- **Label 無障礙**：Label 必須加 `for`，對應控制項加 `id`。
- **Badge variant**：用 `variant="secondary"` 等 prop，不用 class 覆蓋整套樣式。
- **RouterLink 在 Menu 中**：`<SidebarMenuButton as-child>` 包裹 `<RouterLink>`。
- 語意色彩優先（`bg-card` / `text-foreground` / `border-border`）；覆蓋元件樣式只微調 padding/size，不覆蓋核心色彩。

## 型別命名慣例

| 後綴 | 用途 | 範例 |
|------|------|------|
| `*Payload` | Tauri Event payload | `VoiceFlowStateChangedPayload` |
| `*Record` | SQLite 資料行 | `TranscriptionRecord` |
| `*Config` | 設定物件 | `HotkeyConfig` |
| `*Entry` | 字典/列表項目 | `VocabularyEntry` |
| `*Dto` | Store 間傳遞 | — |
| `*Handle` | 資源控制 | `AudioAnalyserHandle` |

Vue 元件 PascalCase、常數 UPPER_SNAKE_CASE、資料夾 kebab-case。預設不寫註解，只在「為什麼非顯而易見」時加。

## SQLite 映射規則（`src/lib/database.ts`）

- 表名：複數 snake_case（`transcriptions`）。
- 欄位：snake_case（`raw_text`）→ TS camelCase（`rawText`）via `mapRowToRecord()`。
- 布林：`INTEGER` → `row.was_enhanced === 1`；null 布林 → `row.was_modified === null ? null : row.was_modified === 1`。
- 主鍵：`TEXT`（UUID，前端 `crypto.randomUUID()`）；參數語法 `$1, $2`（tauri-plugin-sql）。
- Migration：採遞增 `schema_version` 區塊 + `addColumnIfNotExists()`（冪等）。**❌ 絕不修改已部署的舊 migration，只追加 v(N+1)。**
- ⚠️ tauri-plugin-sql 無 connection affinity，跨 `execute()` 呼叫的 BEGIN/COMMIT 不安全（COMMIT 可能命中無交易的連線）。
- 執行期 DB：`%APPDATA%\com.sayit.app\app.db`（WAL 模式）；真 e2e/資料驗證須停掉 App 後直接查詢。

## 多檔協作任務（細節見 `docs/development-guide.md` §4）

- **加 Tauri Command：** 寫 `plugins/<m>.rs` 的 `#[command]` → 在 `lib.rs` `generate_handler!` 註冊（漏註冊會 timeout）→ 前端 `src/types/events.ts` 加 `*Payload` → `useTauriEvents.ts` 加常數。
- **加設定欄位：** `src/types/settings.ts` → `useSettingsStore.ts`（state + load/save）→ `SettingsView.vue`（shadcn-vue）→ 必要時 emit `settings:updated`。
- **加 LLM Provider：** `src/lib/llmProvider.ts`（型別 + `buildFetchParams` + `parseProviderResponse`）→ `modelRegistry.ts` → `src-tauri/capabilities/default.json`（http allowlist）→ `src-tauri/tauri.conf.json` CSP `connect-src`（**很容易漏**）。
- **加 i18n 字串：** `src/i18n/locales/` 五個語系（`zh-TW`, `zh-CN`, `en`, `ja`, `ko`）都要加。

## 自動更新機制

- **定時檢查** — `main-window.ts`：啟動 5 秒後首次檢查，之後每 4 小時（`setInterval`）。
- **手動檢查** — `MainApp.vue` Sidebar Footer「檢查更新」按鈕，結果用 `useFeedbackMessage` 顯示。
- **回傳型別** — `checkForAppUpdate()` → `Promise<UpdateCheckResult>`（`up-to-date` | `update-available` | `error`）。
- **已知限制** — `autoUpdater.ts` 中 `window.confirm` 在 Tauri WKWebView 會被靜默忽略，未來需改用 in-app UI。

## Azure / Microsoft Foundry Provider

- **Chat（LLM 整理）** — provider `"azure"`，走 Azure OpenAI v1 端點 `{endpoint}/openai/v1/chat/completions`（OpenAI 線相容，同路徑也能接 Foundry 上的 Grok/DeepSeek）。`buildFetchParams("azure", …, azureOptions)` 在 `llmProvider.ts`。
- **Whisper（轉錄）** — `whisperProviderId = "azure"` 時走 Rust `transcription.rs`：`{endpoint}/openai/deployments/{deployment}/audio/transcriptions?api-version=…`，保留 `verbose_json`/`no_speech_prob`。
- **驗證** — API Key（`api-key` header）或 **Entra ID（client credentials）**（`Authorization: Bearer`）。token 由 **Rust** `plugins/azure_auth.rs` 的 `get_azure_entra_token` 取得（reqwest，不帶 browser `Origin`，避免 `AADSTS9002326`），快取在 `src/lib/azureAuth.ts`。
- **scope 依 API 路徑（非 host）選**（`getAzureScopeForApiKind`，`src/lib/azureAuth.ts`）：v1 `/openai/v1/` chat → `ai.azure.com/.default`；deployments/Whisper 路徑 → `cognitiveservices.azure.com/.default`。
- **設定解析** — `useSettingsStore` 的 `getLlmRequestConfig()` / `getWhisperRequestConfig()`（皆 async，Entra 需換 token）。設定（endpoint/authMode/key 或 tenant+client+secret/部署名）存 `tauri-plugin-store`，**不進 SQLite**。
- **allowlist/CSP** — `capabilities/default.json` + `tauri.conf.json` 已加 `*.openai.azure.com`、`*.services.ai.azure.com`、`*.cognitiveservices.azure.com`、`login.microsoftonline.com`。

## 測試慣例（細節見 `tests/README.md`）

- **分層**：`tests/unit/`（純邏輯 / service / types）、`tests/component/`（Vue 元件，jsdom）、`tests/e2e/`（Playwright）；共用程式在 `tests/support/{fixtures,helpers,factories}`。vitest 只收 `tests/unit/**` + `tests/component/**`（見 `vitest.config.ts`）。
- **用 factory 產資料，禁止 hardcoded**：`createTranscriptionRecord()` / `createVocabularyEntry()`（`@faker-js/faker`，`tests/support/factories`），可帶覆寫物件，避免 parallel 衝突。
- **E2E 用 `data-testid` selector**，勿用 CSS class（Tailwind 一改就壞）；`test`/`expect` 從 `tests/support/fixtures` import。E2E 首次需 `npx playwright install chromium`。E2E 跑在 mock 過 Tauri 的 Vite dev server（localhost:1420），**碰不到真 tauri-plugin-sql**；要驗真 DB/匯入須用 `pnpm tauri dev`。
- **測試名稱**加 priority tag `[P0]`–`[P3]`，檔名 `feature-name.test.ts`。
- **禁止**：`page.waitForTimeout()`（用 event-based wait）、`if (await el.isVisible())`（測試須 deterministic）、跨測試共用狀態。

## 自動化 Hooks（`.claude/settings.json`）

| Hook | 觸發時機 | 行為 |
|------|---------|------|
| `protect-config.sh` | PreToolUse（Edit\|Write） | 🔴 攔截 lock 檔修改、🟡 警告 config 檔修改 |
| `typecheck.sh` | PostToolUse（Edit\|Write） | 編輯 .ts/.vue 後自動跑 `vue-tsc --noEmit`（非阻斷） |
| `rustfmt.sh` | PostToolUse（Edit\|Write） | 編輯 .rs 後自動 `rustfmt`（非阻斷） |
| `eslint.sh` | PostToolUse（Edit\|Write） | 編輯 .ts/.vue 後自動 `eslint --fix`（跳過 `components/ui/`） |

保護檔案：`Cargo.lock` / `pnpm-lock.yaml` 🔴 Hard block；`tauri.conf.json` / `Cargo.toml` 🟡 警告。

## 平台與環境注意

- **Node 24**（`.nvmrc`）、**pnpm 10.28.2**（`corepack enable && corepack prepare`）、**Rust stable**。
- **`Cargo.lock` / `pnpm-lock.yaml` 禁止手動修改**；改 `tauri.conf.json` / `Cargo.toml` 需審慎（`.claude/hooks/protect-config.sh` 會攔截/警告）。
- **CSP / 安全功能必須用 `pnpm tauri build --debug` 測**，dev mode 不受 CSP 影響。
- **Windows Copilot 鍵 `VK_F23`(0x86) 硬規則**：`hotkey_listener.rs` 低階鍵盤 hook 取出 `kbd` 後須立刻放行 F23（`if kbd.vkCode == VK_F23 { return CallNextHookEx(...); }`），禁止開放為自訂熱鍵（見 `docs/adr-windows-vk-f23.md`）。macOS 本地 `cargo check` 不編譯 `#[cfg(target_os="windows")]` 區塊，Windows hook 須靠 CI/實機驗證。
- **`windows` crate 0.61**：`AttachThreadInput` 從 `Win32::UI::Input::KeyboardAndMouse` 搬到 `Win32::System::Threading`（Cargo.toml features 需含 `Win32_System_Threading`）；`BOOL` 是 `windows::core::BOOL`，UI Automation 需 feature `Win32_UI_Accessibility`。
- **macOS IPC binary**：`tauri::ipc::Response` raw bytes 走 JSON `number[]`，前端用 `new Uint8Array(raw)` 轉換。`convertFileSrc` 產生 `asset://localhost/`，但 CSP `media-src` 需 `http://asset.localhost`；偏好 Rust IPC + Blob URL 繞過。
- **轉錄 HTTP client 用 rustls**：`transcription.rs` `TranscriptionState::new()` 以 `.use_rustls_tls()` 建 reqwest；`Cargo.toml` reqwest features 須同時保留 `rustls-tls` **與** `rustls-tls-native-roots`（Windows native-tls/schannel 會截斷大型 multipart upload → Azure 回 HTTP 400）。Groq 與 Azure Whisper 共用此 client。

## CI/CD 與發版

```
 push/PR to main          push tag v*
       │                       │
       ▼                       ▼
 ┌──────────┐        ┌─────────────────┐
 │  ci.yml  │        │  release.yml    │  3 matrix:
 │ vue-tsc  │        │  macOS ARM /    │  Apple Signing + Notarization
 │ eslint   │        │  macOS Intel /  │  + Updater .sig + Sentry upload
 │ vitest   │        │  Windows x64    │  → Draft → publish-release job
 └──────────┘        └─────────────────┘
```

**發版硬規則：**

- `./scripts/release.sh X.Y.Z`：版本號須在 `git tag` / `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 四處一致。
- 正式版 Sentry release 一律由 `.github/workflows/release.yml` 產生（格式固定 `sayit@<version>`），前端與 Rust 不可各自手動指定不同名稱，不得繞過 workflow 手動上傳 sourcemap/telemetry。
- 本機 Windows 安裝檔：`pnpm tauri build --bundles nsis --config <json 將 bundle.createUpdaterArtifacts 設 false>`；輸出 `target\release\bundle\nsis\SayIt_<ver>_x64-setup.exe`（缺正式簽署私鑰時用此繞過）。
- 固定下載連結（官網）：`SayIt-mac-arm64.dmg` / `SayIt-mac-x64.dmg` / `SayIt-windows-x64.exe`（GitHub releases/latest/download）。

**GitHub Secrets（13 個）：** `TAURI_SIGNING_PRIVATE_KEY`(+`_PASSWORD`)、`APPLE_CERTIFICATE`(+`_PASSWORD`)、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`、`SENTRY_DSN`、`VITE_SENTRY_DSN`、`SENTRY_AUTH_TOKEN`、`SENTRY_ORG`、`SENTRY_PROJECT`。

**Code Review / 互動 Agent（2026-06 已遷移至原生 GitHub Copilot）：** 原 `.github/workflows/claude.yml`（`@claude` 觸發）+ `claude-code-review.yml`（PR 自動 review）依賴 `anthropics/claude-code-action@v1`（OIDC 兌換 GitHub App token）。因本 fork 未安裝 Claude Code GitHub App 且 `CLAUDE_CODE_OAUTH_TOKEN` 為空，PR review 每次 ❌。**現已停用兩支 workflow**（`on:` 改為 `workflow_dispatch`-only + 於 repo 端 `gh workflow disable`，檔案保留供參考），改用 **原生 Copilot code review**（repo Settings → Copilot → Code review 自動審查）與原生 `@copilot`（issue/PR mention 或指派 issue）互動。⚠️ 舊「**Fork PR 硬規則**：必須保留 `if: ...head.repo.full_name == github.repository` guard、禁止移除」已隨停用**失效**（本遷移取代之）。詳見 `docs/adr-claude-code-review-fork-pr.md`（Superseded）。所有 CICD 變更僅保留在 fork（`origin`），不送 `upstream`。

## Subagent

- **tauri-reviewer / ipc-review** — 審查 Rust↔Vue IPC 一致性（Command 註冊、Event 名稱、Payload 型別）。

## Git 工作流程（強制）

> ⚠️ **禁止直接在 `main` 分支上開發。** 所有涉及程式碼變更的任務，必須先透過 `git-worktree` skill 建立獨立的 Git Worktree 後再開始實作。

1. **實作前必建 Worktree** — 收到任何涉及程式碼修改的任務時，**第一步**是調用 `git-worktree` skill 建立新的 worktree。
2. **`main` 分支唯讀** — 只用於 merge，不直接在上面開發。
3. **一律使用 `--no-ff` merge**（Create a merge commit）；**禁止** squash / rebase merge，以保留完整分支歷史。
4. **合併前必更新 PR / Issue（強制 Gate）** — 合併任何 PR 前，必須先把實作描述回寫 PR body（`Closes #N` 寫在 body）、測試與 Code Review 結果用 comment 追加（不寫進 body）；更新與 merge 分開執行，任一項無法驗證即 STOP。詳見 `git-worktree`（Workflow 4.5/5）/ `github-issues` skill。

## 外部文件查詢

遇到下列情境時，**主動調用 `context7` skill** 查詢權威文件，不需使用者明確要求：

- 不熟悉的第三方函式庫 API（方法簽章、設定選項、預期行為）
- 版本敏感問題（breaking changes、deprecations）或使用者指定版本
- 安全性 / 正確性關鍵流程（auth、crypto、序列化）
- 第三方工具產生的陌生錯誤訊息
- 非顯而易見的設定（CLI flags、config files、auth flows）

## Pre-commit Checklist

```
□ pnpm test               單元/元件測試通過
□ npx vue-tsc --noEmit    無型別錯誤
□ pnpm exec eslint src    ESLint 無錯
□ cargo check (src-tauri) Rust 編譯通過
□ 改 IPC → tauri-reviewer / ipc-review subagent 審查
□ 改 SQL schema → 寫 v(N+1) migration，不動舊 migration
```
