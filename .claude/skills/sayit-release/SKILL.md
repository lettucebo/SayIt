---
name: sayit-release
description: Use when a SayIt release is requested, a target version is named, CHANGELOG or upgrade notices need synchronization, or release workflows and assets must be published and verified.
---

# SayIt 發版流程

這個 skill 編排 SayIt 從「準備發新版」到「呼叫 release.sh」之間的所有準備工作。release.sh 自身負責 4 點版本號 bump、commit、tag、push；這個 skill 負責把 release.sh 需要的前置條件全部準備好，並產生使用者體感得到的 release notes（CHANGELOG）和升級彈窗（5 語系 upgradeNotice）。

## 為什麼分成 skill + release.sh 兩段

release.sh 的 guard 設計（working tree 乾淨、CHANGELOG 含目標版本區塊、tag 不存在、不在 detached HEAD）讓它一定能 idempotent 地完成或乾淨地失敗。skill 不繞過這些 guard、也不重做 release.sh 已經會做的事，只負責生產 release.sh 需要的「材料」。這個分工讓兩邊各自單純：skill 出錯不會誤觸 push；release.sh 改邏輯不會牽連到內容生成。

## 整體流程

```
 使用者：「準備發 v0.11.0」
     │
     ▼
 ① 對齊版本號參數（X.Y.Z 是什麼？建議下一版）
     │
     ▼
 ② 蒐集材料（git log 上一個 tag..HEAD、git status）
     │
     ▼
 ③ 產生 CHANGELOG（分類 → 寫入頂部）
     │
     ▼
 ④ 產生 upgradeNotice（從 CHANGELOG 選亮點 → 翻譯 4 語 → 同步 itemCount）
     │
     ▼
 ⑤ Sanity check（5 語系 key 對齊、itemCount 對得上、CHANGELOG 含目標版本區塊）
     │
     ▼
 ⑥ Pre-flight checks（任一失敗即停止，不推送）
      ▼
 ⑦ 執行平台對應腳本（Windows: release.ps1；macOS/Linux: release.sh）
     │
     ▼
 ⑧ 發版後驗證（gh --repo、監看 workflow、確認 Release 發佈與資產）
```

## 步驟 ① 對齊版本號

在做任何事情之前先確定目標版本號 X.Y.Z。

讀取當前版本：
```bash
jq -r .version C:/Source/Repos/SayIt/src-tauri/tauri.conf.json
```

如果使用者已經在指令裡明說（「發 v1.1.0」），驗證格式與遞增關係後直接使用。如果沒明說，依下表自行判定、在最終報告說明理由，不停下來等待確認。

| Bump | 判準 | 例子 |
|------|------|------|
| **major** `X.0.0` | 產品級重大變更（新增一整條核心工作流、主要介面重做、移除既有能力），或使用者可見的破壞性變更（既有設定不相容、無法安全回退） | 語音輸入流程整體替換、設定格式不相容 |
| **minor** `X.Y.0` | 使用者多了一個可以主動選用的能力 | 新 provider、新模型、新設定項、新頁面 |
| **patch** `X.Y.Z` | 修正或改善既有能力，沒有新增可選功能 | bug fix、UI 排版／標籤、文案、效能、內部重構 |

判定規則：

1. **minor vs patch 的分界**：使用者是否多了一個能主動選用的東西；能選新模型是 minor，既有選單換 Badge 是 patch。
2. 同一版混合多種變更時，取最高類別。
3. 使用者可見的破壞性變更一律至少 major，即使改動程式碼很少。
4. 版本必須嚴格大於目前版本；禁止降版或重用已存在的 tag。

這是桌面產品的產品導向版本策略，不等同函式庫 API semver。歷史版本曾多次把 Added 發成 patch，不能照舊例機械推斷；以本表為新準則。

## 步驟 ② 蒐集材料

兩件事並行做：

