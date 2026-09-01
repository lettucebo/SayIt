# `_bmad-output/` — 規劃與實作產出物

> **BMAD runtime 已於 2026-08 從本 repo 移除。** `_bmad/`（runtime config）、`.agents/`（codex target skills）與 `.claude/`（claude-code target skills / commands）都已刪除，
> 本資料夾**原路徑、原名保留**，是這些工作流留下的產出物。

## 為什麼 runtime 移除了，這個資料夾還在

這裡的內容分成兩類，用途完全不同：

- **仍具權威性的規範文件** — 被 `.github/copilot-instructions.md` 明列為「變更前請先讀」，與程式碼一起維護。
- **歷史紀錄** — 當時的決策脈絡與完成紀錄。刻意**不修改**，避免竄改當時的判斷依據；讀的時候要當成「某個時間點的快照」。

## 分類

| 路徑 | 定位 | 說明 |
| --- | --- | --- |
| `project-context.md` | 🟢 **權威** | AI Agent 實作規則（323 條）。與 `.github/copilot-instructions.md` 並列為必讀。 |
| `planning-artifacts/architecture.md` | 🟢 **權威** | 架構決策（ADR）。 |
| `planning-artifacts/ux-ui-design-spec.md` | 🟢 **權威** | UI 色彩 / 元件規範，改 UI 前必讀（搭配 `design.pen`）。 |
| `planning-artifacts/prd.md`、`epics.md` | 🟡 **參考** | 產品需求與 Epic 拆分，反映撰寫當時的範圍。 |
| `planning-artifacts/product-brief-*.md`、`sprint-change-proposal-*.md`、`implementation-readiness-report-*.md` | ⚪ **歷史** | 帶日期的一次性文件，不再更新。 |
| `implementation-artifacts/*.md` | ⚪ **歷史** | 各 story 完成紀錄與 tech spec，反映當時的實作決策。 |
| `test-artifacts/*.md` | ⚪ **歷史** | 測試框架建置紀錄。 |

程式碼與這裡的文件衝突時，**以程式碼為準**；發現落差請更新 `.github/copilot-instructions.md` 與 `docs/` 的現役文件，而不是回頭改歷史產出物。

## 已知的過時內容（刻意不修）

- 部分文件（例如 `test-artifacts/automation-summary.md`）仍引用 `_bmad/` 底下的路徑或 BMAD 指令。**那些路徑已不存在**，僅作為當時流程的紀錄。
- 文中提到的 BMAD workflow（`bmad-document-project` 等）已無法在本 repo 執行。

## 現在該用什麼

| 需求 | 位置 |
| --- | --- |
| AI Agent 權威指南 / IPC 契約表 | `.github/copilot-instructions.md` |
| 路徑範圍規則（frontend / rust / tests） | `.github/instructions/*.instructions.md` |
| 現役開發文件 | `docs/`（入口：`docs/index.md`） |
| 專案自有 skills | `.github/skills/`（`ipc-review` / `verify` / `sayit-release`） |
| Copilot custom agent | `.github/agents/tauri-reviewer.agent.md` |
| Hook 設定 / handler | `.github/hooks/protect-config.json`、`scripts/hooks/` |

> 若日後要復用 BMAD：重跑 BMAD installer 即可，其預設 `output_folder` 就是 `{project-root}/_bmad-output`，可直接接續這裡的既有產出。
