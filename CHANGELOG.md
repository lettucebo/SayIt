# Changelog

SayIt 版本更新紀錄。

## [0.12.0] - 2026-07-18

### Added

- 編輯模式改用 macOS 輔助使用（AX）偵測選取文字，取代模擬 Cmd+C：先前判斷游標處是否有選取文字（決定要不要進「編輯模式」修改選取內容）靠模擬 Cmd+C，會造成兩個問題——按鍵還按著時偶爾多打一個「C」字元、以及某些編輯器在沒選取時會複製整行而被誤判成有選取。macOS 改為優先用被動 AX 查詢（三態：有選取／無選取／不可用），AX 可讀取時不需模擬按鍵、殘留字元問題不再發生，沒選取時也明確回報無選取以排除整行誤判；AX 讀不到時（某些 App）才在按鍵放開後退回原本的剪貼簿後備。Windows 仍沿用剪貼簿後備（UIA 待後續）。
- 轉錄失敗自動重試（Groq / Azure）：先前暫時性失敗（rate limit 429、5xx、連線中斷）會直接變成一次硬失敗、得重新錄音。現在最多嘗試 3 次（初次加最多 2 次重試）——429 尊重伺服器 Retry-After（超過 10 秒才放棄）、408／5xx／連線失敗用 1s／2s backoff；逾時與其他 4xx／解析錯誤不重試（重試也不會成功）。重試同時套用於 Groq 與 Azure Whisper。
- 繁體中文使用者的轉錄結果自動轉為繁體字：Whisper 預設輸出簡體中文，導致 zh-TW 使用者存下／貼上的原始轉錄是簡體（只有 AI 整理偶爾會修、不可靠）。新增以 opencc-js（台灣標準）在字元層級做轉換，套用在三個轉錄落地點（主流程、重送、歷史重新辨識）；只轉換字元、不改變使用者的用詞。字典（約 1.19MB）改為延遲載入、移出初始 bundle，且 fail-open——載入失敗回傳原文、絕不中斷貼上／重試。
- 新增 Gemini 3.1 Pro（Preview）模型：本版把 Gemini 更新至 3.x 後只提供兩個 flash 等級，缺 Pro 等級高品質選項。新增 `gemini-3.1-pro-preview`；Pro 不支援 `thinkingLevel: MINIMAL`（會 400）故改送 `LOW`，並依 Gemini 3 建議省略 temperature（既有 flash 模型不動，避免回歸）。
- Azure / Microsoft Foundry 新增「省略 temperature」設定（給 reasoning 模型部署）：Azure／Foundry chat 一律送 `temperature`，但 GPT-5 系列 deployment 會以 HTTP 400 拒絕。由於 Azure model 是使用者自訂的不透明 deployment 名稱，app 無法自動判斷是否為 reasoning 模型，故新增明確開關；刻意不自動改送 `reasoning_effort`（原始 GPT-5 deployment 不一定支援 "none"，會把 400 換成另一個錯）。預設關閉、維持既有行為。
- 隱藏 Dock 圖示設定（macOS）：macOS 使用者可在設定開啟後隱藏 Dock 圖示，讓 SayIt 以背景常駐工具形式運作。

### Fixed

- 「重送（resend）」缺少 AI 整理異常防護：重送既有錄音重跑 AI 整理時，不像主流程與歷史重新整理那樣帶「整理結果長度爆炸」防護，異常時沒有 fallback。現在改用與其他路徑相同、已測試過的共用防護（`enhanceWithAnomalyGuard`），行為一致。

### Improved

- 儀表板正確顯示 Gemini 的 LLM 用量：Gemini 在模型登錄的免費配額為 0，儀表板現在把 Gemini 用量呈現為「今日用量」並加上提示（5 語系），且「已計費／無免費配額」的 tooltip 改由是否真的有付費 provider 決定，避免 Gemini 被誤標成付費方案。
- 因應 Groq 2026-07 模型下架更新模型登錄：Groq 於 2026-07 陸續下架多個模型（llama-4-scout、qwen3-32b 已於 07-17 下架；預設的 llama-3.3-70b 將於 08-16 下架）。更新為新的 Groq 模型組（預設改為 qwen3.6-27b，另有 gpt-oss-120b／20b）、加入 Gemini 3.x 與 gpt-5.6-luna、移除退役的 claude-3-5-haiku；並加入多跳退役模型對應表與跳數限制解析器，確保使用者先前存下的舊模型 id 永遠不會解析到已死的模型。同時修正各 provider 的 reasoning 請求參數（OpenAI GPT-5.x 送 `reasoning_effort: none` 避開 temperature-400、抑制 gpt-oss 的 reasoning、Qwen3.x 送 none、Gemini 3.x 送 MINIMAL、Gemini 3.1 Pro 送 LOW）。