```bash
# 上一個 tag 到目前的 commit
git -C C:/Source/Repos/SayIt log "$(git -C C:/Source/Repos/SayIt describe --tags --abbrev=0)..HEAD" --no-merges --pretty='%h %s'

# 確認 working tree 狀態
git -C C:/Source/Repos/SayIt status --short
```

如果開始發版前 working tree 已有不屬於本次 release-prep 的變更，立即 fail closed 並停止，不詢問是否混入發版。skill 自己產生的 CHANGELOG / upgradeNotice / 文件／腳本變更則全部納入 release-prep commit，再進 pre-flight。

## 步驟 ③ 起草 CHANGELOG

CHANGELOG.md 在專案根目錄，格式固定。

### 標題格式

```markdown
## [X.Y.Z] - YYYY-MM-DD
```

日期用今天的日期（執行時取 `date +%Y-%m-%d`，不要寫死）。

### 子分類

只用三個分類：

| 分類 | 何時放這裡 |
|------|-----------|
| `### Added` | 新功能、新介面、新檔案、新支援 |
| `### Fixed` | bug fix、錯誤行為修正 |
| `### Improved` | 效能優化、重構、開發體驗（DX）改進、CI/CD 升級 |

不用 `### Changed` / `### Deprecated` / `### Removed` 這些 keep-a-changelog 的其他分類，SayIt 的 CHANGELOG 慣例只用上面三個。

### 從 commit 推斷分類

| commit prefix | 分類 |
|---------------|------|
| `feat:` `feat(*):` | Added |
| `fix:` `fix(*):` | Fixed |
| `refactor:` `perf:` `chore(ci):` `chore(deps):` | Improved |
| `docs:` `chore:` `test:` | 不寫進 CHANGELOG（內部變更，使用者無感） |

例外：如果 `chore` 的內容其實使用者有感（例如「同步多語系」「修預設值」），仍要寫進 CHANGELOG，分類取決於影響面。

### 條目寫法

每條 bullet 的結構：

```
- [簡述使用者感受到的事]：[為什麼出現問題或為什麼這樣設計]，[實際做的事和取捨]
```

> 🔒 **不放 issue / PR 連結（硬規則）**：CHANGELOG 面向本 fork 使用者，且會被 `release.yml` 抽進 GitHub Release body。條目**不得**出現 `chenjackle45/SayIt#N`、裸 `#N` 或上游 URL——前者會 backlink 上游、後者在 fork 端會誤連自家不相關的 issue/PR。要標來源改用**不可被解析為引用**的純文字，例如「對應上游 issue 68」（數字不帶 `#`）。詳見 `.github/copilot-instructions.md`「`main` 分支與上游關聯政策」。

**範例**：

```markdown
- Gemini 2.5 系列做 AI 整理時長轉錄文字被截斷的問題：根因是 Gemini 把 thinking tokens 計入 `maxOutputTokens` 配額，原本對所有 provider 統一給 2048 token 預算被 thinking 吃掉一部分後不夠用。改為 per-provider 預設：Gemini / OpenAI 16384、Anthropic / Groq 8192（後者模型上限 8192，給 16384 會被 API reject）
```

注意三件事：
1. **使用者語言而非開發者語言**：寫「長轉錄文字被截斷」不寫「response.choices[0].message.content 不完整」
2. **解釋 why**：不只說「修了 X」，要說「為什麼 X 會壞」、「為什麼選這個解法」
3. **保留技術細節**：API 名稱、token 數字、檔案行為、CSP 規則這些技術細節要留著（讀者裡有開發者）

### 寫入位置

寫在 CHANGELOG.md 的 `# Changelog` 標題之下，緊接著現有最新版本之前。

```markdown
# Changelog

SayIt 版本更新紀錄。

## [X.Y.Z] - YYYY-MM-DD     ← 寫在這裡

### Added
- ...

### Fixed
- ...

### Improved
- ...

## [上一個版本] - ...        ← 已存在
```

