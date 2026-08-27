# SayIt — GitHub Copilot 指南

> Tauri v2 (Rust) + Vue 3 + TypeScript 語音轉書面語桌面工具。按住快捷鍵說話，放開後經語音轉錄 + LLM 整理為繁體中文書面語，貼入游標位置。LLM provider：Groq（預設）/ OpenAI / Anthropic / Gemini / Azure；轉錄 provider：Groq / Azure / Gemini / MAI。

> 📌 **本檔是唯一權威 AI agent 指南**（已整合舊 `AGENTS.md` / `CLAUDE.md`）。本檔為 always-on 全域規則；**路徑相關細則切分在 `.github/instructions/*.instructions.md`，由 `applyTo` glob 自動套用**（編輯對應檔案時才載入）。預設以繁體中文回覆。

每當你有任何的方案建議，都要提出每個方案的優點、缺點以及你的建議。

**Path-scoped instructions（編輯對應路徑時自動套用）：**

| 檔案 | applyTo | 內容 |
|------|---------|------|
| `.github/instructions/frontend.instructions.md` | `src/**/*.{ts,vue}` | Vue / shadcn-vue / 語意色彩 / store 依賴方向 / useTauriEvents / invoke 錯誤 / SQLite 映射 / 型別命名 |
| `.github/instructions/rust.instructions.md` | `src-tauri/**/*.rs` | `generate_handler!` / plugins / 錯誤 enum / VK_F23 / windows crate 0.61 / rustls |
| `.github/instructions/tests.instructions.md` | `tests/**` | 測試分層 / factory / `data-testid` / priority tag / 禁用項 |

**權威文件（變更前請先讀對應檔，其中規則優先於概述）：**

| 文件 | 用途 |
|------|------|
| `_bmad-output/project-context.md` | 完整實作規則 |
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
pnpm exec vue-tsc --noEmit       # 只跑型別檢查
pnpm exec eslint src             # ESLint（CI 用此指令，無 lint npm script；--fix 可自動修）
pnpm test                        # Vitest 單元 + 元件測試（tests/unit, tests/component）
pnpm test:e2e                    # Playwright E2E（tests/e2e，跑在 mock 過 Tauri 的 Vite dev server）
pnpm test:coverage               # 覆蓋率報告
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --workspace
./scripts/release.sh X.Y.Z       # 發版（更新版本號 + tag + push）
```

**跑單一測試：**

```bash
pnpm test enhancer                       # 跑檔名含 "enhancer" 的 Vitest 檔
pnpm exec vitest run -t "test 名稱片段"   # 依測試名稱過濾
pnpm exec playwright test tests/e2e/smoke.test.ts
pnpm exec playwright test -g "test 名稱片段"
cd src-tauri && cargo test find_monitor  # 跑特定 Rust 測試函式
```

> 全套 vitest 在部分機器並行執行時會 flaky（環境時間暴增、5s timeout）；不穩時用 `pnpm exec vitest run --no-file-parallelism`。勿與 `cargo check`/`cargo test` 同時跑（CPU 競爭會拖垮 vitest）。

CI（`.github/workflows/ci.yml`）：Ubuntu 跑 `vue-tsc --noEmit` → `eslint src` → feedback presentation guard（禁止 View 手寫 feedback，見 frontend instructions #10）→ `pnpm test` → `vite build`；另在 macOS + Windows 跑 `cargo clippy --workspace --all-targets -- -D warnings` + `cargo test --workspace`。本機命令仍優先使用 `pnpm exec`；CI 內既有的 `npx` 不代表可改用 npm 安裝依賴。

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
 │ │ App.vue  │  │   5 views + DB + Store   │       │
 │ │ NotchHud │  │   shadcn-vue UI          │       │
 │ └──────────┘  └──────────────────────────┘       │
 │  label:main    label:main-window                 │
 │  400x100       960x680 (min 720x480)             │
 │  transparent   decorations, resizable            │
 │  alwaysOnTop   預設隱藏                          │
 └─────────────────────────────────────────────────┘
```