## [0.11.11] - 2026-07-03

### Improved

- 啟動與載入效能、安裝體積優化（一次跨面向的 bundle 瘦身）：`logo` 圖從 1024×1024（1.44MB）重新輸出為 128px（6.4KB，僅以 28px 顯示，省下約 1.4MB 打包／安裝體積）；Dashboard 四個分頁改為按需（lazy）載入，儀表板首載 JS 由約 546KB 降至約 70KB，各分頁改為進入該頁才下載；錯誤遙測（Sentry）SDK 與非預設語系（日文／簡中／韓文）改為延遲載入，讓透明輕量的 HUD 浮窗不再預載用不到的約 440KB Sentry 與其他語系包；並以 `manualChunks` 明確切分 `vendor-vue` / `vendor-reka-ui` 以改善快取。順帶修正 `vendor` 切分在不同平台（Windows／macOS）產物不一致（module id 一律為正斜線，先前誤用 `path.sep` 比對）、以及 `@sentry/vue` 被誤併入預載 chunk 的問題，讓 HUD 真正保持精簡。
- 語音「停止錄音 → 貼上」延遲降低：錄音檔存檔改為與轉錄平行（背景寫入），不再卡在停止錄音後、轉錄開始前的熱路徑上；並移除轉錄與 AI 整理兩階段對詞彙表的重複查詢（改為重用同一份 top-50 結果）。
- 每日用量統計查詢優化：`api_usage` 新增 `created_at` 索引（append-only v9 migration），每日配額查詢由 `DATE(created_at, 'localtime')`（函式包裹欄位使索引失效）改為可命中索引的 `created_at >= ? AND < ?` 範圍查詢，語意（本地日界線）維持不變。
- Azure（Microsoft Foundry）Entra ID 取 token 的 HTTP client 改為 process 內共用（`OnceLock`），不再每次請求重建連線池／TLS 設定。

### Fixed

- 每日用量統計在夏令時間（DST）轉換日的午夜前後可能少算／多算一小時的問題：原本以「當日起始 + 24 小時」計算當日範圍，但 DST 轉換日的本地日實為 23／25 小時。改以「隔日本地午夜」為上界，維持正確的本地日語意（僅影響有 DST 的時區，每年兩天）。
- 極少數資料庫在先前失敗的 migration 後遺失 `api_usage` 表時，啟動可能因新索引建立而初始化失敗的問題：新 migration 加入資料表存在性護欄，並在關鍵表恢復後冪等補建 `created_at` 索引，確保恢復路徑不受影響、且恢復重建的表也保有效能索引。
- 錯誤遙測 SDK 動態載入失敗時，可能因未處理的 Promise rejection 觸發全域錯誤處理再回呼自身而形成迴圈的風險：於錯誤上報路徑補上 `catch`，載入失敗時僅記錄於 console 而不再冒泡。

## [0.11.10] - 2026-07-02

### Fixed

- HUD 浮窗（notch）在「深色」與「跟隨系統（系統為深色）」下仍顯示淺色的問題：根因是 `NotchHud.vue` 的 scoped 樣式選擇器 `:global(html.dark) .notch-hud` 在 Vue 3.5 的 scoped CSS 編譯器下被錯誤編成 `html.dark`（後代 `.notch-hud` 被丟棄），使深色配色變數被套在 `<html>` 上、又被 notch 自身宣告的淺色變數遮蔽，導致 HUD 永遠淺色。改用 `html.dark .notch-hud`（編譯為 `html.dark .notch-hud[data-v]`），把深色變數直接套在 notch 上。此問題自 HUD 主題功能初版即存在；先前 0.11.7／0.11.9 修的是系統外觀「偵測」，但因這個樣式 bug，深色 HUD 一直未能真正顯示

## [0.11.9] - 2026-06-30

### Fixed

