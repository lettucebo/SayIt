# API Contracts — Backend (Tauri)

> Frontend → Rust 的 Tauri Commands · Rust → Frontend 的 Tauri Events
> 掃描日期：2026-07-29 · 版本：0.14.0
> Authoritative source：`src-tauri/src/lib.rs` 的 `generate_handler!` macro + `.github/copilot-instructions.md` IPC 契約表

---

## 一、契約總覽

| 軌道                       | 數量    | 來源                                                                        |
| -------------------------- | ------- | --------------------------------------------------------------------------- |
| Tauri Commands             | **46**  | `lib.rs::run()` 的 `generate_handler!` macro                                |
| Rust → Frontend Events     | **13**  | Rust 端 `emit()` 的事件名（前端常數在 `useTauriEvents.ts`）                 |
| Frontend-only Events       | **8**   | `src/composables/useTauriEvents.ts`                                         |

> 所有 event 名稱常數在前端**只能**從 `useTauriEvents.ts` import；Rust 端定義在各 plugin 模組頂部。新增時兩端必須對齊（用 `tauri-reviewer` subagent 審查）。

---

## 二、Tauri Commands

格式：`fn(params) -> ReturnType`，所有 command 由 frontend `invoke('name', { params })` 呼叫。

> **⚠️ 兩種名字不要搞混**
> - 下方 `invoke(...)` 範例中的參數是**前端實際要傳的鍵名**，一律 **camelCase**（Tauri 會轉成 Rust 的 snake_case）。例如 Rust 的 `api_key` / `file_path` / `restore_clipboard`，前端要寫 `apiKey` / `filePath` / `restoreClipboard`。
> - Rust 簽章中的 `app: AppHandle`、`state: State<T>` 由 **Tauri 自動注入**，呼叫端**不要傳**。表格中的「簽名」欄列的是 Rust 端簽章（含注入參數），`invoke(...)` 範例則只列呼叫端該傳的東西。

### 2.1 系統與生命週期（7 個）

#### `set_file_logging_enabled`
```ts
invoke('set_file_logging_enabled', { enabled: boolean }) → void
```
- **Rust 位置**：`plugins/logging.rs`
- **用途**：切換是否把 log 寫入檔案（即時生效，免重啟）。由 `FILE_LOG_ENABLED` 旗標 + `tauri-plugin-log` 的 `.filter` 控制。前端記錄改用 `@tauri-apps/plugin-log` + `src/lib/logger.ts`（`console.*` 自動轉送），舊的 `debug_log` command 已移除。

#### `open_log_folder`
```ts
invoke('open_log_folder') → void
```
- **Rust 位置**：`plugins/logging.rs`
- **用途**：以系統檔案管理員開啟 Log 資料夾（`app_log_dir()`，Windows `explorer`／macOS `open`）。

#### `cleanup_old_logs`
```ts
invoke('cleanup_old_logs', { days: number }) → string[]
```
- **Rust 位置**：`plugins/logging.rs`
- **用途**：刪除超過 N 天的舊 `*.log`（永遠保留目前寫入中的 active `sayit.log`），回傳已刪除檔名清單。與錄音清理獨立。

#### `request_app_restart`
```ts
invoke('request_app_restart') → void
```
- **Rust 位置**：`lib.rs:84`
- **用途**：自動更新後重啟 app（內部設 RESTART_REQUESTED 旗標 + `app.exit(0)`）

#### `get_hud_target_position`
```ts
invoke('get_hud_target_position') → Result<{
  x: number, y: number, monitorKey: string,
  space: 'physical' | 'logical',   // Windows 回 physical 以避開 tao 跨 DPI 錯位
}, string>
```
- **Rust 位置**：`lib.rs`
- **用途**：HUD 多螢幕追蹤（取得游標所在螢幕的置中位置）
- **錯誤**：若 `app.available_monitors()` 失敗或無螢幕 → `Result::Err(String)`

#### `ensure_hud_visible`
```ts
invoke('ensure_hud_visible') → void
```
- **Rust 位置**：`lib.rs`
- **用途**：Windows 下於 `showHud()` 後確保 HUD 真的可見——記錄可見性快照並安全恢復（最小化還原、重新宣告 topmost）。非 Windows 為 no-op。