- **HUD**（`index.html` → `App.vue` → `NotchHud.vue`，window label `main`）：透明、alwaysOnTop 狀態浮窗。
- **Dashboard**（`main-window.html` → `MainApp.vue` + hash Router，label `main-window`）：Dashboard/歷史/字典/設定/功能介紹五個 lazy-loaded views，預設隱藏，960x680。
- 視窗間溝通：Rust `emit()` 廣播事件；前端 → Rust 用 `invoke()`。也有「Frontend-only 事件」不經 Rust（清單見下方 IPC 契約表）。
- **啟動順序不可任意調換**：Dashboard 在 mount 前初始化 DB、註冊 `database:ready-ping` 回應、載入 settings 與執行 replacement migration；HUD 不跑 migration，透過 `database:ready` / ping-replay 協定等待 DB。設定載入失敗時仍須 mount，避免白畫面，但 store 會守住寫入。

**Rust backend** — `src-tauri/src/lib.rs` 用 `generate_handler!` 註冊所有 command（**漏註冊 → 前端 invoke 會 timeout**）；功能切成 `src/plugins/*.rs`，涵蓋熱鍵、剪貼簿、錄音/轉錄、音訊控制、鍵盤監控、文字欄位讀取、Azure auth/session、logging、檔案傳輸與音效。敏感 token 的 OS credential-store adapter 在 `plugins/secret_store.rs`。

**前端依賴方向（硬規則）：**

```
  views/ ──→ components/ + stores/ + composables/
  stores/ ──→ lib/
  lib/   ──→ 前端外部 API（Groq / OpenAI / Anthropic / Azure Foundry / Gemini）

  ❌ views/ 不可直接 import lib/（一律經 Pinia store：useSettingsStore / useHistoryStore / useVocabularyStore / useVoiceFlowStore）
  ❌ 元件不可直接執行 SQL（經 src/lib/database.ts + store）
```

**網路信任邊界：** 前端 HTTP（chat 整理、連線測試）走 `@tauri-apps/plugin-http`，受 `src-tauri/capabilities/default.json` allowlist + `tauri.conf.json` CSP `connect-src` 約束；Rust 的 `transcription.rs` / `azure_auth.rs` / `azure_user_session.rs` 用 `reqwest` 直連，**不**受該 allowlist 約束。MAI 轉錄只走 Rust `transcription.rs`。

**資料儲存邊界：** 歷史、詞彙、用量統計與幻覺詞表放 SQLite；replacement rules、API keys、Azure 設定與一般使用者設定放 `tauri-plugin-store`；Entra 使用者 token/refresh token 由 Rust session + `plugins/secret_store.rs` 的 OS credential store 管理。不要把秘密寫入 SQLite。

## IPC 契約表

### Tauri Commands（Frontend → Rust）

