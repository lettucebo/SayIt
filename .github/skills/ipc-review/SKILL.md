---
name: ipc-review
description: 審查 Rust↔Vue IPC 一致性 — 使用 tauri-reviewer agent 檢查 Command 註冊、Event 名稱、Payload 型別是否前後端對齊。在修改 IPC 相關程式碼後使用。
---

# IPC 一致性審查

使用 `/agent` 選用 `tauri-reviewer` custom agent，對 Rust 後端與 Vue 前端進行 IPC 契約審查。若目前環境無法選用 custom agent，則直接依下列範圍自行做唯讀審查。

## 審查範圍

1. **Tauri Commands** — Rust `#[tauri::command]` 是否都在 `invoke_handler` 中註冊，前端呼叫的 command 名稱是否匹配
2. **Event 名稱** — Rust `emit()` 的 event 名稱是否與前端 `listen()` 的常量一致
3. **Payload 型別** — Rust `#[derive(Serialize)]` struct 的欄位是否與 TypeScript interface 對齊
4. **`.github/copilot-instructions.md` IPC 契約表** — 檢查契約表是否反映最新的程式碼狀態

## 執行方式

以 `/agent tauri-reviewer` 選用 custom agent，並指定要審查的具體變更範圍（如果有的話）；或由目前 agent 直接依相同範圍搜尋與比對。審查過程只能讀取與搜尋，不得修改檔案。

## 輸出格式

- 列出所有發現的不一致
- 對每項不一致標註嚴重等級（🔴 斷裂、🟡 可能問題、🟢 建議）
- 提供修正建議
