---
name: verify
description: 完整驗證 — ESLint + 型別檢查 + Vitest + Rust fmt/clippy/test。在提交前或完成功能開發後使用。
---

# 完整驗證流程

以下是 SayIt 的權威驗證命令，與 `.github/copilot-instructions.md` 的 Pre-commit Checklist 和 CI（`.github/workflows/ci.yml`）一致。依序執行，任何一步失敗就停下來修正。

一律用 **pnpm**（`pnpm exec`），不要用 `npm` / `npx`；Rust 命令一律帶 `--manifest-path src-tauri/Cargo.toml`，不需要 `cd`。

## 1. ESLint 檢查

```bash
pnpm exec eslint src
```

> CI 用的就是這個範圍（`src`）。要自動修正時才加 `--fix`。

## 2. TypeScript 型別檢查

```bash
pnpm exec vue-tsc --noEmit
```

## 3. Vitest 單元 + 元件測試

```bash
pnpm test
```

> 並行執行在部分機器會 flaky（環境時間暴增、5s timeout）。不穩時改跑 `pnpm exec vitest run --no-file-parallelism`，並避免與 `cargo` 同時執行（CPU 競爭）。

## 4. Rust 格式檢查

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

## 5. Rust clippy 靜態分析

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
```

## 6. Rust 測試

```bash
cargo test --manifest-path src-tauri/Cargo.toml --workspace
```

## 行為規則

- 六步全過才算驗證通過；`cargo clippy` 已涵蓋編譯檢查，不需要另外跑 `cargo check`
- 任何一步失敗時，報告完整錯誤訊息與 exit code，並嘗試修正
- 修正後重新跑失敗的步驟（不需要從頭跑）
- Vitest 與 cargo 步驟盡量不要同時跑，避免資源競爭造成假性失敗
- 全部通過後回報簡潔摘要（每步命令 + exit code）

## 可選的補充檢查

這些不在必跑清單內，依變更內容決定：

| 變更內容 | 補充命令 |
| --- | --- |
| UI / E2E 行為 | `pnpm exec playwright test <file>`（CI 目前不跑 Playwright） |
| 前端建置產物 | `pnpm build` |
| IPC（Command / Event） | 用 `ipc-review` skill 或 `tauri-reviewer` agent 做雙端對齊審查 |