#### `get_os_theme`
```ts
invoke('get_os_theme') → 'dark' | 'light' | null
```
- **Rust 位置**：`lib.rs`
- **用途**：查詢權威的 OS 外觀。Windows 讀登錄檔（透明且隱藏的 HUD 其 WebView2 拿不到正確值），非 Windows 或讀取失敗回 `null`，前端 fallback 到 `window.theme()` → `matchMedia`。

### 2.2 熱鍵（8 個 · `plugins/hotkey_listener.rs`，`update_hotkey_config` 在 `lib.rs`）

| Command                                  | 簽名                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `update_hotkey_config`                   | `(trigger_key, trigger_mode) → Result<(), String>`                     |
| `check_accessibility_permission_command` | `() → bool`（macOS only，Windows 永遠回 true）                         |
| `open_accessibility_settings`            | `() → Result<(), String>`                                              |
| `reinitialize_hotkey_listener`           | `(app: AppHandle) → Result<(), String>`                                |
| `reset_hotkey_state`                     | `(state: State<HotkeyListenerState>) → ()`                             |
| `set_hotkey_capture_active`              | `(active: bool, state: State<HotkeyListenerState>) → ()`（Windows：語音流程進行中時攔截 ESC） |
| `start_hotkey_recording`                 | `(state) → ()`                                                         |
| `cancel_hotkey_recording`                | `(state) → ()`                                                         |

**型別**（`src/types/settings.ts`）：
- `PresetTriggerKey` = `'fn' | 'option' | 'rightOption' | 'command' | 'rightAlt' | 'leftAlt' | 'control' | 'rightControl' | 'shift'`
- `TriggerKey` = `PresetTriggerKey | { custom: { keycode: number } } | { combo: { modifiers: ModifierFlag[], keycode: number } }`
- `ModifierFlag` = `'command' | 'control' | 'option' | 'shift' | 'fn'`
- `TriggerMode` = `'hold' | 'toggle'`
- 前端 invoke 時傳 `{ triggerKey, triggerMode }`（camelCase）

### 2.3 音訊（10 個 · `plugins/audio_recorder.rs`）

| Command                              | 簽名                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `get_default_input_device_name`      | `() → Option<String>`                                                                                              |
| `list_audio_input_devices`           | `() → Vec<AudioInputDeviceInfo>`                                                                                   |
| `start_audio_preview`                | `(app, preview_state, device_name) → Result<(), String>`                                                          |
| `stop_audio_preview`                 | `(preview_state) → ()`                                                                                             |
| `start_recording`                    | `(app, state, device_name) → Result<(), AudioRecorderError>`                                                      |
| `stop_recording`                     | `(state) → Result<StopRecordingResult, AudioRecorderError>`                                                       |
| `save_recording_file`                | `(id, app, state) → Result<String, String>` （回傳檔案路徑）                                                      |
| `read_recording_file`                | `(id, app) → Result<Response, String>` （**IPC binary response**，macOS 走 JSON `number[]`，前端用 `new Uint8Array(raw)` 轉換） |
| `delete_all_recordings`              | `(app) → Result<u32, String>`                                                                                      |
| `cleanup_old_recordings`             | `(days, app) → Result<Vec<String>, String>` （回傳已刪檔的 id list）                                              |

**型別**：
- `AudioInputDeviceInfo = { name: string }`
- `StopRecordingResult = { recordingDurationMs: number, peakEnergyLevel: number, rmsEnergyLevel: number }`
- `AudioRecorderError`（thiserror enum，serialize 為 string）

### 2.4 系統音量（2 個 · `plugins/audio_control.rs`）

```ts
invoke('mute_system_audio')    → Result<(), String>
invoke('restore_system_audio') → Result<(), String>
```

**順序敏感**：必須在錄音前 mute、錄音後立刻 restore；shutdown 時也必須最先還原（見 `architecture-backend.md` §RunEvent::Exit）

### 2.5 剪貼簿與貼上（3 個 · `plugins/clipboard_paste.rs`）

