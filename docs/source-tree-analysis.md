# Source Tree Analysis

> 由 BMad Document Project 工作流自動產生
> 掃描層級：**Exhaustive** · 掃描日期：2026-05-08（LOC 與模組清單已於 2026-07-29 校正）· 專案版本：0.14.0

本文件以「兩個 part」為視角註解 SayIt 的原始碼結構：

- **frontend** — `src/`（Vue 3 + Tauri JS API）
- **backend** — `src-tauri/`（Tauri v2 Rust runtime）

---

## 一、頂層結構（Repository Root）

```
say-it/
├── src/                    # Frontend part — Vue 3 + TS（雙視窗）
├── src-tauri/              # Backend part — Tauri v2 Rust runtime
├── tests/                  # 跨端測試（unit / component / e2e）
├── scripts/                # 發版腳本
│   └── release.sh          #   版本同步 + commit + tag + push
├── assets/                 # 共用靜態資源
├── _bmad/                  # BMad framework（不入版本記錄）
├── _bmad-output/           # BMad 規劃 / 實作 / 測試產出物
│   ├── project-context.md  #   AI Agent 必讀規則（323 條）
│   ├── planning-artifacts/ #   PRD / Architecture / UX-UI Spec
│   ├── implementation-artifacts/  # Story / Tech Spec
│   └── test-artifacts/     #   測試框架文件
├── docs/                   # ← 本次掃描產出
├── .github/workflows/      # CI/CD
│   ├── ci.yml              #   PR/push 檢查
│   ├── release.yml         #   tag → 多平台建構 + Apple notarize
│   ├── claude.yml          #   已停用（遷移至原生 Copilot；workflow_dispatch-only）
│   └── claude-code-review.yml  #   已停用（遷移至原生 Copilot code review）
├── .claude/                # Claude Code skills + hooks 設定
├── design.pen              # Pencil MCP 設計稿（UI 實作前必讀）
├── .github/copilot-instructions.md  # AI Agent 唯一權威指南（IPC 契約表 / Hooks / 發版）
├── .github/instructions/   # 路徑範圍規則（frontend / rust / tests，依 applyTo glob 自動套用）
├── CHANGELOG.md
├── README.md
├── package.json            # pnpm@10.28.2 / type=module
├── pnpm-lock.yaml          # 🔴 受 protect-config.sh hook 保護
├── pnpm-workspace.yaml
├── vite.config.ts          # 多入口（HUD + Dashboard）
├── vitest.config.ts        # jsdom 環境
├── playwright.config.ts
├── eslint.config.js
├── tsconfig.json           # strict mode
├── components.json         # shadcn-vue 配置（new-york style）
├── index.html              # HUD 入口
├── main-window.html        # Dashboard 入口
└── .nvmrc                  # 鎖定 Node 24
```

> **入口點關鍵**：HUD 與 Dashboard 是兩個獨立 HTML 入口，各自有獨立 Vite entry，編譯成兩個 bundle 由 Tauri 載入到不同 `WebviewWindow`。

---

## 二、Frontend 結構（`src/`）

### 2.1 雙入口檔案

| 路徑                          | LOC  | 職責                                                                                                |
| ----------------------------- | ---: | --------------------------------------------------------------------------------------------------- |
| `src/main.ts`                 |  ~30 | **HUD 入口** — 載入 `App.vue`，初始化 Sentry HUD（無 tracing）、Pinia、i18n、主題、console 轉送     |
| `src/main-window.ts`          | ~150 | **Dashboard 入口** — 載入 `MainApp.vue`，初始化 DB（migration v1→v9）、Sentry Dashboard、router、autostart、自動清理錄音檔與日誌 |
| `src/App.vue`                 | ~150 | HUD root component（瀏海狀態浮窗）                                                                  |
| `src/MainApp.vue`             | ~400 | Dashboard root component（含 Sidebar、Sidebar Footer 的「檢查更新」按鈕）                           |
| `src/router.ts`               |  ~20 | 5 routes：`/dashboard` `/history` `/dictionary` `/settings` `/guide`，使用 `createWebHashHistory()` |

### 2.2 Stores（Pinia · `src/stores/`）