### 寫入後的檢查

使用者已明示發版時，直接寫入檔案，不再等待文案確認。完成後在最終報告列出 CHANGELOG 條目；若內容需要調整，仍可由下一個 patch release 修正。

## 步驟 ④ 起草 upgradeNotice

### 機制背景

升級彈窗由 Dashboard 啟動時 `consumeUpgradeNotice()` 觸發，比對 `lastSeenVersion`（存在 tauri-plugin-store）和 `__APP_VERSION__`（build-time 從 package.json 注入）。不相等就顯示。

> ⚠️ `mainApp.upgradeNotice.itemN` 除了升級彈窗，也被「功能介紹」頁（`/guide`，`FeatureGuideView.vue`）當作「本次更新內容（v{version}）」卡片顯示——且該卡片一律可見、並標上當下版本號。因此每次發版都必須同步替換這 5 語系內容，否則 `/guide` 會在新版本號下顯示上一版的舊亮點。

需要動 7 個檔案：
1. `src/MainApp.vue`：`upgradeNoticeItemCount` 常數（控制顯示幾個 item）
2. `src/i18n/locales/zh-TW.json`：`mainApp.upgradeNotice` 區塊
3. `src/i18n/locales/zh-CN.json`：同上
4. `src/i18n/locales/en.json`：同上
5. `src/i18n/locales/ja.json`：同上
6. `src/i18n/locales/ko.json`：同上

### 內容策略

每次發版只展示 1-3 個本版**最有感**的亮點。亮點要從 CHANGELOG 篩選，不是把 CHANGELOG 全貼進來。判準：

- **使用者每天都會用到、能被立刻感受到** → 優先放（例：新功能、UI 改善）
- **修一個過去常被回報的痛點** → 優先放（例：常見 bug fix）
- **內部優化、CI/CD、refactor** → 不放
- **超技術的根因說明** → 放但要轉成白話

每個 item 的寫法：

```
[亮點主題冒號]：[使用者場景 + 之前的問題 + 現在的體驗]
```

### 翻譯流程

從本版 CHANGELOG 自動挑選 1-3 個最有感的亮點，先產生 zh-TW，再自動翻 4 種。**不要停下來詢問亮點，也不要叫使用者寫 5 種**。

#### 翻譯時的 5 語系語感

| 語系 | 語感方向 | 注意 |
|------|---------|------|
| zh-TW | 口語、用日常詞，如「剪貼簿」「貼上」「設定」 | 標點全形 |
| zh-CN | 簡體 + 中國大陸用語：「设置」（不是「設定」）、「粘贴」（不是「貼上」）、「连接」（不是「連線」） | 全形標點 |
| en | plain English、技術細節保留，避免 marketing 腔 | 用 em-dash `—` 連接補述 |
| ja | 丁寧体（です・ます調）、技術文書風 | 全形標點，専門用語保留英文 |
| ko | `-합니다` 体、技術用語自然 | 半形標點 + 空格 |

#### 翻譯品質檢查清單

- [ ] 5 語系都涵蓋了同一組「主題 + why + how」三要素
- [ ] zh-CN 沒有殘留 zh-TW 的繁體字或台灣用語
- [ ] en 不是 zh-TW 直譯（直譯常見特徵：句末加 the issue / the problem，過度被動語態）
- [ ] ja 用丁寧体一致
- [ ] ko 收尾是 `-니다`/`-습니다` 結構

### 寫入步驟

```
① 從本版 CHANGELOG 依「內容策略」選 1-3 個亮點
② 整理 zh-TW 為「主題冒號 + 使用者場景 + why + how」格式
③ 翻譯 4 語系（zh-CN / en / ja / ko）
④ 直接 Edit 6 個檔案：
   - 5 個 .json 的 mainApp.upgradeNotice 區塊
   - MainApp.vue 的 upgradeNoticeItemCount
⑤ 在最終報告列出 5 語系內容與 itemCount
```