| Command                  | 簽名                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `paste_text`             | `(text: string, restore_clipboard: bool) → Result<(), ClipboardError>`（`restore_clipboard` = 未開啟「轉錄結果複製到剪貼簿」時才還原原本剪貼簿內容） |
| `copy_to_clipboard`      | `(text: string) → Result<(), ClipboardError>`              |
| `capture_target_window`  | `() → ()`                                                  |

### 2.6 鍵盤監測（2 個 · `plugins/keyboard_monitor.rs`）

```ts
invoke('start_quality_monitor')    → void
invoke('start_correction_monitor') → void
```
（Rust 端簽章為 `(app: AppHandle)`，由 Tauri 注入，呼叫端不傳。）

### 2.7 文字場讀取（4 個 · `plugins/text_field_reader.rs`）

macOS 走 AXUIElement、Windows 走 UI Automation（`IUIAutomation` + TextPattern/ValuePattern，
跑在專用 MTA worker 執行緒）。`read_selection_state` 的選取三態判定目前僅 macOS 有實作，
Windows 一律回 `unavailable` 而落回剪貼簿後備。

```ts
invoke('read_focused_text_field') → Result<string | null, string>
invoke('read_selected_text')      → Result<string | null, string>
invoke('read_selection_state')    → { kind: 'selection' | 'noSelection' | 'unavailable'; text: string | null }
invoke('get_foreground_app_name') → string | null
```

- `read_selection_state` 用於編輯模式偵測。macOS 走 AX worker 執行緒並以 `spawn_blocking` 等待——AX server 卡死時最壞會等 `SELECTION_READ_TIMEOUT_MS`，若阻塞 Tauri 主執行緒會連帶延後緊接其後的 `play_start_sound` / `start_recording`（錄音起點延遲＝開頭語音被吃掉）。
- single-flight：熱鍵連按時重入直接回 `unavailable`，避免 AX 讀取堆疊。非 macOS 一律回 `unavailable`。

### 2.8 LLM / 轉錄（3 個 · `plugins/transcription.rs`）

#### `transcribe_audio`
```ts
invoke('transcribe_audio', {
  apiKey: string,
  vocabularyTermList?: string[] | null,
  modelId?: string,        // Whisper 預設 'whisper-large-v3'；Gemini / MAI 走獨立模型
  language?: string | null, // null／省略 = 不送 language 欄位，由 provider 自動偵測
  provider?: 'groq' | 'azure' | 'gemini' | 'mai',  // 預設 groq；未知值 fail-closed 報錯
  endpoint?: string | null,        // Azure OpenAI 或 MAI 的 Azure AI Speech endpoint
  deployment?: string | null,      // Azure
  apiVersion?: string | null,      // Azure
  authMode?: 'key' | 'bearer' | null,  // Azure wire 驗證方式
  candidateLocales?: string[] | null, // MAI Fast：至多一個 BCP-47 語言提示（空 = 多語自動）
  transcribeStyle?: 'default' | 'verbatim' | null, // MAI：default 不送欄位
}) → Result<TranscriptionResult, TranscriptionError>
```

#### `retranscribe_from_file`
```ts
invoke('retranscribe_from_file', {
  filePath: string,        // Rust 端為 file_path
  apiKey: string,
  vocabularyTermList?: string[] | null,
  modelId?: string,
  language?: string | null,
  provider?: 'groq' | 'azure' | 'gemini' | 'mai',
  endpoint?: string | null, deployment?: string | null,
  apiVersion?: string | null, authMode?: 'key' | 'bearer' | null,
  candidateLocales?: string[] | null, transcribeStyle?: 'default' | 'verbatim' | null, // MAI Fast：至多一個 locale
}) → Result<TranscriptionResult, TranscriptionError>
```

#### `test_whisper_connection`
```ts
invoke('test_whisper_connection', {
  apiKey: string, modelId?: string,
  provider?: 'groq' | 'azure' | 'gemini' | 'mai',
  endpoint?: string | null, deployment?: string | null,
  apiVersion?: string | null, authMode?: 'key' | 'bearer' | null,
  candidateLocales?: string[] | null, transcribeStyle?: 'default' | 'verbatim' | null, // MAI Fast：至多一個 locale
}) → Result<(), TranscriptionError>
```
- **呼叫端**：`src/lib/connectionTest.ts`（SettingsView 的連線測試按鈕）

