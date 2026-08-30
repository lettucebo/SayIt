---
title: '修正設定頁模型選項於窄視窗溢位'
type: 'bugfix'
created: '2026-08-30'
status: 'done'
baseline_commit: '39e56161fc18a02689376b7a0030e9a186d6bc00'
context:
  - '{project-root}/.github/instructions/frontend.instructions.md'
  - '{project-root}/.github/instructions/tests.instructions.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 設定頁的 Microsoft Foundry「品質最佳」Badge 在 769px 左右的窄視窗、桌面 Sidebar 展開時，會超出 provider grid cell 並覆蓋相鄰內容。另有兩組模型／模式選擇器同樣將欄數寫死，存在相同的窄視窗風險。

**Approach:** 將長文字 Badge 改為填色 Lucide `Star` 搭配 Tooltip 與無障礙文字；三組選擇器使用已確認的 viewport 斷點逐步從單欄增至二／三欄，並加入 Playwright 幾何回歸測試。

## Boundaries & Constraints

**Always:** 保留五語系 `settings.model.bestQuality` 文案與 key；Star 使用語意色彩；Tooltip trigger 必須 `as-child` 包非互動 `<span>`；`sr-only` 必須位於 Foundry `<Label>` 內，維持 radio accessible name；720px 單欄是已接受的取捨；使用既有 shadcn-vue Tooltip 與 lucide-vue-next。

**Ask First:** 若無法用既有 mock／store 機制低成本讓 E2E 顯示 Foundry 選項，或必須改 production 設定／資料層才能 seed Azure 啟用狀態，先停止並回報。

**Never:** 不更新 `design.pen`（使用者已核准此局部缺陷修正的例外）；不改 Badge 共用元件；不修改 i18n 文案；不使用原生色彩、文字 `★`、額外可聚焦 Star 或 `auto-fit`；不處理無關的 `@container/main` 問題。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Foundry 可用 | Azure enabled | 顯示 Foundry、Groq、Gemini；Foundry 含填色 Star，hover 顯示「品質最佳」 | N/A |
| Foundry 不可用 | Azure disabled | 不顯示 Foundry；Groq、Gemini 仍可選 | N/A |
| Sidebar 斷崖 | 769px、桌面 Sidebar 展開 | 選項改為二欄，所有 Label 無水平 overflow | E2E 幾何斷言失敗 |
| 最小視窗 | 720px | 三組選擇器為單欄，無裁切或重疊 | N/A |

</frozen-after-approval>

## Code Map

- `src/views/SettingsView.vue` -- Star／Tooltip 呈現與三組 RadioGroup 響應式欄數。
- `src/components/ui/sidebar/SidebarProvider.vue` -- 既有 TooltipProvider 與 768px mobile breakpoint 的依據。
- `src/components/ui/badge/index.ts` -- 舊 Badge 不可縮行為的根因依據，不修改。
- `tests/e2e/settings-layout.test.ts` -- 新增 769px 幾何與互動回歸測試。
- `tests/support/fixtures/index.ts` -- E2E 既有 fixture／Tauri mock 入口，優先重用。

## Tasks & Acceptance

**Execution:**
- [x] `src/views/SettingsView.vue` -- 匯入 `Star` 與 Tooltip 元件；以填色 Star + Tooltip + Label 內 `sr-only` 取代 `bestQuality` Badge。
- [x] `src/views/SettingsView.vue` -- 轉錄 provider 與 Prompt 模式改為 `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`；LLM provider 改為 `grid-cols-1 md:grid-cols-2`；Label 補防禦性 `min-w-0`。
- [x] `tests/e2e/settings-layout.test.ts` -- 使用 `data-testid` 與既有 fixture，於 769px 驗證選項無 overflow，並驗證 Star 點擊／Tooltip／accessible name。

**Acceptance Criteria:**
- Given Azure enabled，when Settings 顯示轉錄 provider，then 可見填色 Star、hover 顯示目前語系的 `bestQuality`，且 Foundry radio accessible name 包含 provider 與該文案。
- Given 使用者點擊 Star 區域，when provider 更新，then 只選取 Foundry 一次且沒有點擊死區。
- Given 視窗寬度為 720、768、769 或 960px，when 顯示三組選擇器，then 所有 Label `scrollWidth <= clientWidth` 且不跨 grid cell。
- Given Azure disabled，when 顯示轉錄 provider，then Foundry 隱藏且 Groq／Gemini 可正常切換。
- Given 完成變更，when 執行既有 build、lint、Vitest 與 E2E，then 全部成功。

## Spec Change Log

## Design Notes

769px 起 Sidebar 由 offcanvas 轉為固定 16rem，內容寬度驟降；因此 `sm:` 無法處理此斷崖。採用使用者確認的 `md:`／`lg:` viewport 斷點，而非 `auto-fit`。Tooltip trigger 不使用預設 button，避免巢狀於 `<Label>` 時阻斷 radio activation。

## Verification

**Commands:**
- `pnpm build` -- expected: vue-tsc 與 Vite build 成功。
- `pnpm exec eslint src` -- expected: 無 lint error。
- `pnpm test` -- expected: Vitest 全數通過。
- `pnpm exec playwright test tests/e2e/settings-layout.test.ts` -- expected: 769px 幾何／互動測試通過。

**Manual checks:**
- 以 720／768／769／960px、zh-TW／en 檢查三組選擇器無裁切或重疊。

**Results:**
- `git diff --check`：exit 0。
- `pnpm build`：exit 0（Vite 僅有既有 chunk size warning）。
- `pnpm exec eslint src tests/e2e/settings-layout.test.ts tests/support/helpers/tauriMock.ts`：exit 0。
- `pnpm test`：56 files passed；898 tests passed；1 skipped。
- `pnpm exec playwright test tests/e2e/settings-layout.test.ts`：17 passed。
- `pnpm test:e2e`：17 passed、1 failed；唯一失敗為 baseline 已存在的 `smoke.test.ts` 舊標題 `/whisper/i` 與 `SayIt` 不符，已登錄 `deferred-work.md`。

## Suggested Review Order

**UI 與響應式行為**

- 從轉錄 provider 入口理解 Star、Tooltip 與動態三欄策略。
  [`SettingsView.vue:2826`](../../src/views/SettingsView.vue#L2826)

- 確認其餘兩組 selector 使用一致的 1→2→3 欄退化。
  [`SettingsView.vue:3142`](../../src/views/SettingsView.vue#L3142)
  [`SettingsView.vue:3508`](../../src/views/SettingsView.vue#L3508)

**回歸測試**

- 先看 viewport／locale 矩陣與精確欄數期望。
  [`settings-layout.test.ts:19`](../../tests/e2e/settings-layout.test.ts#L19)

- 檢查完整幾何守門，涵蓋 grid、SVG、左右溢位與 sibling overlap。
  [`settings-layout.test.ts:66`](../../tests/e2e/settings-layout.test.ts#L66)

- 驗證 Star Tooltip、accessible name 與單次持久化。
  [`settings-layout.test.ts:212`](../../tests/e2e/settings-layout.test.ts#L212)

- E2E Tauri mock 提供隔離的 store、SQL 與 event 生命週期。
  [`tauriMock.ts:22`](../../tests/support/helpers/tauriMock.ts#L22)

**已知基線限制**

- 完整 E2E 的既有舊標題 assertion 已獨立登錄。
  [`deferred-work.md:57`](deferred-work.md#L57)