- HUD 浮窗在「跟隨系統」下、執行期切換 OS 明暗主題時不會即時跟著變的問題（Windows）：透明且預設隱藏的 HUD WebView（WebView2）收不到 `WM_THEMECHANGED`，因此 OS 主題在 app 執行期間切換時，HUD 會停在舊配色、與儀表板不一致。改由 Rust 端讀取系統登錄 `AppsUseLightTheme`、以 1.5 秒輪詢廣播 `theme:os-changed`，HUD 收到後即時套用；並修正「在權威讀取之前就先註冊廣播監聽」的競態，避免錯過第一次切換
- 轉錄失敗時錯誤訊息過於籠統的問題：原本多種 Whisper／轉錄錯誤都落到同一句通用訊息，使用者難以判斷是網路、金鑰、檔案還是服務端問題。新增更多狀態碼對應與錯誤分類（含診斷碼），讓失敗提示更具體、可行動

### Improved

- 錯誤遙測（Sentry）整合改為真正可用且隱私安全：先前前端 `@sentry/vue` 事件因 WebView CSP `connect-src` 未含 Sentry ingest 主機而被靜默封鎖（正式版 90 天內 0 事件）。本版（1）將 ingest 主機加入 CSP 放行前端事件；（2）加入 `beforeSend`／`beforeBreadcrumb` scrubbers 與 Rust `before_send`，以白名單方式確保轉錄／整理文字、字典詞、API 金鑰／Azure 憑證、游標欄位文字、剪貼簿內容等敏感資料絕不上傳；（3）啟用 Rust application-mode Release Health（crash-free sessions，並移除前端 BrowserSession 避免雙視窗重複計數）；（4）發版時關聯 commit（suspect commits）並記錄 production deploy。全程維持 `sendDefaultPii: false`、不啟用 Session Replay

## [0.11.8] - 2026-06-30

### Added

- 歷史記錄每筆「重新辨識／重新整理」：先前轉錄失敗或想重做某一筆，只能重新錄音，無法對歷史中既有的錄音重來。現在歷史記錄每一筆都可直接「重新辨識」（用保存的原始錄音重送 Whisper 轉錄）或「重新整理」（用現有設定重跑 AI 整理）；結果只更新該筆、不貼上、不影響 HUD 狀態機，重新辨識會沿用詞彙表並重新做幻覺偵測

## [0.11.7] - 2026-06-30

### Fixed

- HUD 浮窗不跟隨「跟隨系統」主題的問題：根因是 system 模式下各視窗各自用 CSS `matchMedia('(prefers-color-scheme: dark)')` 判斷系統明暗，但透明的 HUD 浮窗 WebView（Windows WebView2）不一定正確回報系統外觀，導致切到「跟隨系統」時儀表板會跟著變、HUD 卻停在淺色。改以 Tauri 視窗主題 API（`getCurrentWindow().theme()` + `onThemeChanged`）取得權威系統外觀並即時跟隨，`matchMedia` 僅作為非 Tauri 環境的 fallback（新增 capability `core:window:allow-theme`）

### Improved

- 關於頁更新維護者資訊：作者改為現任維護者（含個人網站與社群連結），原作者保留為頁尾小字 credit

## [0.11.6] - 2026-06-30

### Added

- 淺色 / 深色 / 跟隨系統 佈景主題切換（#5）：先前介面僅深色，白天或亮環境較刺眼。新增「設定 → 應用程式」的主題下拉，可選淺色、深色或跟隨系統；「跟隨系統」會隨 OS 日夜模式自動切換。偏好以 `tauri-plugin-store` 持久化、納入備份匯出/匯入，HUD 浮窗與 Dashboard 雙視窗透過 `SETTINGS_UPDATED` 即時同步；並在首次繪製前由 `localStorage` 快取套用，避免啟動瞬間閃黑

### Improved

- 發版產物新增 SHA256 checksums，並補上 Windows SmartScreen 開啟說明
- GitHub Release 內文改用對應版本的 CHANGELOG 區塊自動帶入

## [0.11.5] - 2026-06-28

### Added

- 智慧字典學習 Windows 支援：智慧字典的「讀取游標附近文字供 AI 分析」原本只在 macOS 運作，現在 Windows 改用 UI Automation 實作，讓 Windows 使用者也能在轉錄貼上後自動偵測手動修正、由 AI 逐步學習常用詞彙與專有名詞（隱私：只讀取游標附近文字用於當下分析，不儲存原文）