| Command | Rust 位置 | 前端呼叫點 | 參數 | 回傳 |
|---------|-----------|-----------|------|------|
| `request_app_restart` | `lib.rs` | autoUpdater.ts（更新安裝後） | — | `()` |
| `update_hotkey_config` | `lib.rs` | useSettingsStore | `trigger_key: TriggerKey, trigger_mode: TriggerMode` | `Result<(), String>` |
| `get_hud_target_position` | `lib.rs` | useVoiceFlowStore | `app: AppHandle` | `Result<HudTargetPosition, String>`（含 `space: "physical"\|"logical"`，Windows 回 physical 以避開 tao 跨 DPI 錯位） |
| `ensure_hud_visible` | `lib.rs` | useVoiceFlowStore（showHud 後） | `app: AppHandle` | `()`（Windows：記錄可見性快照 + 安全恢復：最小化還原、重宣告 topmost；非 Windows：no-op） |
| `get_os_theme` | `lib.rs` | theme.ts（`refreshOsTheme`） | — | `Option<String>`（`"dark"` / `"light"`；Windows 讀登錄檔為權威來源，非 Windows／讀取失敗回 `null` 讓前端 fallback 到 `window.theme()` → `matchMedia`） |
| `set_file_logging_enabled` | `plugins/logging.rs` | useSettingsStore, logger.ts | `enabled: bool` | `()` |
| `open_log_folder` | `plugins/logging.rs` | logger.ts（SettingsView） | — | `Result<(), String>` |
| `cleanup_old_logs` | `plugins/logging.rs` | main-window.ts | `days: u32, app: AppHandle` | `Result<Vec<String>, String>` |
| `mute_system_audio` | `plugins/audio_control.rs` | useVoiceFlowStore | `state: State<AudioControlState>` | `Result<(), String>` |
| `restore_system_audio` | `plugins/audio_control.rs` | useVoiceFlowStore | `state: State<AudioControlState>` | `Result<(), String>` |
| `paste_text` | `plugins/clipboard_paste.rs` | useVoiceFlowStore | `text: String, restore_clipboard: bool`（`restore_clipboard` = 未開啟「轉錄結果複製到剪貼簿」時才還原原本剪貼簿內容） | `Result<(), ClipboardError>` |
| `copy_to_clipboard` | `plugins/clipboard_paste.rs` | HistoryView | `text: String` | `Result<(), ClipboardError>` |
| `capture_target_window` | `plugins/clipboard_paste.rs` | useVoiceFlowStore | — | `()` |
| `check_accessibility_permission_command` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | — | `bool` |
| `open_accessibility_settings` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | — | `Result<(), String>` |
| `reinitialize_hotkey_listener` | `plugins/hotkey_listener.rs` | AccessibilityGuide.vue | `app: AppHandle` | `Result<(), String>` |
| `reset_hotkey_state` | `plugins/hotkey_listener.rs` | useVoiceFlowStore | `state: State<HotkeyListenerState>` | `()` |
| `set_hotkey_capture_active` | `plugins/hotkey_listener.rs` | useVoiceFlowStore（transitionTo / initialize） | `active: bool, state: State<HotkeyListenerState>` | `()` |
| `start_hotkey_recording` | `plugins/hotkey_listener.rs` | SettingsView | `state: State<HotkeyListenerState>` | `()` |
| `cancel_hotkey_recording` | `plugins/hotkey_listener.rs` | SettingsView | `state: State<HotkeyListenerState>` | `()` |
| `start_quality_monitor` | `plugins/keyboard_monitor.rs` | useVoiceFlowStore | `app: AppHandle` | `()` |
| `start_correction_monitor` | `plugins/keyboard_monitor.rs` | useVoiceFlowStore | `app: AppHandle` | `()` |
| `read_focused_text_field` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `Result<Option<String>, String>` |
| `get_foreground_app_name` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `Option<String>` |
| `read_selected_text` | `plugins/text_field_reader.rs` | useVoiceFlowStore | — | `Result<Option<String>, String>` |
| `read_selection_state` | `plugins/text_field_reader.rs` | useVoiceFlowStore（編輯模式偵測） | — | `SelectionState { kind: "selection" \| "noSelection" \| "unavailable", text: Option<String> }`（macOS AX / Windows UIA 均走獨立 worker + `spawn_blocking`，避免阻塞主執行緒拖慢隨後的 `start_recording`；single-flight，重入回 `unavailable`；Windows 終端機 UIA 不可用時回 `noSelection`，不觸發 Ctrl+C 後備） |
| `get_default_input_device_name` | `plugins/audio_recorder.rs` | SettingsView | — | `Option<String>` |
| `list_audio_input_devices` | `plugins/audio_recorder.rs` | SettingsView | — | `Vec<AudioInputDeviceInfo>` |
| `start_audio_preview` | `plugins/audio_recorder.rs` | useAudioPreview.ts（SettingsView） | `app, preview_state: State<AudioPreviewState>, device_name: String` | `Result<(), String>` |
| `stop_audio_preview` | `plugins/audio_recorder.rs` | useAudioPreview.ts（SettingsView） | `preview_state: State<AudioPreviewState>` | `()` |
| `start_recording` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `app, state: State<AudioRecorderState>, device_name: String` | `Result<(), AudioRecorderError>` |
| `stop_recording` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `state: State<AudioRecorderState>` | `Result<StopRecordingResult, AudioRecorderError>` |
| `save_recording_file` | `plugins/audio_recorder.rs` | useVoiceFlowStore | `id: String, app, state: State<AudioRecorderState>` | `Result<String, String>` |
| `read_recording_file` | `plugins/audio_recorder.rs` | HistoryView | `id: String, app: AppHandle` | `Result<Response, String>` |
| `delete_all_recordings` | `plugins/audio_recorder.rs` | useHistoryStore（SettingsView 觸發） | `app: AppHandle` | `Result<u32, String>` |
| `cleanup_old_recordings` | `plugins/audio_recorder.rs` | main-window.ts | `days: u32, app: AppHandle` | `Result<Vec<String>, String>` |
| `transcribe_audio` | `plugins/transcription.rs` | useVoiceFlowStore | `state, transcription_state, api_key, vocabulary_term_list?, model_id?, language?, provider?（`"groq"`(預設)/`"azure"`/`"gemini"`/`"mai"`；未知值 fail-closed 報錯）, endpoint?, deployment?, api_version?, auth_mode?, candidate_locales?（MAI Fast 最多一個，空值＝多語自動）, transcribe_style?` | `Result<TranscriptionResult, TranscriptionError>`（`noSpeechProbability: number \| null` — Gemini／MAI 無此信號回 `null`） |
| `retranscribe_from_file` | `plugins/transcription.rs` | useVoiceFlowStore、useHistoryStore（retranscribeRecord） | `file_path, api_key, vocabulary_term_list?, model_id?, language?, provider?（同上）, endpoint?, deployment?, api_version?, auth_mode?, candidate_locales?, transcribe_style?` | `Result<TranscriptionResult, TranscriptionError>`（同上） |
| `test_whisper_connection` | `plugins/transcription.rs` | connectionTest.ts（SettingsView） | `transcription_state, api_key, model_id?, provider?（同上）, endpoint?, deployment?, api_version?, auth_mode?, candidate_locales?, transcribe_style?` | `Result<(), TranscriptionError>` |
| `get_azure_entra_token` | `plugins/azure_auth.rs` | azureAuth.ts（getAzureAccessToken） | `tenant_id, client_id, client_secret, scope` | `Result<AzureTokenResult, String>`（`{ accessToken, expiresIn }`） |
| `azure_user_sign_in` | `plugins/azure_user_session.rs` | azureUserAuth.ts（signInAzureUser） | `tenant_id, client_id, operation_id, state: State<AzureUserAuthState>` | `Result<AzureUserAccount, AzureUserAuthError>`（PKCE public client，開系統瀏覽器等 loopback callback；同時只允許一個進行中登入） |
| `azure_user_cancel_sign_in` | `plugins/azure_user_session.rs` | azureUserAuth.ts（cancelAzureUserSignIn） | `operation_id, state: State<AzureUserAuthState>` | `()`（帶 operation_id 才不會取消到下一次登入） |
| `azure_user_sign_out` | `plugins/azure_user_session.rs` | azureUserAuth.ts（signOutAzureUser） | `tenant_id, client_id, state: State<AzureUserAuthState>` | `Result<(), AzureUserAuthError>`（清 OS 憑證庫 + 該帳號所有 scope 的 token 快取） |
| `azure_user_get_account` | `plugins/azure_user_session.rs` | azureUserAuth.ts（getAzureUserAccount） | `tenant_id, client_id, state: State<AzureUserAuthState>` | `Result<Option<AzureUserAccount>, AzureUserAuthError>`（`{ username, name, tenantId, clientId }`，身分欄位皆可為 null） |
| `azure_user_get_token` | `plugins/azure_user_session.rs` | azureUserAuth.ts（getAzureUserToken） | `tenant_id, client_id, scope_kind（`"chat"`/`"whisper"`；scope 由 Rust 固定列舉，前端不可指定任意 audience）, state: State<AzureUserAuthState>` | `Result<String, AzureUserAuthError>`（記憶體快取 + single-flight refresh） |
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
| `theme:os-changed` | lib.rs（Windows 登錄檔輪詢） | `THEME_OS_CHANGED` | `"dark"` \| `"light"`（字串）— 透明且隱藏的 HUD 在 Windows 收不到 `WM_THEMECHANGED`，故改由 Rust 廣播 |