**型別**：
- `TranscriptionResult = { rawText: string, transcriptionDurationMs: number, noSpeechProbability: number | null, peakEnergyLevel: number, rmsEnergyLevel: number, promptTokens: number | null, completionTokens: number | null, totalTokens: number | null }`
  — `noSpeechProbability`：Gemini 與 MAI 無此信號回 `null`，前端幻覺偵測 Layer 2b 跳過
  — `peak/rmsEnergyLevel`：僅 `retranscribe_from_file` 會從 WAV 計算；即時轉錄路徑留 `0.0`（改用 recorder 的 `StopRecordingResult`）
  — `prompt/completion/totalTokens`：僅 Gemini 回報（依 token 計量）；Whisper（Groq/Azure）以音訊時長計費，為 `null`
- `TranscriptionError`（thiserror enum）

### 2.9 音效回饋（4 個 · `plugins/sound_feedback.rs`）

```ts
invoke('play_start_sound')    → void
invoke('play_stop_sound')     → void
invoke('play_error_sound')    → void
invoke('play_learned_sound')  → void
```

### 2.10 Azure 驗證（1 個 · `plugins/azure_auth.rs`）

```ts
invoke('get_azure_entra_token', {
  tenantId: string, clientId: string, clientSecret: string, scope: string,
}) → Result<{ accessToken: string, expiresIn: number }, string>
```
- **呼叫端**：`src/lib/azureAuth.ts`（`getAzureAccessToken`，含快取與提前 60 秒續期）
- **為何走 Rust**：reqwest 不帶 browser `Origin` header，避免 Entra 回 `AADSTS9002326`
- **scope 依 API 路徑選**（非 host）：v1 `/openai/v1/` chat → `ai.azure.com/.default`；deployments/Whisper 路徑 → `cognitiveservices.azure.com/.default`

### 2.11 檔案傳輸（2 個 · `plugins/file_transfer.rs`）

```ts
invoke('save_text_file', { path: string, content: string }) → Result<(), string>
invoke('read_text_file', { path: string })                  → Result<string, string>
```
- **呼叫端**：SettingsView 的備份匯出 / 匯入
- `read_text_file` 檔案過大時回符號錯誤字串 `"FILE_TOO_LARGE"`

---

## 三、Rust → Frontend Events（13 個）

> 熱鍵／監測類 payload 介面定義於 `src/types/events.ts`（後綴 `*Payload`）；音訊類（`WaveformPayload` / `AudioPreviewLevelPayload`）在 `src/types/audio.ts`；`theme:os-changed` 直接送字串，無介面。

### 3.1 熱鍵類（8 個 · `plugins/hotkey_listener.rs`）

| Event                          | 常量名                          | Payload                          |
| ------------------------------ | ------------------------------- | -------------------------------- |
| `hotkey:pressed`               | `HOTKEY_PRESSED`                | `HotkeyEventPayload`             |
| `hotkey:released`              | `HOTKEY_RELEASED`               | `HotkeyEventPayload`             |
| `hotkey:toggled`               | `HOTKEY_TOGGLED`                | `HotkeyEventPayload`             |
| `hotkey:error`                 | `HOTKEY_ERROR`                  | `HotkeyErrorPayload`             |
| `hotkey:mode-toggle`           | `HOTKEY_MODE_TOGGLE`            | `()`                             |
| `escape:pressed`               | `ESCAPE_PRESSED`                | `()`                             |
| `hotkey:recording-captured`    | `HOTKEY_RECORDING_CAPTURED`     | `RecordingCapturedPayload`       |
| `hotkey:recording-rejected`    | `HOTKEY_RECORDING_REJECTED`     | `RecordingRejectedPayload`       |

### 3.2 鍵盤監測類（2 個 · `plugins/keyboard_monitor.rs`）

| Event                       | 常量名                              | Payload                            |
| --------------------------- | ----------------------------------- | ---------------------------------- |
| `quality-monitor:result`    | `QUALITY_MONITOR_RESULT`            | `QualityMonitorResultPayload`      |
| `correction-monitor:result` | `CORRECTION_MONITOR_RESULT`         | `CorrectionMonitorResultPayload`   |