### Improved

- CI 由 Claude Code 遷移至原生 GitHub Copilot：原本依賴 `anthropics/claude-code-action` 的 PR 自動審查在本 fork 每次都失敗（未安裝 Claude Code GitHub App、`CLAUDE_CODE_OAUTH_TOKEN` 為空導致 401）。改用原生 Copilot code review 與 `@copilot` 互動後，PR 檢查不再出現紅色雜訊
- 本 fork 改為自走 release：macOS 改未簽名建置（無 Apple Developer 憑證）、自動更新改用本 fork 專屬簽章金鑰並把 updater endpoint 指向本 repo、release 用到的非機密設定（Sentry DSN/Org/Project）改用 GitHub variable（私鑰/token 才用 secret）、發布工作改用 `ubuntu-24.04-arm` runner

## [0.11.1] - 2026-06-25

### Added

- 每日使用趨勢圖優化：資料稀疏（最近只有少數幾天有使用）時，原本的趨勢圖會把僅有的 2 個資料點連成一條誤導性的斜線，且 X 軸出現重複日期標籤（例如連續三個 06/24）。改為把顯示區間內每一天都補成資料點（沒使用的天數補 0），並把區間從 30 天縮短為 14 天；X 軸刻度改落在實際日期上、自動隱藏重疊標籤；日期一律以本地時間對齊，避免 UTC 時區使用者看到差一天的標籤
- Azure / Microsoft Foundry provider 支援：AI 整理（chat）走 Azure OpenAI v1 端點、語音轉錄（Whisper）走 deployments 端點，驗證可選 API Key 或 Entra ID（App Registration / client credentials）。Entra token 由 Rust 端取得以避開 WebView 跨來源限制（`AADSTS9002326`），scope 依 API 路徑自動選擇（v1 chat 用 `ai.azure.com`、Whisper 用 `cognitiveservices.azure.com`）。設定中新增獨立「Azure / Microsoft Foundry」連線卡，chat 與 whisper 共用同一組 endpoint 與憑證
- 完整備份匯入匯出：可把設定與字典一次匯出成 `.sayit-backup` 檔（選用 PBKDF2 + AES-GCM 加密），並在另一台機器匯入還原。匯出會排除 API Key 等敏感欄位；匯入採原生檔案對話框選檔
- 匯入外部字典檔：支援匯入 Typeless 等外部工具的字典檔，方便從其他工具遷移
- 字典單檔匯入匯出：字典可單獨匯出／匯入一個檔案，與完整備份分開
- Dashboard 計費用量顯示：對 OpenAI / Anthropic / Azure 等計費型 provider，卡片改顯示「當日實際用量」而非免費額度百分比；同時使用多個 provider 時於卡片內分列各自的計費用量
- 選用的 debug 檔案紀錄：設定中可開啟把 log 寫入檔案，方便回報問題時提供診斷資訊，預設關閉

### Fixed

- 字典匯入造成既有字詞遺失的問題：根因是 tauri-plugin-sql 不保證連線親和性，跨 `execute` 呼叫的 `BEGIN`/`COMMIT` 交易可能落在沒有交易的連線上而失效。改為移除 migration 與字典匯入中的跨呼叫交易
- 首次啟動偶發資料庫初始化失敗（HUD 與 Dashboard 兩視窗同時初始化 SQLite 的競態）：HUD 端的連線池存取改為等待 Dashboard migration 完成（`DATABASE_READY`）後才進行
- Azure Foundry provider 在實際使用中的多項修正：修正 Entra token scope 應依 API 路徑（而非 endpoint host）選擇、憑證庫信任與錯誤訊息對應，讓 Foundry 串接能端到端正常運作

### Improved

- Dashboard 計費用量列依 code review 微調呈現
- 字典頁移除與「完整備份」重複的匯出／匯入入口，避免使用者混淆

## [0.10.0] - 2026-05-08

### Added