### Frontend-only Events（不經 Rust）

| Event | 常量 | 發送方 | 接收方 |
|-------|------|--------|--------|
| `voice-flow:state-changed` | `VOICE_FLOW_STATE_CHANGED` | useVoiceFlowStore | **目前無接收方**（emit 保留，尚無 listener） |
| `transcription:completed` | `TRANSCRIPTION_COMPLETED` | useHistoryStore（`emitToWindow("main-window", …)`） | DashboardView、HistoryView |
| `settings:updated` | `SETTINGS_UPDATED` | useSettingsStore | HUD App.vue（目前唯一 listener） |
| `azure-auth:state-changed` | `AZURE_AUTH_STATE_CHANGED` | useSettingsStore（登入/登出/清除連線後） | HUD App.vue（重讀 Entra 使用者登入狀態；不重讀的話 HUD 的 `hasWhisperConfig` 會停在登入前狀態） |
| `vocabulary:changed` | `VOCABULARY_CHANGED` | VocabularyStore | All Windows |
| `replacements:changed` | `REPLACEMENTS_CHANGED` | ReplacementStore（規則 CRUD 後） | HUD（App.vue，重載取代規則） |
| `vocabulary:learned` | `VOCABULARY_LEARNED` | VoiceFlowStore | HUD NotchHud |
| `database:ready` | `DATABASE_READY` | Dashboard（main-window.ts，DB migration 完成後） | HUD（App.vue / waitForDatabaseReady） |
| `database:ready-ping` | `DATABASE_READY_PING` | HUD（請 Dashboard 重新廣播，解決競態） | Dashboard（收到後 replay `database:ready`） |