### 3.3 音訊類（2 個 · `plugins/audio_recorder.rs`）

| Event                  | 常量名                       | Payload                                           |
| ---------------------- | ---------------------------- | ------------------------------------------------- |
| `audio:waveform`       | `AUDIO_WAVEFORM`             | `WaveformPayload { levels: [f32; 6] }`            |
| `audio:preview-level`  | `AUDIO_PREVIEW_LEVEL`        | `AudioPreviewLevelPayload { level: f32 }`         |

### 3.4 主題類（1 個 · `lib.rs`）

| Event               | 常量名             | Payload                        |
| ------------------- | ------------------ | ------------------------------ |
| `theme:os-changed`  | `THEME_OS_CHANGED` | `"dark"` \| `"light"`（字串）  |

> Windows 上透明且隱藏的 HUD 收不到 `WM_THEMECHANGED`，故由 Rust 輪詢登錄檔後主動廣播。

---

## 四、Frontend-only Events（8 個 · 不經 Rust）

| Event                          | 常量名                          | 發送方             | 接收方             |
| ------------------------------ | ------------------------------- | ------------------ | ------------------ |
| `voice-flow:state-changed`     | `VOICE_FLOW_STATE_CHANGED`      | useVoiceFlowStore  | **目前無接收方**（emit 保留，尚無 listener） |
| `transcription:completed`      | `TRANSCRIPTION_COMPLETED`       | useHistoryStore（`emitToWindow("main-window", …)`） | DashboardView、HistoryView |
| `settings:updated`             | `SETTINGS_UPDATED`              | useSettingsStore   | HUD App.vue（目前唯一 listener） |
| `vocabulary:changed`           | `VOCABULARY_CHANGED`            | useVocabularyStore | All Windows        |
| `vocabulary:learned`           | `VOCABULARY_LEARNED`            | useVoiceFlowStore  | HUD NotchHud       |
| `replacements:changed`         | `REPLACEMENTS_CHANGED`          | useReplacementStore（規則 CRUD 後） | HUD（App.vue，重載取代規則） |
| `database:ready`               | `DATABASE_READY`                | Dashboard（main-window.ts，DB migration 完成後） | HUD（App.vue / `waitForDatabaseReady`） |
| `database:ready-ping`          | `DATABASE_READY_PING`           | HUD（請 Dashboard 重新廣播，解決競態） | Dashboard（收到後 replay `database:ready`） |

---

## 五、Permissions Mapping（`capabilities/default.json`）

Tauri v2 採 capability-based permission 系統，Frontend 只能呼叫已授權的 command：

| 來源        | 必要 permissions（節錄）                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| 視窗操作    | `core:window:allow-show`、`allow-hide`、`allow-set-position`、`allow-set-focus`、`allow-set-ignore-cursor-events`、`allow-start-dragging`、`allow-center` |
| 事件        | `core:event:allow-listen`、`allow-emit`、`allow-emit-to`                                                 |
| Shell       | `shell:allow-open`（用於開系統設定）                                                                    |
| SQL         | `sql:default`、`sql:allow-execute`                                                                       |
| Store       | `store:default`                                                                                          |
| HTTP        | `http:default` 開放：`api.groq.com/*`、`api.openai.com/*`、`api.anthropic.com/*`、`generativelanguage.googleapis.com/*`、`*.openai.azure.com/*`、`*.services.ai.azure.com/*`、`*.cognitiveservices.azure.com/*`、`login.microsoftonline.com/*` |
| Autostart   | `autostart:default`                                                                                      |
| Updater     | `updater:default`                                                                                        |
| Process     | `process:default`                                                                                        |

> **⚠️ 注意**：`capabilities/default.json` 的 HTTP allowlist 與 `tauri.conf.json` 的 CSP `connect-src` 必須同步，新增 provider 時**兩處都要改**（只改一處在 production build 會被攔截，dev mode 不受 CSP 影響）。目前兩者已對齊（含 Sentry ingest 端點僅在 CSP）。
>
> Rust 端的 `transcription.rs` / `azure_auth.rs` 用 `reqwest` 直連，**不**受此 allowlist 與 CSP 約束。