- 設定中的「測試連線」按鈕：可即時驗證當前 LLM Provider / Whisper 模型的 API key 與連線是否正常，失敗時顯示具體原因（API key 無效 / 額度不足 / 服務端問題 / 網路問題），讓使用者能自助 debug 設定問題（#34）
- 設定可選擇「自動貼上後還原原本剪貼簿內容」：之前 SayIt 把轉錄文字寫進剪貼簿後就留在那裡，使用者原本複製的東西被覆蓋。新增「將轉錄文字複製到剪貼簿」toggle（設定 → 一般），預設 ON 保留現行行為（避免回歸），關閉時 SayIt 會在貼上後 200ms 還原使用者原本的剪貼簿（純文字場景；圖片/檔案因 arboard 無法無損 snapshot 而保持不動）（#35）

### Fixed

- Gemini 2.5 系列做 AI 整理時長轉錄文字被截斷的問題（#23、#34）：根因是 Gemini 把 thinking tokens 計入 `maxOutputTokens` 配額，原本對所有 provider 統一給 2048 token 預算被 thinking 吃掉一部分後不夠用。改為 per-provider 預設：Gemini / OpenAI 16384、Anthropic / Groq 8192（後者模型上限 8192，給 16384 會被 API reject）
- 使用 OpenAI 或 Anthropic 整理時被 Content Security Policy 阻擋的問題：`connect-src` 加入 `api.openai.com` 與 `api.anthropic.com`
- 轉錄失敗 catch path 沒寫入 `rmsEnergyLevel` 的問題：補上 assignment，避免幻覺偵測 fallback 邏輯收到 undefined

### Improved

- LlmProviderId switch 加上 exhaustiveness assertion：未來新增 provider 時編譯期會抓到漏處理的 case
- 錯誤傳遞鏈保留 `cause`：debug 時能看到完整堆疊
- CI 升級：push/PR 觸發 ESLint + cargo clippy + cargo test，避免 lint/test 倒退被 merge

## [0.9.5] - 2026-05-01

### Fixed

- 同時啟動多個 SayIt 實例造成熱鍵觸發後重複錄音、重複貼上的問題（Windows 受影響，macOS 因 Launch Services 預設單例較少觸發）：導入 `tauri-plugin-single-instance`，第二個實例啟動時立即退出，並把現有實例的 Dashboard 視窗叫到前景

## [0.9.4] - 2026-04-07

### Fixed

- 自訂字典在某些 Windows 環境下新增詞彙時報「table vocabulary has no column named source」的問題（#27）：在 DB 初始化的關鍵表驗證階段新增冪等的 vocabulary column 自我修復邏輯，無論 schema_version 為何都會檢查並補上缺失的 weight/source 欄位

## [0.9.3] - 2026-03-28

### Fixed

- 簡易模式 Fn 快捷鍵在 Globe 鍵 MacBook 上一觸發就馬上送出的問題：FlagsChanged handler 從 toggle-based 改為 flag-based 偵測，只回應 keycode 63 事件

## [0.9.2] - 2026-03-28

### Added

- Google Gemini LLM Provider：支援 Gemini 2.5 Flash 和 Flash-Lite（有免費額度），新增 API Key 管理、request/response 格式轉換
- Gemini SAFETY block 偵測：`finishReason` 非 STOP 時拋出有意義的錯誤，不再靜默 fallback
- Gemini 單元測試：buildFetchParams + parseProviderResponse + helpers（6 個測試）
- Tauri HTTP scope + CSP 加入 `generativelanguage.googleapis.com`
- 升級通知合併 LLM provider 項目，新增 Gemini 說明
- OpenAI 標示「推薦」（5 語系）

### Changed

- Provider 排序：Groq → Gemini → OpenAI → Anthropic（免費的在前面）
- Provider RadioGroup 從 3 欄改 2 欄（4 個 provider 排 2×2）
- 5 語系 provider description 加入 Gemini 有免費額度

## [0.9.1] - 2026-03-28

### Fixed

- HUD notch 寬度加寬（350→420px），避免錄音中模式標籤被 MacBook camera 區域遮擋
- mode-switch notch 寬度加寬（200→350px），確保切換模式標籤完整顯示
- mode-switch 消失時新增 collapsing 縮小動畫（原為直接淡出）
- Tauri HUD 視窗與 Rust 定位常數同步更新（400→470px）

## [0.9.0] - 2026-03-28

### Added

