# Story 4.3: Dashboard 統計與最近轉錄摘要

Status: done

> ⚠️ **2026-07-29：本 Story 的「最近轉錄摘要」部分已被產品決策移除**——歷史記錄頁（HistoryView）已有完整列表，Dashboard 重複顯示價值不高。`recentTranscriptionList` / `fetchRecentTranscriptionList` / `SELECT_RECENT_SQL` 與對應 UI、i18n key 皆已刪除。
>
> 統計卡片與 `transcription:completed` 即時更新的部分仍然有效。以下內容保留作為當時的實作紀錄，**請勿依此重新實作最近轉錄列表**。

## Story

As a 使用者,
I want 在 Dashboard 看到使用統計和最近的轉錄摘要,
so that 我能量化語音輸入帶來的效率增益並快速回顧最近的使用。

## Acceptance Criteria

1. **AC1: 6 張統計卡片**
   - Given Main Window 的 Dashboard 頁面（DashboardView.vue）
   - When 使用者開啟 Dashboard
   - Then 顯示 6 張統計卡片，資料從 useHistoryStore.calculateDashboardStats() 計算
   - And 所有統計查詢回應 < 200ms

2. **AC2: 統計計算邏輯**
   - Given Dashboard 統計卡片
   - When 計算統計數據
   - Then 「總口述時間」= sum(recordingDurationMs) 轉為小時/分鐘顯示
   - And 「口述字數」= sum(charCount)
   - And 「平均口述速度」= total_chars / total_recording_duration（字/分鐘）
   - And 「節省時間」= total_chars / 40（假設平均打字速度 40 字/分鐘）轉為小時/分鐘
   - And 「總使用次數」= count(records)
   - And 「AI 整理使用率」= count(wasEnhanced=true) / count(total) 顯示為百分比

3. **AC3: 最近 10 筆轉錄摘要**
   - Given Dashboard 頁面統計卡片下方
   - When Dashboard 載入
   - Then 顯示最近 10 筆轉錄摘要列表
   - And 每筆顯示：時間戳、文字前 50 字截斷、是否經 AI 整理
   - And 點擊可跳轉至歷史頁面對應記錄

4. **AC4: 空狀態**
   - Given 無任何歷史記錄
   - When Dashboard 頁面載入
   - Then 統計卡片顯示初始值（0 小時、0 字、0 次等）
   - And 最近轉錄列表顯示空狀態提示

5. **AC5: 即時更新**
   - Given 新的轉錄記錄完成
   - When Main Window 收到 `transcription:completed` Tauri Event
   - Then Dashboard 統計數據自動重新計算並更新
   - And 最近轉錄列表自動新增該筆記錄至頂部
   - And 無需手動重新整理頁面

## Tasks / Subtasks