| 檔案                          | LOC   | 範疇                                                                                                              |
| ----------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------- |
| `useSettingsStore.ts`         | ~2.4k | API Key / 熱鍵 / 模型 / 音訊裝置 / 自動更新等所有設定（單一來源），含 `settings:updated` 廣播 |
| `useVoiceFlowStore.ts`        | ~2.3k | **核心狀態機** — 錄音→轉錄→AI 整理→貼上的完整 voice flow，協調所有 Tauri Command + Event |
| `useHistoryStore.ts`          |  ~900 | 轉錄歷史 CRUD（SQLite `transcriptions` 表）+ Dashboard 統計聚合 + 每日趨勢                                       |
| `useVocabularyStore.ts`       |  ~300 | 字典 CRUD + 廣播 `vocabulary:changed` / `vocabulary:learned`                                                      |
| `useReplacementStore.ts`      |  ~250 | 文字取代規則 CRUD — 字面／正則、beforeAI／afterAI／both 階段套用；驗證含規則數／樣式長度上限與 `new RegExp()` 可編譯性檢查（**注意：不防災難性回溯，非 ReDoS 防護**）        |

### 2.3 Composables（`src/composables/`）

| 檔案                       | LOC | 職責                                                       |
| -------------------------- | --: | ---------------------------------------------------------- |
| `useAudioWaveform.ts`      | ~80 | HUD 波形動畫（訂閱 `audio:waveform`）                     |
| `useAudioPreview.ts`       | ~80 | 設定頁面音量條（訂閱 `audio:preview-level`）              |
| `useTauriEvents.ts`        | ~80 | **唯一 Event API 入口** — 所有事件常數集中於此（避免散落） |
| `useTableSort.ts`          | ~70 | 通用表格排序（字典表格用）— 升／降二態，tieBreak 次鍵不隨方向反轉以維持穩定性 |
| `useFeedbackMessage.ts`    | ~30 | UI 訊息提示                                                |

### 2.4 Lib（無框架邏輯 · `src/lib/`）

| 檔案                          | LOC  | 職責                                                                                                |
| ----------------------------- | ---: | --------------------------------------------------------------------------------------------------- |
| `settingsTransfer.ts`         | ~600 | 設定與字典備份／還原 — AES-GCM 加密、敏感金鑰剔除、版本相容檢查、PBKDF2 迭代數上限（DoS 防護）    |
| `keycodeMap.ts`               | ~550 | 跨平台鍵碼對應（macOS / Windows）                                                                  |
| `database.ts`                 | ~500 | SQLite 連線池（HUD 與 Dashboard 共用）+ migration v1→v9                                             |
| `llmProvider.ts`              | ~500 | **多 Provider 抽象層** — Groq / Gemini / OpenAI / Anthropic / Azure 統一 fetch / parse             |
| `modelRegistry.ts`            | ~450 | LLM + Whisper 模型清單、預設值、下架遷移（`DECOMMISSIONED_MODEL_MAP`）                              |
| `enhancer.ts`                 | ~350 | LLM 文字整理（口語→書面語）                                                                         |
| `hallucinationDetector.ts`    | ~200 | Whisper 幻覺偵測 v3                                                                                 |
| `theme.ts`                    | ~200 | 主題同步（system / light / dark）— OS 外觀變更走 Rust `theme:os-changed` 廣播，HUD 透明背景收不到 WM_THEMECHANGED |
| `errorUtils.ts`               | ~200 | 錯誤訊息正規化                                                                                      |
| `vocabularyAnalyzer.ts`       | ~150 | LLM 智慧字典學習                                                                                    |
| `sentry.ts`                   | ~150 | 雙視窗各自初始化（`initSentryForHud` / `initSentryForDashboard`）+ `captureError` 統一入口          |
| `vocabularyTransfer.ts`       | ~150 | 字典匯入匯出 — 相容 SayIt JSON / 純文字 / CSV，詞長與權重正規化後去重                              |
| `usageTrend.ts`               | ~100 | 本地日／月轉 SQLite UTC 區間（避開 DST 邊界偏移）+ 趨勢缺席日補零                                  |
| `sentryScrubbing.ts`          | ~100 | Sentry 送出前遮蔽 — **default-deny**，移除逐字稿與使用者資訊，正則遮罩 API key / token / 路徑      |
| `azureAuth.ts`                | ~100 | Entra ID client-credentials token 快取 — 依 API 路徑選 scope，提前 60 秒續期；經 Rust 取 token 以避開 WebView `Origin` 造成的 `AADSTS9002326` |
| `connectionTest.ts`           | ~100 | 設定頁的 LLM / Whisper 連線診斷，保留 HTTP 狀態碼與回應內文供排錯                                  |
| `transcriptTransforms.ts`     |  ~90 | 逐字稿落地前的轉換管線 — 依序套用 beforeAI 取代規則與簡→繁轉換                                     |
| `autoUpdater.ts`              |  ~80 | 自動更新檢查（5 秒首次 + 4 小時間隔）                                                               |
| `logger.ts`                   |  ~80 | 前端 log 轉送 `tauri-plugin-log`；是否寫檔由 Rust `FILE_LOG_ENABLED` 決定，前端不閘控以免跨視窗狀態不同步 |
| `formatUtils.ts`              |  ~70 | 時間 / 字數 / 大小格式化                                                                            |
| `simplifiedToTraditional.ts`  |  ~60 | 簡→繁（台灣）轉換，惰性載入 opencc-js（~1.2MB）；轉換失敗 **fail-open** 回原文，不阻斷貼上         |
| `apiPricing.ts`               |  ~50 | API 成本估算                                                                                        |
| `semanticDriftObserver.ts`    |  ~40 | 語意漂移**影子觀測**（目前不退回）— 以字元 bigram 包含率記 content-free log，待驗證誤判率後再決定是否啟用 |
| `utils.ts`                    |  ~10 | shadcn-vue `cn()` helper                                                                            |