> 變更 IPC（Command/Event）後，用 **`ipc-review` / `tauri-reviewer` subagent** 做 Rust↔Vue 雙端對齊審查（Command 註冊、Event 名稱、Payload 型別）。

## 多檔協作任務（細節見 `docs/development-guide.md` §4）

- **加 Tauri Command：** 寫 `plugins/<m>.rs` 的 `#[command]` → 在 `lib.rs` `generate_handler!` 註冊（漏註冊會 timeout）→ 前端 `src/types/events.ts` 加 `*Payload` → `useTauriEvents.ts` 加常數。
- **加設定欄位：** `src/types/settings.ts` → `useSettingsStore.ts`（state + load/save）→ `SettingsView.vue`（shadcn-vue）→ 必要時 emit `settings:updated`。
- **加 LLM Provider：** `src/lib/llmProvider.ts`（型別 + `buildFetchParams` + `parseProviderResponse`）→ `modelRegistry.ts` → `src-tauri/capabilities/default.json`（http allowlist）→ `src-tauri/tauri.conf.json` CSP `connect-src`（**很容易漏**）。
- **加 i18n 字串：** `src/i18n/locales/` 五個語系（`zh-TW`, `zh-CN`, `en`, `ja`, `ko`）都要加。
- **加外部連結：** 使用 `src/components/ExternalLink.vue`，由 `src/lib/externalLink.ts` 透過系統瀏覽器開啟；不要新增裸 `<a target="_blank">`。HTTPS 由前端 helper 驗證，並由 `tauri.conf.json` 的 `plugins.shell.open` validator 再次限制。

## 自動更新機制

- **啟動時檢查** — `MainApp.vue` `onMounted`：App 啟動後 5 秒檢查一次，**不做定時輪詢**（Dashboard 關閉時只 hide 不 destroy，故本元件整個 App 生命週期僅 mount 一次 ≒ 每次啟動檢查一次）。排程刻意放在 `onMounted` 最前面，避免前面的 `await` 失敗連帶讓更新永不排程。
- **失敗重試** — `checkForAppUpdate()` 吞例外回傳 `status: "error"`，故僅在**檢查失敗**時依 `src/lib/updateRetryPolicy.ts` 的 `AUTO_CHECK_RETRY_DELAYS_MS`（1／5／15 分）退避重試，用盡即 `captureError` 回報後停止（開機自啟時網路常未就緒，否則單次失敗＝本次啟動再也不檢查）。重試策略刻意獨立於 `autoUpdater.ts`，因為後者會拉進 updater plugin 而採動態 import，catch 路徑仍須能排重試。
- **手動檢查與自動重試的關係** — 任何一次**檢查成功**（自動或手動）都會把重試階梯歸零，手動成功另外會取消待執行的重試；手動檢查**失敗**則重新武裝階梯（否則使用者離線時按一下按鈕，就會把自動更新的補救機制整個關掉）。`autoCheckTimeoutId` 是「是否還有排程在等」的權威旗標：階梯觸發時先設 `null`，`scheduleAutoCheckRetry` 見到非 `null` 就讓既有排程跑完，藉此避免重複排程與誤報「已用盡」。
- **手動檢查** — `MainApp.vue` Sidebar Footer「檢查更新」按鈕，結果用 `useFeedbackMessage` 顯示。
- **回傳型別** — `checkForAppUpdate()` → `Promise<UpdateCheckResult>`（`up-to-date` | `update-available` | `error`）。
- **勿用 `window.confirm`** — 在 Tauri WKWebView 會被靜默忽略；更新提示一律用 `MainApp.vue` 的 `AlertDialog`。

## Azure / Microsoft Foundry Provider