- [x] Task 1: 擴展 useHistoryStore.calculateDashboardStats() 和新增 fetchRecentTranscriptionList() (AC: #1, #2, #3)
  - [x] 1.1 重構 calculateDashboardStats() 使用 SQL 聚合查詢（而非 in-memory 計算）
  - [x] 1.2 擴展 DashboardStats 介面新增 totalRecordingDurationMs、totalCharacters（含 sum(recordingDurationMs)）
  - [x] 1.3 新增 fetchRecentTranscriptionList(limit = 10) 方法：SELECT ... ORDER BY timestamp DESC LIMIT 10
  - [x] 1.4 新增 dashboardStats ref 和 recentTranscriptionList ref
  - [x] 1.5 新增 refreshDashboard() 整合統計 + 最近列表載入

- [x] Task 2: 實作 DashboardView.vue 統計卡片 (AC: #1, #2, #4)
  - [x] 2.1 6 張統計卡片 grid 佈局（2x3 或 3x2 responsive）
  - [x] 2.2 每張卡片：圖標/emoji + 標題 + 主要數值 + 單位
  - [x] 2.3 數值格式化：時長轉 h/min、字數加千分位、百分比
  - [x] 2.4 空狀態：數值顯示 0（不隱藏卡片）

- [x] Task 3: 實作最近轉錄摘要列表 (AC: #3, #4)
  - [x] 3.1 統計卡片下方顯示最近 10 筆
  - [x] 3.2 每筆：時間戳 + 文字前 50 字截斷 + AI 整理標記
  - [x] 3.3 點擊跳轉至 /history（使用 router.push）
  - [x] 3.4 空狀態提示（如「開始使用語音輸入，統計數據將在此顯示」）

- [x] Task 4: 實作即時更新與手動測試 (AC: #5, #1-#4)
  - [x] 4.1 onMounted 監聽 TRANSCRIPTION_COMPLETED 事件
  - [x] 4.2 收到事件後呼叫 refreshDashboard() 重新計算
  - [x] 4.3 onBeforeUnmount 清理事件監聽
  - [x] 4.4 手動測試：驗證卡片數值、最近列表、空狀態、即時更新

## Dev Notes

### 現有骨架分析

| 檔案 | 現狀 | Story 4.3 任務 |
|------|------|----------------|
| `src/views/DashboardView.vue` | 空 placeholder（僅 title + subtitle） | 實作完整 Dashboard 頁面 |
| `src/stores/useHistoryStore.ts` | calculateDashboardStats() 有基本 in-memory 實作 | 重構為 SQL 聚合查詢 + 新增 fetchRecentTranscriptionList |
| `src/types/transcription.ts` | DashboardStats 有 4 個欄位 | 需擴展為 6 個統計值的完整介面 |
| `src/types/events.ts` | TranscriptionCompletedPayload 已定義 | 不需修改 |
| `src/composables/useTauriEvents.ts` | TRANSCRIPTION_COMPLETED 已定義 | 不需修改 |
| `src/router.ts` | /dashboard 路由已註冊 | 不需修改 |

### 依賴前提

- **Story 4.1**：addTranscription + fetchTranscriptionList + mapRowToRecord
- **Story 4.2**：不直接依賴，但共用 useHistoryStore

### DashboardStats 介面擴展

現有 DashboardStats 只有 4 個欄位，epics 要求 6 張統計卡片。需擴展：

```typescript
// 建議修改 src/types/transcription.ts
export interface DashboardStats {
  totalTranscriptions: number;          // 總使用次數
  totalCharacters: number;              // 口述字數
  totalRecordingDurationMs: number;     // 總口述時間（毫秒）
  averageSpeedCharsPerMin: number;      // 平均口述速度（字/分鐘）
  estimatedTimeSavedMs: number;         // 節省時間（毫秒）
  enhancedCount: number;                // AI 整理次數（用於計算使用率百分比）
}
```

**注意**：現有 `calculateDashboardStats()` 有 `averageDurationMs` 欄位（Story 4.1 骨架定義），epics 要求的是「平均口述速度（字/分鐘）」而非「平均轉錄耗時」。需確認是否修改介面欄位名或新增。建議直接修改為上述介面。

### SQL 聚合查詢替代 in-memory 計算

現有 `calculateDashboardStats()` 在 in-memory list 上 reduce，對大量記錄不效率。改用 SQL 聚合：

```typescript
interface DashboardStatsRow {
  total_count: number;
  total_characters: number;
  total_recording_duration_ms: number;
  enhanced_count: number;
}

async function refreshDashboardStats(): Promise<DashboardStats> {
  const db = getDatabase();
  const rows = await db.select<DashboardStatsRow[]>(
    `SELECT
       COUNT(*) as total_count,
       COALESCE(SUM(char_count), 0) as total_characters,
       COALESCE(SUM(recording_duration_ms), 0) as total_recording_duration_ms,
       COALESCE(SUM(CASE WHEN was_enhanced = 1 THEN 1 ELSE 0 END), 0) as enhanced_count
     FROM transcriptions`
  );

  const row = rows[0];
  const totalMinutes = row.total_recording_duration_ms / 60000;
  const ASSUMED_TYPING_SPEED_CHARS_PER_MIN = 40;

  return {
    totalTranscriptions: row.total_count,
    totalCharacters: row.total_characters,
    totalRecordingDurationMs: row.total_recording_duration_ms,
    averageSpeedCharsPerMin: totalMinutes > 0
      ? Math.round(row.total_characters / totalMinutes)
      : 0,
    estimatedTimeSavedMs: Math.round(
      (row.total_characters / ASSUMED_TYPING_SPEED_CHARS_PER_MIN) * 60000
    ),
    enhancedCount: row.enhanced_count,
  };
}
```

### 最近 10 筆查詢

```typescript
async function fetchRecentTranscriptionList(limit = 10): Promise<TranscriptionRecord[]> {
  const db = getDatabase();
  const rows = await db.select<RawTranscriptionRow[]>(
    `SELECT id, timestamp, raw_text, processed_text,
            recording_duration_ms, transcription_duration_ms, enhancement_duration_ms,
            char_count, trigger_mode, was_enhanced, was_modified, created_at
     FROM transcriptions
     ORDER BY timestamp DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(mapRowToRecord);
}
```

### 6 張統計卡片定義

| # | 標題 | 計算 | 格式 |
|---|------|------|------|
| 1 | 總口述時間 | sum(recordingDurationMs) | `X 小時 Y 分鐘` 或 `X 分鐘` |
| 2 | 口述字數 | sum(charCount) | `12,345 字` |
| 3 | 平均口述速度 | totalChars / totalRecordingMinutes | `XXX 字/分鐘` |
| 4 | 節省時間 | totalChars / 40 字/分鐘 | `X 小時 Y 分鐘` |
| 5 | 總使用次數 | count(records) | `XXX 次` |
| 6 | AI 整理使用率 | enhancedCount / totalCount * 100 | `XX%` |

### 數值格式化 Helpers

```typescript
function formatDurationFromMs(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} 分鐘`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小時 ${minutes} 分鐘` : `${hours} 小時`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("zh-TW");
}

function formatPercentage(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}
```

### 統計卡片 UI 佈局

```
┌─────────────────────────────────────────────────────┐
│ Dashboard                                            │
│ 語音轉文字統計總覽                                    │
│                                                      │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│ │ 總口述時間│ │ 口述字數  │ │ 平均速度  │              │
│ │ 2h 30min │ │ 12,345 字│ │ 82 字/分  │              │
│ └──────────┘ └──────────┘ └──────────┘              │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│ │ 節省時間  │ │ 使用次數  │ │ AI 使用率 │              │
│ │ 5h 8min  │ │ 156 次   │ │ 78%      │              │
│ └──────────┘ └──────────┘ └──────────┘              │
│                                                      │
│ 最近轉錄                                             │
│ ┌──────────────────────────────────────────────────┐ │
│ │ 2026-03-03 14:30  [AI]  這是一段轉錄文字前五...  │ │
│ │ 2026-03-03 14:25        另一段文字的預覽內容...  │ │
│ │ ...                                              │ │
│ └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 卡片 Tailwind 樣式建議

```html
<!-- 卡片 grid -->
<div class="grid grid-cols-2 gap-4 lg:grid-cols-3">
  <div class="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
    <p class="text-sm text-zinc-400">總口述時間</p>
    <p class="mt-1 text-2xl font-bold text-white">2 小時 30 分鐘</p>
  </div>
  <!-- ... -->
</div>
```

### 跳轉至歷史頁面

最近列表點擊跳轉使用 Vue Router：

```typescript
import { useRouter } from 'vue-router';
const router = useRouter();

function navigateToHistory() {
  router.push('/history');
}
```

**注意**：epics 提到「點擊可跳轉至歷史頁面對應記錄」，但 Story 4.2 的搜尋是關鍵字搜尋而非 ID 定位。建議先實作為跳轉至 /history 頁面即可（不帶 query param 定位特定記錄），如需精確定位可在後續迭代實作。

### 即時更新（TRANSCRIPTION_COMPLETED 事件）

與 Story 4.2 的 HistoryView 相同模式：

```typescript
import { listenToEvent, TRANSCRIPTION_COMPLETED } from '../composables/useTauriEvents';
import type { UnlistenFn } from '@tauri-apps/api/event';

let unlistenTranscriptionCompleted: UnlistenFn | null = null;

onMounted(async () => {
  await refreshDashboard();

  unlistenTranscriptionCompleted = await listenToEvent(
    TRANSCRIPTION_COMPLETED,
    () => {
      refreshDashboard(); // 重新計算統計 + 重新載入最近列表
    }
  );
});

onBeforeUnmount(() => {
  unlistenTranscriptionCompleted?.();
});
```

### refreshDashboard 整合方法

建議在 useHistoryStore 中新增：

```typescript
const dashboardStats = ref<DashboardStats>({
  totalTranscriptions: 0,
  totalCharacters: 0,
  totalRecordingDurationMs: 0,
  averageSpeedCharsPerMin: 0,
  estimatedTimeSavedMs: 0,
  enhancedCount: 0,
});
const recentTranscriptionList = ref<TranscriptionRecord[]>([]);

async function refreshDashboard() {
  const [stats, recent] = await Promise.all([
    refreshDashboardStats(),
    fetchRecentTranscriptionList(10),
  ]);
  dashboardStats.value = stats;
  recentTranscriptionList.value = recent;
}
```

### 不需修改的檔案

- `src/types/events.ts` — TranscriptionCompletedPayload 已定義
- `src/composables/useTauriEvents.ts` — TRANSCRIPTION_COMPLETED 已定義
- `src/lib/database.ts` — schema 和索引已建立
- `src/router.ts` — /dashboard 路由已註冊
- `src/MainApp.vue` — sidebar 導航已包含 Dashboard

### 需要修改的檔案清單

| 檔案 | 修改範圍 |
|------|---------|
| `src/types/transcription.ts` | 擴展 DashboardStats 介面（6 個統計欄位） |
| `src/stores/useHistoryStore.ts` | 重構 calculateDashboardStats 為 SQL 聚合 + 新增 fetchRecentTranscriptionList + refreshDashboard + 新 refs |
| `src/views/DashboardView.vue` | 從 placeholder 實作為完整 Dashboard（6 張卡片 + 最近列表 + 空狀態 + 即時更新） |

### 跨 Story 備註

- **Story 4.1** 是前提：addTranscription 寫入記錄、mapRowToRecord helper
- **Story 4.2** 是前提：fetchTranscriptionList 基本版已實作
- DashboardStats 介面修改會影響 calculateDashboardStats() 的 caller — 目前只有 DashboardView 使用，影響範圍小
- DashboardView 是 Main Window 的預設首頁（/ redirect 到 /dashboard）

### Project Structure Notes

- 不新增任何新檔案
- 所有修改在既有專案結構內
- DashboardView.vue 是 Main Window 預設首頁
- DashboardStats 介面修改影響 useHistoryStore return type

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3] — AC 完整定義（lines 697-734）
- [Source: _bmad-output/planning-artifacts/architecture.md#NFR] — SQLite 查詢 < 200ms
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] — Pinia stores、Tauri Events 跨視窗同步
- [Source: _bmad-output/implementation-artifacts/4-1-transcription-auto-save.md] — SQL 映射、mapRowToRecord、TranscriptionCompletedPayload
- [Source: _bmad-output/implementation-artifacts/4-2-history-browse-search-copy.md] — HistoryView UI 模式、listenToEvent 模式
- [Source: src/stores/useHistoryStore.ts] — 現有 calculateDashboardStats() in-memory 骨架
- [Source: src/views/DashboardView.vue] — 空 placeholder
- [Source: src/types/transcription.ts] — 現有 DashboardStats（4 欄位，需擴展為 6 欄位）
- [Source: src/views/DictionaryView.vue] — UI 設計參考
- [Source: src/views/SettingsView.vue] — UI 設計參考
- [Source: src/router.ts] — /dashboard 路由（預設首頁）

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

無錯誤。166 tests passed，vue-tsc 無新增錯誤。

### Completion Notes List

- Task 1: 重構 calculateDashboardStats 為 SQL 聚合查詢 fetchDashboardStats()，移除舊有 in-memory 計算；擴展 DashboardStats 介面為 6 欄位；新增 fetchRecentTranscriptionList(limit=10)、dashboardStats ref、recentTranscriptionList ref、refreshDashboard() 整合方法
- Task 2: DashboardView.vue 從 placeholder 完整實作 6 張統計卡片（2x3 responsive grid），含 formatDurationFromMs、formatNumber、formatPercentage 格式化 helpers，空狀態顯示 0
- Task 3: 最近 10 筆轉錄摘要列表，含時間戳、文字截斷 50 字、AI 整理標記、點擊跳轉至 /history、空狀態提示
- Task 4: onMounted 監聽 TRANSCRIPTION_COMPLETED 事件呼叫 refreshDashboard()，onBeforeUnmount 清理監聽
- 測試：更新 use-history-store.test.ts 移除舊 calculateDashboardStats 測試，新增 fetchDashboardStats(3)、fetchRecentTranscriptionList(3)、refreshDashboard(2) 共 8 個測試

### Change Log

- 2026-03-03: Story 4.3 完整實作 — Dashboard 統計卡片 + 最近轉錄摘要 + SQL 聚合 + 即時更新

### File List

- src/types/transcription.ts (modified) — DashboardStats 介面擴展 4→6 欄位
- src/stores/useHistoryStore.ts (modified) — SQL 聚合查詢、fetchDashboardStats、fetchRecentTranscriptionList、refreshDashboard、新 refs
- src/views/DashboardView.vue (rewritten) — 6 張統計卡片 + 最近列表 + 空狀態 + 即時更新
- tests/unit/use-history-store.test.ts (modified) — 替換舊測試 + 新增 8 個 dashboard 相關測試