- 編輯選取文字功能：選取文字後觸發 SayIt，語音變成 AI 指令（翻譯、改寫、摘要等），處理結果直接取代原文
- Rust `read_selected_text` command：macOS AXSelectedText 讀取選取文字，共用 `FocusedElementContext` AX 走訪結構
- 功能介紹頁面：側邊欄新增「功能介紹」（Lightbulb icon），展示 8 個操作功能卡片
- Edit mode prompt 模板：五語系編輯模式專用 prompt（`EDIT_MODE_PROMPTS`）
- `EnhanceOptions.maxTokens`：edit mode 使用 4096（既有增強為 2048）
- DB migration v7→v8：`is_edit_mode`、`edit_source_text` 欄位
- HUD 琥珀色「編輯」badge + `HudStatus: "editing"` 狀態
- 升級通知新增 item9（編輯選取文字）並依亮點重新排序

### Improved

- Rust `text_field_reader.rs` 重構：提取 `FocusedElementContext` struct 消除 ~50 行重複 AX 走訪邏輯
- `isEditMode` 改為 computed（從 `editSourceText` 推導），消除冗餘 state
- `read_selected_text` 非阻塞偵測（`.then()`），不延遲開始音效
- HUD badge CSS 提取 `.hud-badge` 共用 base class
- `useHistoryStore` SQL SELECT 欄位提取 `TRANSCRIPTION_SELECT_COLUMNS` 常數
- 功能介紹文案改為生活化口吻（五語系）

## [0.8.9] - 2026-03-19

### Fixed

- 修正 macOS 上選擇特定麥克風後停止錄音，麥克風指示燈（橘色圓點）不消失的安全問題：cpal 0.15.3 CoreAudio backend 對非預設裝置建立 disconnect listener 造成 Arc 循環引用，AudioUnit 永不釋放。修正方式為優先使用 default_input_device() 避免循環引用，並在停止時顯式呼叫 stream.pause() 作為兜底防禦

## [0.8.8] - 2026-03-18

### Added

- 麥克風選擇功能：設定中可指定錄音使用的輸入裝置（Rust `list_audio_input_devices` + `start_recording` 接受 `device_name`）
- Enhancement anomaly 偵測：LLM 輸出異常時自動重試（最多 3 次），仍異常則 fallback 到原始文字

### Improved

- Layer 2b peak energy escape hatch：peak >= 0.03 時跳過 RMS+NSP 檢查，減少小聲說話「未偵測到語音」誤報
- Enhancer temperature 從 0.3 降至 0.1，輸出更穩定
- Active prompt 規則：合併重複表達時保留語氣（問句仍是問句），新增禁止將問句改寫為肯定句

### Fixed

- `getMicrophoneErrorMessage` 支援 Rust AudioRecorderError 字串匹配（No input device / Failed to build audio stream / Failed to get input config）

## [0.8.7](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.7) - 2026-03-17

### Changed

- AI 整理預設模型切換為 Kimi K2（既有使用者首次更新自動遷移，可在設定中改回）
- 重寫積極模式 prompt（五語言）：修正 AI 整理會回答逐字稿中的問題而非整理文字

### Improved

- 簡化幻覺偵測系統：移除幻覺字典和自動學習機制，改為純物理信號二層偵測（語速異常 + 無人聲），不再誤判正常語句
- 移除 RMS 單獨判斷，所有 RMS 偵測需搭配 Whisper NSP 聯合確認，避免小聲說話被誤判

### Removed

- 移除幻覺字典功能（DB table、Store、管理頁面、Sidebar 導航、自動學習、HUD 通知）

## [0.8.6](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.6) - 2026-03-16

### Fixed

- 修正歷史紀錄播放錄音在正式版（production build）無聲的問題：macOS 上 convertFileSrc 產生的 asset:// URL 被 CSP 阻擋，改用 Rust IPC 讀取位元組 + Blob URL 播放，dev/production 行為一致
- 修正快速連點不同紀錄時播放與 UI 狀態不同步的 race condition
- 播放失敗時新增 Sentry 錯誤回報（原本靜默吞錯）
- 修正 read_recording_file command 的安全性：改為接受 id 參數，Rust 端組合路徑，避免任意檔案讀取風險

## [0.8.5](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.5) - 2026-03-16

### Fixed

- 徹底修正版本升級後資料庫初始化失敗（database is locked / no such table）：HUD 視窗不再呼叫 Database.load()，改用 connectToDatabase() 等待 Dashboard 建好連線池後複用，從架構層面消除連線池覆蓋的競態條件
- 自動恢復先前版本損壞導致遺失的 api_usage 表
- 升級提示彈窗新增資料庫修復說明