- **資源設定與 Chat（LLM 整理）** — Azure 設定以 `azureResourceName` 和選填的 `azureProjectName` 為主。主 chat endpoint 推導為 `https://{resource}.openai.azure.com`，Foundry 部署清單則以 `https://{resource}.services.ai.azure.com/api/projects/{project}/deployments?api-version=v1` 請求；沒有 project 或 Foundry 請求失敗時，使用主 chat host 的 `/openai/v1/models` fallback。`azureEndpointOverride` 可保留既有 `.services.ai`／private DNS host，且優先於推導值；不要把 resource name 未驗證地拼成 URL。`model` 一律是使用者自訂的部署名稱。SettingsView 以清單為主要入口：選到帶 Foundry metadata 的部署時，原子寫入 deployment、family 與 `azureChatModelFamilySource="auto"`；手動改 family 或手動輸入 deployment 時標為 `"manual"`。重載清單不可改寫已存 family，且已存但不在清單的 deployment 必須保留虛擬選項。`azureChatModelFamily` 是可覆寫的 wire 行為提示；未知 metadata 使用保守 `other`／`other-reasoning` profile。初始 token 預設保守為 8192；明確 HTTP 400 temperature 拒絕時移除該參數重試一次，並以有效 endpoint + deployment 快取結論（快取不可備份）。`buildFetchParams("azure", …, azureOptions)` 在 `llmProvider.ts`。不要改用已退役的 `/models/chat/completions` 路由，也不要對非 OpenAI 模型送未經文件確認的 `reasoning_effort`。
- **Whisper（轉錄）** — `whisperProviderId = "azure"` 時走 Rust `transcription.rs`：`{endpoint}/openai/deployments/{deployment}/audio/transcriptions?api-version=…`，保留 `verbose_json`/`no_speech_prob`。
- **Gemini（轉錄）** — `whisperProviderId = "gemini"` 時走 Rust `transcription.rs`（reqwest，**非** Whisper multipart 協定）：`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`，`x-goog-api-key` header + inline base64 WAV + structured output `{ transcript }`。模型走**獨立的 Gemini 轉錄清單**（Rust `GEMINI_TRANSCRIPTION_MODELS` allowlist：`gemini-3.5-flash-lite`（預設）／`gemini-3.6-flash`，須與 TS `modelRegistry.ts` 的 `GEMINI_TRANSCRIPTION_MODEL_LIST` 一致），**不吃 `WhisperModelId`**（沿用會打到不存在的 `/models/whisper-large-v3:generateContent`）；allowlist 外的值 fallback 回預設模型。無 `no_speech_prob` → `noSpeechProbability` 回 `null`，前端幻覺偵測 Layer 2b 跳過（Layer 1/2a 不受影響）。inline 上限 20MB request（raw WAV 上限 14 MiB，16kHz mono 約 7 分 39 秒）。金鑰與 Gemini LLM 共用 `geminiApiKey`。
- **驗證** — API Key（`api-key` header）或 **Entra ID（client credentials）**（`Authorization: Bearer`）。token 由 **Rust** `plugins/azure_auth.rs` 的 `get_azure_entra_token` 取得（reqwest，不帶 browser `Origin`，避免 `AADSTS9002326`），快取在 `src/lib/azureAuth.ts`。
- **scope 依 API 路徑（非 host）選**（`getAzureScopeForApiKind`，`src/lib/azureAuth.ts`）：v1 `/openai/v1/` chat → `ai.azure.com/.default`；deployments/Whisper 路徑 → `cognitiveservices.azure.com/.default`。
- **設定解析** — `useSettingsStore` 的 `getLlmRequestConfig()` / `getWhisperRequestConfig()`（皆 async，Entra 需換 token）。設定（endpoint/authMode/key 或 tenant+client+secret/部署名）存 `tauri-plugin-store`，**不進 SQLite**。
- **allowlist/CSP** — `capabilities/default.json` + `tauri.conf.json` 已加 `*.openai.azure.com`、`*.services.ai.azure.com`、`*.cognitiveservices.azure.com`、`login.microsoftonline.com`。

## 平台與環境注意

- **Node 24**（`.nvmrc`）、**pnpm 10.28.2**（`corepack enable && corepack prepare`）、**Rust stable**。
- **`Cargo.lock` / `pnpm-lock.yaml` 禁止手動修改**；改 `tauri.conf.json` / `Cargo.toml` 需審慎。
- **CSP / 安全功能必須用 `pnpm tauri build --debug` 測**，dev mode 不受 CSP 影響。
- **macOS IPC binary**：`tauri::ipc::Response` raw bytes 走 JSON `number[]`，前端用 `new Uint8Array(raw)` 轉換。`convertFileSrc` 產生 `asset://localhost/`，但 CSP `media-src` 需 `http://asset.localhost`；偏好 Rust IPC + Blob URL 繞過。
- Rust / Windows 專屬細節（VK_F23、`windows` crate 0.61、rustls）見 `.github/instructions/rust.instructions.md`。