### 重要：itemN 處理策略

每次發版**只保留新版本的 item**，不要累積上一版的。理由：

1. 升級彈窗的目的是讓使用者快速知道「這次升級多了什麼」，過往版本的 item 已經沒價值
2. 累積會讓彈窗越來越長，最終沒人讀
3. 保留舊 i18n key（item3, item4...）會讓 grep / refactor 出現假陽性

所以 Edit 時：

- 新版有 N 個 item → 5 個 .json 都只留 `title` + `item1..itemN` + `dismiss`
- 舊版的 `item3..item10` 整批刪掉
- `MainApp.vue` 的 `upgradeNoticeItemCount` 改成 N

## 步驟 ⑤ Sanity check

實際呼叫 release.sh 之前確認三件事，不對就回頭修：

```bash
# 1. 5 個 .json 的 upgradeNotice 區塊都對齊到 N 個 item + title + dismiss
rg -n '"upgradeNotice"' C:/Source/Repos/SayIt/src/i18n/locales/ -A $((N+2))

# 2. MainApp.vue 的 itemCount 等於 N
rg -n 'upgradeNoticeItemCount = ' C:/Source/Repos/SayIt/src/MainApp.vue

# 3. CHANGELOG.md 含 [X.Y.Z] 區塊
rg -n "^## \[X.Y.Z\]" C:/Source/Repos/SayIt/CHANGELOG.md
```

任何一項對不上，回去把它修好再走步驟 ⑥。

## 步驟 ⑥ Pre-flight checks

使用者明示發版即為 commit、tag、push 與觸發 CI/CD 的授權，不再詢問第二次。改用以下客觀檢查；**任一項失敗即 STOP，且不得 push/tag**：

1. 目標版號符合 `X.Y.Z` 且嚴格大於目前版本。
2. `vX.Y.Z` tag 不存在。
3. 目前在 `main` branch，且非 detached HEAD。
4. 發版材料已 commit；working tree 乾淨（忽略明確列入 `.git/info/exclude` 的本機工具產物）。
5. CHANGELOG 含非空的 `## [X.Y.Z]` 區塊。
6. 5 語系 `upgradeNotice` 只有 `title` + `item1..itemN` + `dismiss`，且 key 集合一致。
7. `upgradeNoticeItemCount === N`。
8. `pnpm build` 與 `pnpm test` 通過。
9. Windows 先執行 `.\scripts\release.ps1 X.Y.Z -WhatIf`；macOS/Linux 檢查 `jq`、`python3` 可用。

## 步驟 ⑦ 執行平台對應發版腳本

### Windows（主要路徑）

```powershell
cd C:\Source\Repos\SayIt
.\scripts\release.ps1 X.Y.Z
```

`release.ps1` 涵蓋 `release.sh` 的基礎 guard，並額外強制版號遞增、main-only、`cargo metadata --locked` 與 CI-before-tag。它會先推 main，自動找出同一 commit 的 CI run 並等待成功，只有 CI 綠燈才建立並推 tag；CI 失敗時不建立 tag，可修復／重跑 CI 後用 `.\scripts\release.ps1 X.Y.Z -ResumeTag` 安全續跑。發版前可用 `-WhatIf` 驗證所有 guard 與取代目標，不寫檔、不 commit、不 push。

### macOS / Linux

```bash
cd C:/Source/Repos/SayIt && ./scripts/release.sh X.Y.Z
```

### release.sh 可能擋下來的情況

| 訊息 | 原因 | 處理方式 |
|------|------|---------|
| `CHANGELOG.md 缺少 vX.Y.Z 的紀錄` | 步驟 ③ 沒寫進去 | 回到步驟 ③ |
| `有未 commit 的變更` | release-prep 尚未 commit，或混有其他變更 | release-prep 自動 commit；若是既有／不相關變更則 fail closed |
| `tag vX.Y.Z 已存在` | 版本號用過了 | 提示使用者要不同版本號 |
| `目前不在 git branch 上` | detached HEAD | 提示 `git switch main` |

