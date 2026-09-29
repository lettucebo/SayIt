---
name: sayit-release
description: Use when a SayIt release is requested, a target version is named, CHANGELOG or upgrade notices need synchronization, or release deployment must be monitored until publication.
---

# SayIt 發版

只負責產生本版說明、呼叫發版腳本、監控到 GitHub Release 公開。不要在 skill 裡重跑 build、test、`-WhatIf`、逐項資產檢查或腳本已有的 guard；程式碼品質交給 CI，發版腳本負責版本同步、commit、push 與 tag。所有發版變更只留在 fork `lettucebo/SayIt`，不得同步回上游。

## 1. 決定版本與蒐集內容

使用者指定 `X.Y.Z` 就沿用；未指定時讀 `src-tauri/tauri.conf.json` 目前版號，依下表選擇下一版並說明理由。Windows 腳本會檢查格式、遞增及 tag；macOS／Linux 腳本只檢查格式與本機 tag，執行前仍須確認版號遞增且遠端 tag 不存在。

| 類型 | 判準 |
|------|------|
| major | 核心工作流／介面大改，或使用者可見的不相容變更 |
| minor | 新增可主動選用的模型、provider、設定或其他能力 |
| patch | 修正／改善既有能力，沒有新增可選功能 |

混合變更取最高類別；使用者明確指定版號時不自行改版。取得 repo root 與上一個 tag，讀取 `git log <tag>..HEAD --no-merges` 與 `git status --short`；有非本次發版準備的既存變更就停止，不混進 release commit。路徑以 `git rev-parse --show-toplevel` 動態取得。

## 2. 寫 CHANGELOG 與升級提示

在 `CHANGELOG.md` 最新版本之前加入 `## [X.Y.Z] - YYYY-MM-DD`（執行當天日期）。只列實際帶給使用者的變化，描述問題、修法與重要取捨；保留必要技術細節，不照抄 commit 標題：

| 分類 | 對應變更 |
|------|----------|
| `### Added` | `feat`：新功能／支援 |
| `### Fixed` | `fix`：錯誤行為修正 |
| `### Improved` | `refactor`、`perf`、`chore(ci)`、`chore(deps)`：改善 |

`docs`、`test` 與純內部 `chore` 通常不列；實際影響使用者時仍應列。**CHANGELOG／release notes 不得含裸 `#N`、上游 issue/PR 引用或 URL**，以免誤連或 backlink。

從 CHANGELOG 選 **1–3 則最有感**的亮點（常用能力、使用者痛點優先；不列純內部／CI 事項）。同步更新 `src/i18n/locales/{zh-TW,zh-CN,en,ja,ko}.json` 的 `mainApp.upgradeNotice`：只留 `title`、本版 `item1..itemN`、`dismiss`，刪除舊版 item；`src/MainApp.vue` 的 `upgradeNoticeItemCount` 改成 N。這些 item 同時顯示於升級彈窗及功能介紹頁，不能沿用舊文案。

| 語系 | 寫法 |
|------|------|
| zh-TW | 台灣日常用語，貼上、設定，標點全形 |
| zh-CN | 簡體及大陸用語，粘贴、设置，標點全形 |
| en | plain English，避免行銷腔 |
| ja | 丁寧体（です・ます），技術詞保留原文 |
| ko | `-합니다` 體，技術詞自然 |

由低成本模型（至少 Gemini 3.8 Flash）**只快速檢查**五份 `upgradeNotice` 是否同主題、同 `item1..itemN` 鍵，且 N 與 `upgradeNoticeItemCount` 相符；有缺漏就修正，不重跑整套測試。發版時不重新審查已在 PR 審查過的程式碼。

## 3. Commit 並執行平台腳本

將本次 `CHANGELOG.md`、五語系及 `MainApp.vue` 的 release-prep 變更做成一個 commit，附上本次 Copilot commit trailers。確認沒有混入無關檔案；腳本會要求乾淨工作區。**不要手動修改 `Cargo.lock`**，版本同步留給腳本。

Windows（從 repo root 執行；將 `<session-id>` 換成本次 session ID）：

```powershell
$footer = "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`nCopilot-Session: <session-id>"
.\scripts\release.ps1 X.Y.Z -CommitMessageFooter $footer
```

`release.ps1` 先推 `main`、等對應 CI 成功，再推 tag；CI 失敗不會建立 tag。若 commit 已推上 `main` 但 tag 尚未建立，修復／重跑 CI 後用 `.\scripts\release.ps1 X.Y.Z -ResumeTag` 續跑，不重新 bump。

macOS／Linux：在 repo root 的 `main` 執行 `./scripts/release.sh X.Y.Z`。**此腳本目前不等 CI，且不檢查是否為 `main`，也不支援 bump commit trailers**；執行前須確認符合要求，不要誤認它有 Windows 腳本的保護。

## 4. 監控到發布完成

tag 推送後，從 fork 找 **該 tag 的** Release run（`gh run` 一律指定 `--repo lettucebo/SayIt`，避免查到上游），監控到完成：

```powershell
gh run list --repo lettucebo/SayIt --workflow release.yml --event push --limit 10 --json databaseId,headBranch,status,conclusion
gh run watch <vX.Y.Z 對應的 databaseId> --repo lettucebo/SayIt --exit-status
gh api repos/lettucebo/SayIt/releases/tags/vX.Y.Z --jq '{tag_name,draft,html_url}'
```

只有 run 成功、tag 正確且 `draft=false` 才回報已發布；`release.yml` 會在公開前檢查三平台 updater 與固定名稱下載檔，不需在 skill 重做逐項比對。若 run 失敗，先查看失敗 job 的 log 再處理；可重試的暫時性失敗用 `gh run rerun <id> --repo lettucebo/SayIt --failed`，若是 tag 內的程式碼問題則改發下一版，**不移動已公開的 tag**。未發布成功就明確回報狀態與失敗處，不宣稱完成。