### 2.5 Views（`src/views/`）

| 檔案                       | LOC   | 路由         | 職責                                                |
| -------------------------- | ----: | ------------ | --------------------------------------------------- |
| `SettingsView.vue`         | ~3.8k | `/settings`  | API Key / 模型 / 熱鍵 / 音訊裝置 / 取代規則 / 備份還原 / 進階設定 |
| `HistoryView.vue`          |  ~450 | `/history`   | 轉錄歷史瀏覽 / 搜尋 / 複製 / 重新轉錄 / 音訊播放    |
| `DashboardView.vue`        |  ~450 | `/dashboard` | 統計卡片 + 額度卡片 + 使用量圖表                    |
| `DictionaryView.vue`       |  ~350 | `/dictionary`| 字典 CRUD（手動 + AI 學習）                         |
| `FeatureGuideView.vue`     |  ~100 | `/guide`     | 功能導覽                                            |

### 2.6 Components（`src/components/`）

| 檔案                       | LOC  | 類別                                              |
| -------------------------- | ---: | ------------------------------------------------- |
| `NotchHud.vue`             | ~900 | **HUD 主元件** — 狀態切換、波形、字典學到提示 |
| `AccessibilityGuide.vue`   | ~200 | macOS 輔助使用權限引導                            |
| `AppSidebar.vue`           | ~200 | Dashboard 側邊欄（shadcn-vue Sidebar）            |
| `DashboardUsageChart.vue`  | ~100 | unovis 統計圖表（無資料時顯示 `dashboard.noRecords` 空狀態） |
| `NavUser.vue`              | ~100 | 側邊欄底部使用者區塊                              |
| `SectionCards.vue`         | ~100 | Dashboard 統計卡片                                |
| `NavDocuments.vue`         |  ~90 | 側邊欄文件區                                      |
| `ConnectionTestButton.vue` |  ~60 | 設定頁的連線測試按鈕（搭配 `connectionTest.ts`，成功顯示耗時、失敗顯示底層錯誤） |
| `NavMain.vue`              |  ~60 | 側邊欄主導航                                      |
| `NavSecondary.vue`         |  ~40 | 側邊欄次要導航                                    |
| `SiteHeader.vue`           |  ~20 | Dashboard 頂部                                    |
| `ui/`                      |    – | shadcn-vue 元件庫（21 種，禁止改動樣式）          |

### 2.7 i18n（`src/i18n/`）

```
src/i18n/
├── index.ts            # i18n 初始化
├── languageConfig.ts   # 語系列表、預設語系
├── prompts.ts          # 各 LLM 提示詞（依語系切換）
└── locales/
    ├── en.json
    ├── zh-TW.json     # 預設
    ├── zh-CN.json
    ├── ja.json
    └── ko.json
```