## CI/CD 與發版

> 🍴 **Fork 發版政策（硬規則）**：本 repo 是 `chenjackle45/SayIt` 的 fork，採**自走 release**。所有 release / CICD 相關修改——GitHub workflow、secrets/variables、`release.yml`、`tauri.conf.json`（updater endpoint/pubkey、簽名設定）、`scripts/release.sh`、`sayit-release` skill 等——**只保留在本 fork（`lettucebo/SayIt`），不得同步或開 PR 回上游 `chenjackle45/SayIt`**；自上游 sync 時須保留我方版本。
> - macOS **未簽名**（無 Apple Developer 憑證，使用者需右鍵開啟）；updater 用 **fork 專屬簽章金鑰**，endpoint/pubkey 指向 `lettucebo/SayIt`。
> - 非機密設定（Sentry DSN/Org/Project 等）一律用 **GitHub variable**；私鑰、token、app 密碼才用 **secret**。
> - **不得 backlink 上游**：`main` 的 commit / PR / issue / CHANGELOG / release notes 一律不指向上游 issue/PR，詳見下方「`main` 分支與上游關聯政策（硬規則）」。

```
 push/PR to main          push tag v*
       │                       │
       ▼                       ▼
 ┌──────────┐        ┌─────────────────┐
 │  ci.yml  │        │  release.yml    │  3 matrix:
 │ vue-tsc  │        │  macOS ARM /    │  unsigned macOS (fork, no Apple cert)
 │ eslint   │        │  macOS Intel /  │  + Updater .sig (fork key) + Sentry
 │ vitest   │        │  Windows x64    │  → Draft → publish-release (arm)
 └──────────┘        └─────────────────┘
```

**發版硬規則：**

- `./scripts/release.sh X.Y.Z`：版本號須在 `git tag` / `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 四處一致。
- 正式版 Sentry release 一律由 `.github/workflows/release.yml` 產生（格式固定 `sayit@<version>`），前端與 Rust 不可各自手動指定不同名稱，不得繞過 workflow 手動上傳 sourcemap/telemetry。
- 本機 Windows 安裝檔：`pnpm tauri build --bundles nsis --config <json 將 bundle.createUpdaterArtifacts 設 false>`；輸出 `target\release\bundle\nsis\SayIt_<ver>_x64-setup.exe`（缺正式簽署私鑰時用此繞過）。
- 固定下載連結（官網）：`SayIt-mac-arm64.dmg` / `SayIt-mac-x64.dmg` / `SayIt-windows-x64.exe`（GitHub releases/latest/download）。

**GitHub Secrets / Variables（fork 自走 release）：** Secrets — `TAURI_SIGNING_PRIVATE_KEY`(+`_PASSWORD`)、`SENTRY_AUTH_TOKEN`。Variables — `SENTRY_DSN`、`VITE_SENTRY_DSN`、`SENTRY_ORG`、`SENTRY_PROJECT`。macOS 未簽名故**不需 `APPLE_*`**；`GITHUB_TOKEN` 內建免設定。

**Code Review / 互動 Agent（2026-06 已遷移至原生 GitHub Copilot）：** 原 `.github/workflows/claude.yml`（`@claude` 觸發）+ `claude-code-review.yml`（PR 自動 review）依賴 `anthropics/claude-code-action@v1`（OIDC 兌換 GitHub App token）。因本 fork 未安裝 Claude Code GitHub App 且 `CLAUDE_CODE_OAUTH_TOKEN` 為空，PR review 每次 ❌。**現已停用兩支 workflow**（`on:` 改為 `workflow_dispatch`-only + 於 repo 端 `gh workflow disable`，檔案保留供參考），改用 **原生 Copilot code review**（repo Settings → Copilot → Code review 自動審查）與原生 `@copilot`（issue/PR mention 或指派 issue）互動。⚠️ 舊「**Fork PR 硬規則**：必須保留 `if: ...head.repo.full_name == github.repository` guard、禁止移除」已隨停用**失效**（本遷移取代之）。詳見 `docs/adr-claude-code-review-fork-pr.md`（Superseded）。所有 CICD 變更僅保留在 fork（`origin`），不送 `upstream`。

## Subagent

- **tauri-reviewer / ipc-review** — 審查 Rust↔Vue IPC 一致性（Command 註冊、Event 名稱、Payload 型別）。

## Git 工作流程（強制）

> ⚠️ **功能（feature）與 Bug 修正必須先透過 `git-worktree` skill 建立獨立 worktree，不在 `main` 上直接開發**；**文件 / skill / CHANGELOG / 發版準備等非功能變更可直接在 `main` 進行**。

1. **功能 / Bug → 先建 Worktree** — 收到功能或 Bug 修正任務時，**第一步**調用 `git-worktree` skill 建立 worktree 再實作。
2. **文件 / skill / 雜項可在 `main`** — 文件、skill、CHANGELOG、發版準備等非功能變更可直接在 `main`（其餘 merge 才回 `main`）。
3. **一律使用 `--no-ff` merge**（Create a merge commit）；**禁止** squash / rebase merge，以保留完整分支歷史。
4. **合併前必更新 PR / Issue（強制 Gate）** — 合併任何 PR 前，必須先把實作描述回寫 PR body（`Closes #N` 寫在 body）、測試與 Code Review 結果用 comment 追加（不寫進 body）；更新與 merge 分開執行，任一項無法驗證即 STOP。詳見 `git-worktree`（Workflow 4.5/5）/ `github-issues` skill。