---

## 六、外部 API 契約（節選）

### 6.1 轉錄（Rust 直呼 `reqwest`，不受 CSP／allowlist 約束）

**Groq Whisper**（`provider: 'groq'`，預設）

```
POST https://api.groq.com/openai/v1/audio/transcriptions
  multipart/form-data:
    file: <wav binary>
    model: whisper-large-v3 | whisper-large-v3-turbo
    language: zh | en | ja | ko | ...（或省略 = auto）
    prompt: <vocabulary terms joined>
  Authorization: Bearer <api_key>
```

### 6.2 LLM Provider（Frontend 透過 `@tauri-apps/plugin-http`）

> **Azure Whisper**（`provider: 'azure'`）走 `{endpoint}/openai/deployments/{deployment}/audio/transcriptions?api-version=...`，同 multipart 協定並保留 `verbose_json` / `no_speech_prob`；驗證用 `api-key` header 或 Entra ID 的 `Authorization: Bearer`（token 由 `get_azure_entra_token` 取得）。
>
> **Gemini**（`provider: 'gemini'`）**不走** Whisper multipart 協定，而是 `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`（`x-goog-api-key` header + inline base64 WAV + structured output `{ transcript }`）。模型走**獨立的 Gemini 轉錄清單**（Rust `GEMINI_TRANSCRIPTION_MODELS` allowlist：`gemini-3.5-flash-lite`（預設）／`gemini-3.6-flash`，須與 TS `modelRegistry.ts` 的 `GEMINI_TRANSCRIPTION_MODEL_LIST` 一致），**不吃 `WhisperModelId`**；allowlist 外的值 fallback 回預設模型，避免壞掉的匯入設定打到不存在的端點。inline 上限 20MB request（raw WAV 約 14 MiB；16kHz mono 約 7 分 39 秒，裝置 fallback 到 48kHz 則約 2 分 33 秒）；無 `no_speech_prob` → `noSpeechProbability` 回 `null`。

| Provider   | Endpoint                                                                                | Auth Header                       | Body 特例                                                |
| ---------- | --------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------- |
| Groq       | `https://api.groq.com/openai/v1/chat/completions`                                       | `Authorization: Bearer ...`       | OpenAI 風格                                              |
| OpenAI     | `https://api.openai.com/v1/chat/completions`                                            | `Authorization: Bearer ...`       | 用 `max_completion_tokens`，**非** `max_tokens`          |
| Anthropic  | `https://api.anthropic.com/v1/messages`                                                 | `x-api-key: ...` + `anthropic-version: 2023-06-01` | system message 提取至頂層 `system` 欄位       |
| Gemini     | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`       | `x-goog-api-key: ...`             | model 在 URL；user/assistant 在 `contents[].parts[].text`；assistant role → `"model"`；config 用 `generationConfig.maxOutputTokens` |

**Gemini finishReason 檢查**：`parseGeminiResponse` 會檢查 `candidates[0].finishReason`，非 `STOP`/`MAX_TOKENS`（如 `SAFETY`、`RECITATION`）拋錯，避免安全過濾靜默 fallback。

---

## 七、新增 Command / Event 的 Checklist

```
□ Rust 端
  ├─ 寫 #[command] 函式（確認回傳 Result 而非 panic）
  ├─ 在 plugins/<module>.rs（或 lib.rs）內定義
  ├─ 在 lib.rs::run() 的 generate_handler! 註冊（lib.rs:613，漏註冊 → 前端 invoke 會 timeout）
  └─ 若是 event，事件名兩端字串必須一致

□ Frontend 端
  ├─ 在 src/types/events.ts 新增 *Payload 介面
  ├─ 在 src/composables/useTauriEvents.ts 加 export const
  ├─ 在 store / view 內 import 常數使用（不可直接 import @tauri-apps/api/event）
  └─ 若 command 用到，可加型別別名於 src/types/

□ 文件
  ├─ 更新 .github/copilot-instructions.md IPC 契約表
  ├─ 更新 docs/api-contracts-backend.md
  └─ 用 ipc-review / tauri-reviewer subagent 審查兩端對齊
```