### 2.8 Types（`src/types/`）

| 檔案                  | 命名後綴               | 範疇                                  |
| --------------------- | ---------------------- | ------------------------------------- |
| `index.ts`            | `*Status`, `*State`    | HUD 狀態列舉                          |
| `events.ts`           | `*Payload`             | Tauri Event payload 介面              |
| `transcription.ts`    | `*Record`              | SQLite `transcriptions` 表型別        |
| `vocabulary.ts`       | `*Record`, `*Entry`    | 字典型別                              |
| `audio.ts`            | `*Handle`, `*Config`   | 音訊處理型別                          |
| `settings.ts`         | `*Config`              | 設定物件型別                          |

---

## 三、Backend 結構（`src-tauri/`）

```
src-tauri/
├── Cargo.toml                    # 🟡 受 protect-config.sh 警告
├── Cargo.lock                    # 🔴 受 protect-config.sh 阻擋
├── tauri.conf.json               # 🟡 視窗設定 / CSP / Bundle / Updater
├── Entitlements.plist            # macOS 權限（accessibility, audio-input）
├── Info.plist                    # macOS Bundle metadata
├── build.rs                      # tauri-build
├── capabilities/
│   └── default.json              # Tauri v2 permission system（HTTP allowlist）
├── icons/                        # 跨平台圖示（macOS .icns / Windows .ico / iOS / Android）
├── resources/sounds/             # start.wav / stop.wav（錄音回饋音）
└── src/
    ├── main.rs                   #  ~10 行 — 直接呼叫 sayit_lib::run()
    ├── lib.rs                    # ~1.2k 行 — 主 entry + invoke handler 註冊 + tray + graceful shutdown
    └── plugins/
        ├── mod.rs                #  ~10 行 — 模組宣告
        ├── hotkey_listener.rs    # ~2.1k 行 — 全域熱鍵（CGEventTap / Win32 Hook）
        ├── transcription.rs      # ~1.8k 行 — 轉錄（Groq Whisper / Azure Whisper / Gemini generateContent，Rust 直呼）
        ├── audio_recorder.rs     # ~1.1k 行 — cpal 錄音 + WAV 寫檔 + 波形 FFT
        ├── text_field_reader.rs  #  ~950 行 — 讀取游標文字／選取狀態（macOS AXUIElement、Windows UI Automation）
        ├── keyboard_monitor.rs   #  ~600 行 — 品質監測 + 矯正監測
        ├── clipboard_paste.rs    #  ~550 行 — Cmd+V / Ctrl+V 模擬貼上
        ├── audio_control.rs      #  ~450 行 — 系統音量 mute / restore
        ├── sound_feedback.rs     #  ~200 行 — start/stop/error/learned 音效
        ├── logging.rs            #  ~100 行 — 檔案日誌開關 / 開啟資料夾 / 清理舊日誌
        ├── azure_auth.rs         #  ~100 行 — Entra ID client-credentials token（避開 WebView Origin）
        └── file_transfer.rs      #   ~50 行 — 備份匯出 / 匯入的純文字檔讀寫
```

### 3.1 Backend 模組責任分布

| 模組                  | 平台特化                                          | 對外契約                                                      |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `hotkey_listener`     | macOS：CGEventTap；Windows：SetWindowsHookEx      | 7 個 Command + 8 個 Event（pressed/released/toggled/error...） |
| `audio_recorder`      | cpal 跨平台 + macOS Arc cycle workaround          | 10 個 Command + 2 個 Event（waveform / preview-level）        |
| `keyboard_monitor`    | macOS：CGEventTap                                 | 2 個 Command + 2 個 Event（quality / correction）             |
| `clipboard_paste`     | macOS：CGEvent；Windows：SendInput                | 3 個 Command                                                  |
| `audio_control`       | macOS：CoreAudio FFI；Windows：IAudioEndpointVolume | 2 個 Command                                                  |
| `transcription`       | 跨平台 reqwest                                    | 3 個 Command（transcribe / retranscribe_from_file / test_whisper_connection） |
| `text_field_reader`   | macOS：AXUIElement；Windows：UI Automation（`IUIAutomation` + TextPattern/ValuePattern，MTA worker 執行緒） | 4 個 Command（含 `read_selection_state`，其選取三態僅 macOS 實作，Windows 回 `unavailable` 落回剪貼簿後備） |
| `sound_feedback`      | 跨平台 cpal                                       | 4 個 Command                                                  |
| `logging`             | 跨平台 tauri-plugin-log                           | 3 個 Command（開關 / 開資料夾 / 清理舊檔）                    |
| `azure_auth`          | 跨平台 reqwest                                    | 1 個 Command（`get_azure_entra_token`，不帶 browser `Origin`）|
| `file_transfer`       | 跨平台                                            | 2 個 Command（備份匯出 / 匯入，過大回 `FILE_TOO_LARGE`）      |