## `main` 分支與上游關聯政策（硬規則）

> 🔒 **`main` 是本 fork 自己的產物線**（已與上游 `chenjackle45/SayIt` 逐漸分化，功能開始有差異）。在 `main`（及任何會 merge 進 `main` 的分支）上產生的一切——**commit message、PR / issue 的 body 與 comment、CHANGELOG、release notes**——**一律不得指向上游、也不得讓上游 `chenjackle45/SayIt` 的 issue/PR timeline 出現本 fork 的 cross-reference backlink**。

**機制**：GitHub 只有 **commit message** 與 **issue/PR 的 body/comment** 會**跨 repo**觸發 backlink；repo 檔案內容（含 `CHANGELOG.md`）與 **GitHub Release body 不會**。但為求 fork 自主與一致，`main` 上一律避免任何指向上游的引用格式。

**❌ 禁止**：
- 任何指向上游的引用出現在 `main` 的 commit / PR / issue 文字：`chenjackle45/SayIt#N`、`chenjackle45#N`、上游 issue/PR 完整 URL。
- **CHANGELOG / release notes** 中放**任何** `#N`（會被 `release.yml` 抽進 GitHub Release body、在 fork 端 render 成連結，且常誤連自家不相關的 issue/PR）。

**✅ 允許**：
- PR / issue body 用 `Closes #N` 連結**本 fork（origin）自己的真實 issue**（正常 issue 關閉流程，見上「Git 工作流程」第 4 點）——連的是自己 repo，不 backlink 上游。

**✅ backport 上游功能時**，來源標註改用**不可被 GitHub 解析為引用**的純文字：
- `port upstream edit-mode AX detection`（純描述，不帶 `#` / repo）
- 要保留追溯就寫 `對應上游 issue 68`（數字**不帶 `#`、不帶 repo 前綴** → 不連結、不 backlink）

**🔄 從上游 sync 進來時**：cherry-pick / port 上游 commit 落地到 `main`（或會併入 `main` 的分支）時，**必須先改寫** commit message 中任何 `chenjackle45/SayIt#N` / 裸 `#N` 來源引用為上述純文字，再落地。

**✅ 唯一例外——貢獻回上游**：當且僅當工作目標是「開 PR 回上游 `chenjackle45/SayIt`」（在專門的上游貢獻分支、其 **PR 目標 repo 為 `upstream`**）時，該分支/PR 本就應、也允許引用上游 issue —— 那是貢獻流程的一部分。此例外**僅限**目標為 upstream 的分支與 PR，**不適用** `main` 及任何會併入 `main` 的分支。

> 一句話判準：**「這個引用會不會讓上游 `chenjackle45/SayIt` 的 issue 出現本 fork 的關聯？」**——若會、且不是要投 PR 回上游，就改成不帶 `#`/repo 的純文字。

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
□ pnpm exec vue-tsc --noEmit 無型別錯誤
□ pnpm exec eslint src    ESLint 無錯
□ cargo fmt --check + cargo clippy --workspace --all-targets -- -D warnings
□ cargo test --workspace（src-tauri）
□ 改 IPC → tauri-reviewer / ipc-review subagent 審查
□ 改 SQL schema → 寫 v(N+1) migration，不動舊 migration
```