## [0.8.4](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.4) - 2026-03-16

### Fixed

- 修正版本升級後「no such table: api_usage」錯誤：HUD 視窗的 Database.load() 覆蓋 Dashboard 的連線池，導致 migration 中的 DROP TABLE 失去 transaction 保護
- 防止連線池覆蓋：第二個視窗改用 Database.get() 複用既有連線池
- 自動恢復遺失的 api_usage 表：migration 結束後驗證關鍵表是否存在，不存在則重建

## [0.8.3](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.3) - 2026-03-16

### Fixed

- 修正版本升級後首次啟動出現「database is locked (code: 5)」錯誤：HUD 與 Dashboard 雙視窗同時初始化資料庫導致競態條件，加入 Promise lock 序列化初始化 + PRAGMA busy_timeout 防護

## [0.8.2](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.2) - 2026-03-16

### Fixed

- 修正舊版升級（v0.6.0 以前、v0.7.x）資料庫初始化失敗：ALTER TABLE ADD COLUMN 在 transaction 內對後續語句不可見，導致 "no such column: weight" 或 "no such column: status" 錯誤
- 修正儀表板「平均每次字數」偏高：改用原始辨識字數計算，不再受 AI 整理後文字膨脹影響
- 修正儀表板「節省時間」高估：公式改為（打字時間 − 口述時間），而非僅計算打字時間

## [0.8.1](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.1) - 2026-03-16

### Fixed

- 修正資料庫升級（v2→v3、v3→v4）可能因重複欄位名而失敗，導致歷史記錄無法顯示的問題
- 修正語音辨識幻覺偵測誤判：Whisper noSpeechProbability 聚合策略從 MAX 改為 MIN，避免有說話卻被判定為「未偵測到語音」
- 修正升級後更新摘要未顯示：改為版本號比對機制，所有升級的使用者都能看到更新內容
- 修正自動更新通知彈在隱藏視窗：下載完成後自動顯示 Dashboard 視窗
- 修正自動更新只在啟動時檢查一次：恢復定時檢查機制（每 15 分鐘）

## [0.8.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.8.0) - 2026-03-16

### AI 整理模式切換

新增三種 AI 整理模式，可在設定頁快速切換：

- **精簡模式**：修錯字、去贅詞、補標點，保持原句結構
- **積極模式**（類似 Typeless）：理解語意後重新排版，以段落和列點呈現
- **自訂模式**：使用自訂 Prompt

舊版使用者升級後，自訂 Prompt 會自動保留；使用預設值的使用者將自動遷移至精簡模式。

### Added

- 錄音檔自動儲存，歷史記錄可播放與重新轉錄
- Whisper 幻覺偵測與自動學習，減少無聲時的錯誤文字
- 按 ESC 可隨時取消錄音、轉錄或 AI 整理
- 音效回饋：錄音開始、結束及錯誤時播放提示音（可在設定中開關）
- 歷史記錄展開後原始文字旁新增複製按鈕
- 升級提示 Dialog：舊版使用者首次開啟時顯示更新摘要

### Changed

- HUD 狀態顯示優化與輔助使用權限引導改善
- 幻覺偵測升級為 RMS 能量 + 4 層偵測機制，移除內建詞庫

## [0.7.3](https://github.com/chenjackle45/SayIt/releases/tag/v0.7.3) - 2026-03-13

### Fixed

- 修復英文語句含重複冠詞（the、and 等）被誤判為「未偵測到語音」的問題
- 移除 Whisper 幻聽攔截機制，非空轉錄結果一律貼上，讓使用者自行判斷模型輸出品質

## [0.7.2](https://github.com/chenjackle45/SayIt/releases/tag/v0.7.2) - 2026-03-11

### Added

- 字典分析模型獨立設定：文字整理與字典分析可分別選用最適合的 AI 模型
- 新增 Kimi K2 Instruct 模型選項（文字整理 + 字典分析皆可選）
- 模型下拉選單新增特色標籤（平衡 · 預設 / 穩定可靠 · 成本高 / 最快 · 最便宜 / 最聰明 · 較慢）

### Fixed

- 修復模型下拉選單選中後 Badge 文字與模型名稱黏在一起的問題

## [0.7.1](https://github.com/chenjackle45/SayIt/releases/tag/v0.7.1) - 2026-03-10