### 3.2 lib.rs 的關鍵函式

| 函式                                | 用途                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `run()`                             | Tauri Builder 主入口（含 plugin 註冊、tray、setup、shutdown）                                  |
| `configure_macos_notch_window()`    | macOS：用 `objc::msg_send` 設定 NSWindow level=27 + collectionBehavior（瀏海覆蓋層）           |
| `configure_windows_topmost_window()`| Windows：HWND_TOPMOST + WS_EX_TOOLWINDOW + WS_EX_NOACTIVATE                                    |
| `find_monitor_for_cursor()`         | 純函式，11 個單元測試（含 Retina + portrait + dual-DPI fallback）                              |
| `calculate_centered_window_x_logical()` | logical 座標置中（繞過 tao cross-DPI bug）                                                  |
| `request_app_restart()` + `RunEvent::Exit` | 用 `_exit(0)` 截殺 Tauri 內建 restart 後自行 spawn — 確保 graceful shutdown 順序          |

---

## 四、Tests 結構（`tests/`）

```
tests/
├── README.md         # 測試總覽
├── unit/             # Vitest unit
├── component/        # @vue/test-utils
├── e2e/              # Playwright
└── support/          # 共用 fixture / helper
```

> Rust 單元測試內嵌於 `src-tauri/src/**/*.rs` 的 `#[cfg(test)] mod tests`，例如 `lib.rs` 末段有 19 個 `find_monitor_for_cursor`（11 個）/ `calculate_centered_window_x*`（8 個）測試。

---

## 五、Hooks 與保護檔案

`.claude/settings.json` 設定四個 PostToolUse / PreToolUse hooks：

| Hook                  | 觸發             | 行為                                                          |
| --------------------- | ---------------- | ------------------------------------------------------------- |
| `protect-config.sh`   | PreToolUse Edit  | 🔴 `Cargo.lock` / `pnpm-lock.yaml` 禁改；🟡 `tauri.conf.json` / `Cargo.toml` 警告 |
| `typecheck.sh`        | PostToolUse Edit | `.ts/.vue` 改動後跑 `vue-tsc --noEmit`（非阻斷）              |
| `rustfmt.sh`          | PostToolUse Edit | `.rs` 改動後跑 `rustfmt`                                      |
| `eslint.sh`           | PostToolUse Edit | `.ts/.vue` 改動後 `eslint --fix`（跳過 `components/ui/`）     |

---

## 六、關鍵交互點（為 PRD 提供導引）

1. **「錄音 → 轉錄 → 整理 → 貼上」流程的中樞** = `useVoiceFlowStore.ts`（~2.3k 行）— 修改錄音流程必先讀此檔。
2. **「設定」全部入口** = `useSettingsStore.ts`（~2.4k 行）+ `SettingsView.vue`（~3.8k 行）— 新增任何設定欄位需同步兩處。
3. **「IPC 契約」唯一定義處** = `lib.rs` 的 `invoke_handler!` macro + `useTauriEvents.ts` 常數 — 新增 Command / Event 必須兩端對齊（用 `tauri-reviewer` subagent 審查）。
4. **「DB Schema」單一來源** = `src/lib/database.ts` 的 migration 鏈（目前最新 **v9**）— 加欄位請追加**下一個未使用的版本號**，不要直接改舊 migration。每段 migration 的守衛是 `if (currentVersion < N)`，重複使用既有版本號會讓已升級的使用者靜默跳過，導致新舊安裝的 schema 不一致。
5. **「LLM Provider」抽象邊界** = `src/lib/llmProvider.ts` — 新增 provider 在此擴展即可，業務層（`enhancer.ts` / `vocabularyAnalyzer.ts`）不需改。
