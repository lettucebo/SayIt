---
applyTo: "src/**/*.{ts,vue}"
---

# 前端規則（Vue 3 + TypeScript）

適用 `src/**/*.{ts,vue}`。全域規則見 `.github/copilot-instructions.md`。

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

> **依賴方向（硬規則）**：`views/ → components/ + stores/ + composables/`；`stores/ → lib/`；`lib/ → 外部 API`。**❌ views/ 不可直接 import `lib/`**（一律經 Pinia store：`useSettingsStore` / `useHistoryStore` / `useVocabularyStore` / `useVoiceFlowStore`）；**❌ 元件不可直接執行 SQL**（經 `src/lib/database.ts` + store）。

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

## SQLite 映射（schema/migration 在 `src/lib/database.ts`）

- 表名：複數 snake_case（`transcriptions`）。
- 欄位 snake_case（`raw_text`）→ TS camelCase（`rawText`）由 **store 層**的 `mapRowToRecord()` 轉換（在 `useHistoryStore.ts`，非 `database.ts`）；`database.ts` 只負責 schema、migration 與 `getDatabase()`。
- 布林：`INTEGER` → `row.was_enhanced === 1`；null 布林 → `row.was_modified === null ? null : row.was_modified === 1`。
- 主鍵：`TEXT`（UUID，前端 `crypto.randomUUID()`）；參數語法 `$1, $2`（tauri-plugin-sql）。
- Migration：採遞增 `schema_version` 區塊 + `addColumnIfNotExists()`（冪等）。**❌ 絕不修改已部署的舊 migration，只追加 v(N+1)。**
- ⚠️ tauri-plugin-sql 無 connection affinity，跨 `execute()` 呼叫的 BEGIN/COMMIT 不安全（COMMIT 可能命中無交易的連線）。
- 執行期 DB：`%APPDATA%\com.sayit.app\app.db`（WAL 模式）；真 e2e / 資料驗證須停掉 App 後直接查詢。

## i18n

新增字串時，`src/i18n/locales/` 五個語系（`zh-TW`, `zh-CN`, `en`, `ja`, `ko`）都要加。