### Fixed

- 移除已下架的 Llama 4 Maverick 17B 模型選項（Groq 已停用），已選用的使用者自動遷移至 Qwen3 32B

## [0.7.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.7.0) - 2026-03-10

### 智慧字典學習

SayIt 現在會自動從你的修正中學習。每次語音輸入貼上後，如果你修改了文字，系統會偵測修正內容並透過 AI 分析，將專有名詞和術語自動加入字典。字典越豐富，語音辨識就越準確——你用得越多，它就越懂你。

- 貼上後自動偵測修正，AI 篩選出值得學習的詞彙
- 字典權重系統：常用詞優先送入辨識提示，越常被修正的詞權重越高
- 字典頁面改版：AI 推薦與手動新增分區顯示，附權重標示
- HUD 即時通知新學習的詞彙
- 設定中可開關（macOS 預設開啟）

## [0.6.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.6.0) - 2026-03-09

### Added

- 轉錄語言獨立設定：UI 語言與 Whisper 語言可分開選擇，支援「自動偵測」模式
- Sentry 錯誤監控全覆蓋：29 個 captureError 呼叫點 + 全域錯誤處理器（雙視窗）

### Changed

- macOS 貼上機制改為 CGEvent Cmd+V 模擬，修復 LINE 等無標準 Edit 選單的 App 貼上失敗問題

### Fixed

- 修復自動更新後 App 無法重新啟動的問題（_exit(0) 截殺 Tauri restart 邏輯）

## [0.5.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.5.0) - 2026-03-08

### Added

- 錄音開始／結束音效回饋，讓使用者明確感知錄音狀態

## [0.4.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.4.0) - 2026-03-08

### Added

- 多語言（i18n）支援：vue-i18n 基礎建設、所有 Vue 元件與 views 國際化、Stores/Lib/Rust 轉錄層整合

### Fixed

- 強化 Whisper 靜音幻覺偵測，減少無聲片段產生錯誤轉錄

## [0.3.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.3.0) - 2026-03-08

### Added

- 跨平台自動貼上功能（macOS AX API + Windows SendInput）
- 音訊錄製與轉錄遷移至 Rust 原生管線，提升效能與穩定性
- 優雅關機與持久化鍵盤監控機制

### Fixed

- 修正 Sentry sourcemap upload 指令與 release publish 設定

## [0.2.5](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.5) - 2026-03-06

### Added

- Sentry release 自動化整合

### Fixed

- 修復語音 fallback 機制與設定同步更新問題

## [0.2.4](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.4) - 2026-03-06

### Changed

- 優化預設 prompt 防護性，切換預設模型為 Qwen3 32B

## [0.2.3](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.3) - 2026-03-06

### Fixed

- Dashboard 額度文字修正與短文字門檻預設停用
- 停用 Dashboard 右鍵選單並移除重複的更新檢查

## [0.2.2](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.2) - 2026-03-06

### Fixed

- 重構自動更新流程，修復檢查更新無回應問題

## [0.2.1](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.1) - 2026-03-06

### Added

- 設定頁新增「關於 SayIt」區塊與社群連結

### Fixed

- 修正 stable-name asset 上傳路徑以支援 cross-compilation
- 新增 workflow_dispatch 觸發器並分離 tag 推送

## [0.2.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.2.0) - 2026-03-06

### Added

- 自動更新 UI 與定時檢查機制（啟動 5 秒後首次檢查，每 4 小時定期檢查）
- CI/CD stable-name asset 上傳至 GitHub Release

### Fixed

- 授予輔助使用權限後自動偵測並啟用快捷鍵

## [0.1.0](https://github.com/chenjackle45/SayIt/releases/tag/v0.1.0) - 2026-03-05

### Added

- 語音轉文字核心功能（Groq Whisper API）
- HUD + Dashboard 雙視窗架構
- 全域快捷鍵系統（OS 原生 API，支援自訂錄製）
- API Key 安全儲存（tauri-plugin-store）
- 轉錄歷史記錄與搜尋（SQLite）
- AI 文字強化（Groq LLM）
- API 用量追蹤與每日免費額度
- 多螢幕 HUD 追蹤定位
- 可調整文字強化門檻
- macOS Accessibility 權限導引
- CI/CD pipeline 與 Apple Code Signing
- 錄音自動靜音系統喇叭