注意：**skill 完成步驟 ④ 的 Edit 後，這些變更需要先 commit 才能執行發版腳本**。直接完成 release-prep commit，不再詢問。

### Commit message 範例

```
docs: add CHANGELOG entry for vX.Y.Z

chore: update upgradeNotice for vX.Y.Z highlights
```

或一個合併 commit：

```
docs(release): prepare vX.Y.Z release notes

- CHANGELOG.md: add vX.Y.Z section
- i18n: update upgradeNotice for 5 locales
- MainApp.vue: bump upgradeNoticeItemCount to N
```

## 步驟 ⑧ 發版後驗證（push 之後別急著收工）

push tag 後 release workflow 才剛開始，要確認「真的觸發、建置成功、Release 有發佈」再回報完成。0.12.1 實際踩過的坑：

- **`gh run` 指令一律帶 `--repo lettucebo/SayIt`**：本 repo 有 `upstream` remote，`gh run view/watch/list` 不帶 `--repo` 會解析到上游 `chenjackle45/SayIt` → HTTP 404。`gh api repos/lettucebo/SayIt/...` 這種明確路徑不受影響。
- **`gh run list` 不帶 `--repo` 會列到「上游」的 run**：曾出現 `gh run list --workflow=Release` 顯示上游最新版本（如 v0.11.0）、看似漏了剛觸發的 run，其實是查到 `chenjackle45/SayIt` 而非本 fork（不是快取）。一律帶 `--repo lettucebo/SayIt`，或用 `gh api "repos/lettucebo/SayIt/actions/runs?event=push&per_page=10"` 明確查本 repo。
- **GitHub Actions 時間戳是 UTC**：本地 +8 時 UTC `T17:17Z` = 本地隔天 `01:17`。用日期過濾 run 時別拿本地「今天」去比 `created_at`，否則會誤判「今天沒有 run」。
- **監看到完成再驗證**：`gh run watch <id> --repo lettucebo/SayIt --exit-status`（exit 0 = success）。發版會有**兩支獨立** workflow：`git push origin main` → CI、`git push origin vX.Y.Z` → Release（**tag push 不會觸發 CI**；兩支互不相依，Release 不等 CI）；兩支都要確認。
- **驗證 Release 產物**：`gh api repos/lettucebo/SayIt/releases/tags/vX.Y.Z` 確認 `draft:false`，且資產齊全——`latest.json`、固定名稱 `SayIt-mac-arm64.dmg` / `SayIt-mac-x64.dmg` / `SayIt-windows-x64.exe`（各附 `.sha256`）、各平台 updater `.sig`。

## 共通注意事項

### 不要手動修改 Cargo.lock

`Cargo.lock` 由平台對應發版腳本自動處理：Windows 的 `release.ps1` 使用 CRLF-safe 精準取代，macOS/Linux 的 `release.sh` 使用 Python 精準取代。Agent 不得在腳本外手動修改；Windows 路徑另以 `cargo metadata --locked` 驗證 lockfile 一致。

### 分支歸屬

發版只允許從 `main` 執行。若目前是 feature branch、detached HEAD，或 `origin/main` 尚未包含要發的變更，立即 fail closed；不得詢問是否直接從 feature branch 發版。

### 日期一致性

CHANGELOG 標題的日期應該等於今天日期，不是亮點被開發的日期。執行時取 `date +%Y-%m-%d`，不要寫死字串。

### 跨檔案修改後的交叉驗證

修改完 7 個檔案（CHANGELOG + 5 個 .json + MainApp.vue），用步驟 ⑤ 的 sanity check 命令交叉驗證一次。同時修改多個相關文件時必須交叉驗證，這一步是硬性的。
