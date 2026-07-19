---
applyTo: "tests/**"
---

# 測試規則

適用 `tests/**`（細節見 `tests/README.md`）。全域規則見 `.github/copilot-instructions.md`。

- **分層**：`tests/unit/`（純邏輯 / service / types）、`tests/component/`（Vue 元件，jsdom）、`tests/e2e/`（Playwright）；共用程式在 `tests/support/{fixtures,helpers,factories}`。Vitest 只收 `tests/unit/**` + `tests/component/**`（見 `vitest.config.ts`）。
- **用 factory 產資料，禁止 hardcoded**：`createTranscriptionRecord()` / `createVocabularyEntry()`（`@faker-js/faker`，`tests/support/factories`），可帶覆寫物件，避免 parallel 衝突。
- **E2E 用 `data-testid` selector**，勿用 CSS class（Tailwind 一改就壞）；`test`/`expect` 從 `tests/support/fixtures` import。E2E 首次需 `npx playwright install chromium`。E2E 跑在 mock 過 Tauri 的 Vite dev server（localhost:1420），**碰不到真 tauri-plugin-sql**；要驗真 DB / 匯入須用 `pnpm tauri dev`。
- **測試名稱**加 priority tag `[P0]`–`[P3]`，檔名 `feature-name.test.ts`。
- **禁止**：`page.waitForTimeout()`（用 event-based wait）、`if (await el.isVisible())`（測試須 deterministic）、跨測試共用狀態。
- **跑單一測試**：`pnpm test <檔名片段>` 或 `pnpm exec vitest run -t "測試名片段"`；全套 Vitest 在部分機器並行會 flaky（5s timeout），不穩時加 `--no-file-parallelism`，且勿與 `cargo check`/`cargo test` 同時跑。
