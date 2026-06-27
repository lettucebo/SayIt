---
name: git-worktree
description: |
  Create, switch, manage, and merge Git worktrees for parallel task development
  in the Monē monorepo using Copilot CLI.
  USE FOR: starting new tasks, creating worktrees, switching between worktrees,
  listing active tasks, merging completed work, cleaning up worktrees, creating
  pull requests, abandoning tasks.
  DO NOT USE FOR: general git operations within a worktree (commit, push, log),
  or non-worktree branching.
---

# Git Worktree Workflow

Parallel task development using Git worktrees. Each task gets an isolated worktree with its own `node_modules`, allowing multiple features to be developed simultaneously.

## Conventions

| Item | Convention |
|------|-----------|
| Worktree path | `../worktree/<name>/` (sibling to main repo) |
| Branch naming | `<type>/<name>` (type from commit.instructions.md: feat, fix, refactor, chore, etc.) |
| Main repo | Always stays on `main`. Never develop directly on it. |
| Dependencies | `pnpm install` independently in each worktree |
| Merge strategy | `merge --no-ff` (preserve merge commit) |
| Remote sync | Push branch → Create PR on GitHub → Merge via PR |
| Pre-merge gate | ⛔ 合併前**強制** Gate：先更新 PR（及關聯 Issue）body / comment 並輸出「Pre-Merge Gate 確認」區塊後，才可執行任何合併（見 Workflow 4.5） |
| Session continuity | After creating a worktree, `cd` into it and continue working in the **same session**. Do NOT ask the user to open a new terminal or start a new CLI session. |

## Workflow 1: Create New Task

**Triggers**: "start new task", "implement issue #X", "create worktree"

```bash
# 1. Ensure main is up to date
cd <main-repo-path>
git checkout main
git pull origin main

# 2. Create worktree with new branch
git worktree add ../worktree/<name> -b <type>/<name> main

# 3. Copy environment files (before install, so postinstall scripts can use them)
cp <main-repo-path>/.env ../worktree/<name>/.env 2>/dev/null || true
cp <main-repo-path>/src/mone-web/api/.dev.vars ../worktree/<name>/src/mone-web/api/.dev.vars 2>/dev/null || true
cp <main-repo-path>/src/admin-portal/api/.dev.vars ../worktree/<name>/src/admin-portal/api/.dev.vars 2>/dev/null || true
cp <main-repo-path>/src/scheduler/.dev.vars ../worktree/<name>/src/scheduler/.dev.vars 2>/dev/null || true

# 4. Switch to worktree and install dependencies
cd ../worktree/<name>
pnpm install
```

**Name derivation**:
- From issue: extract keywords from title (e.g., issue "Mobile SSE streaming" → `mobile-sse-streaming`)
- From description: pick 2-4 word slug (e.g., "fix header overflow" → `fix/header-overflow`)
- Keep names short, lowercase, hyphenated

**After creation — Same-Session Continue (MANDATORY)**:

Do NOT ask the user to open a new terminal or start a new CLI session. Instead:

1. **Stay in the worktree directory** — the `cd` in the script above already moved you there
2. **Briefly report** the worktree path and branch name
3. **Recap the task** — summarize what was discussed earlier in this session as an implementation plan
4. **Start implementing immediately** — proceed with the task without waiting for further instructions

> **VS Code Agent Mode note**: When operating inside VS Code Chat (not CLI), use absolute paths
> (e.g., `c:\Source\Repos\worktree\<name>\src\...`) for all file read/write operations, since the
> VS Code workspace context still points to the main repo. Terminal commands should `cd` to the
> worktree path first. If the user needs full workspace features (search, explorer), suggest:
> `code ../worktree/<name>` to open the worktree in a new VS Code window.

## Workflow 2: List All Worktrees

**Triggers**: "list tasks", "what worktrees exist", "show active tasks"

```bash
git worktree list
```

Format output clearly: mark which is the main repo and which are working worktrees.

## Workflow 3: Switch Worktree

**Triggers**: "switch to X", "go to X worktree", "cd to X"

```bash
cd ../worktree/<name>
```

Verify directory exists first. Inform the user of current worktree and branch.

## Workflow 4: Push & Create PR

**Triggers**: "done", "ready to merge", "create PR", "push and PR"

```bash
# 1. Ensure in target worktree
cd ../worktree/<name>

# 2. Verify all changes are committed
git status

# 3. Push branch
git push origin <branch-name>

# 4. Create PR using gh CLI
gh pr create \
  --base main \
  --title "<type>(<scope>): <description>" \
  --body "<change summary>"
```

- PR title follows conventional commit format (see commit.instructions.md)
- PR body should summarize changes, affected modules, and testing status
- **If this PR resolves an issue**, add a closing keyword in the body (`Closes #N` / `Fixes #N`) so the issue auto-closes on merge
- Inform the user of the PR URL

## Workflow 4.5: Pre-Merge Update Gate (MANDATORY)

**Triggers**: 在執行或啟用「任何形式的合併」之前 — `gh pr merge`（含 `--merge` / `--delete-branch`）、`gh pr merge --auto` 或啟用 auto-merge、merge queue、GitHub Web UI「Merge pull request」、release PR 合併，以及自然語觸發（「done / ready to merge / ship it / land it / LGTM, merge / approved, merge / merge when green / 合併吧」）。

> ⚠️ **強制 Gate**：合併 PR 前，**必須**先把開發成果回寫到對應 PR（有關聯 Issue 亦同步），並**輸出確認區塊**。未完成此步驟**不得合併**。

### 判斷：body vs comment

> **核心原則**：**body 描述「做了什麼（實作）」並隨實作更新（overwrite-update）；comment 追加「驗證了什麼（測試 / Code Review 結果）」且只增不蓋（append）。**

| 資訊性質 | 處理方式 | 範例 |
|---------|---------|------|
| **實作描述**（body, overwrite-update） | **編輯 body**（只在實作有變更時更新；否則保留原內容） | 變更摘要、影響模組、設計決策、`Closes #N` |
| **驗證 / 過程產物**（comment, append） | **用 comment 追加**（有產物即追加，只增不蓋） | **測試狀態與結果、Code Review 結果**、瀏覽器測試結果等 |

### 必做範圍

- **PR body 更新 = 一律必做。** 放實作描述（變更摘要、影響模組、設計決策、`Closes #N`）；**只在實作本身有新增 / 變更時才更新**，否則保留原內容。**禁止把測試狀態 / 結果、Code Review 結果寫進 body。**
- **Comment（append）= 驗證 / 過程產物一律用 comment 追加**：**測試狀態與結果、Code Review 結果**、瀏覽器測試結果等；有產物即追加，確實無任何可追加產物才寫 `N/A`，勿製造雜訊 comment。
- **關聯 Issue 更新 = 僅在有關聯 Issue 時**才做；無則 `N/A`。
- **`Closes #N` / `Fixes #N` 寫在 PR body**（不是寫在 Issue）。

**關聯 Issue 偵測**：依序檢查 — 使用者明確指定的 issue、branch / PR 標題或 body 內的 issue 編號、PR body 既有的 `Closes/Fixes`、或 `gh pr view --json closingIssuesReferences`。四者皆無 → 視為無關聯 Issue（`N/A`）。

### Body-safe（防止整段覆蓋）

`gh pr edit --body` 與 issue 的 `PATCH body=` 會**整段取代** body。務必：**先讀現有 body → 保留原內容 → 在受控區段（如 `## 變更摘要 / Change Summary`，僅放實作描述）追加或更新**，**禁止盲蓋**既有 PR 模板、Issue 描述、需求、截圖。**測試 / Code Review 結果不寫進 body，改用 comment 追加。**

### 指令範例

```bash
# 1. 先讀現有內容（保留再更新，切勿覆蓋）
gh pr view <pr-number> --json body,url,closingIssuesReferences

# 2. 編輯 PR body（保留原內容 + 追加/更新實作摘要區段，body 內含 Closes #N）
gh pr edit <pr-number> --body "<preserved body + 變更摘要區段>"

# 3. 在 PR 追加測試 / Code Review 結果 comment（append；PR 也是一種 issue，共用 issues/.../comments 端點）
gh api repos/{owner}/{repo}/issues/<pr-number>/comments -X POST -f body="<測試 / Code Review 結果>"

# 4. 有關聯 Issue 時：先讀 → 保留 → 更新 body / 追加 comment
gh issue view <issue-number> --json body,url
gh api repos/{owner}/{repo}/issues/<issue-number> -X PATCH -f body="<preserved + updated>"
gh api repos/{owner}/{repo}/issues/<issue-number>/comments -X POST -f body="<comment>"
```

### Forcing function — 合併前必須輸出此確認區塊

更新完成後、**執行 merge 指令前**，先輸出並逐項驗證：

```text
Pre-Merge Gate 確認
- PR body updated/preserved（實作描述）: ✅ <PR URL>
- Closing keyword:       Closes #N / N/A
- Verification comment（測試 / Code Review 結果）: ✅ <URL> / N/A
- Linked issue updated:  ✅ #N / N/A（附理由）
- Verified with:         gh pr view ... /（必要時）gh issue view ...
```

- **merge 為獨立動作**：更新 PR/Issue 與 merge **不可串在同一個 shell 指令**。
- **任一項無法驗證 → STOP，不得合併**。
- 例外：PR 已被人類在 GitHub 合併（狀態 `MERGED`）→ 不需回溯本 Gate，可直接 cleanup。

> 操作 Issue / PR 內容與 comment 的完整指令見 `github-issues` skill。

## Workflow 5: Merge & Cleanup (after PR approved)

**Triggers**: "merge", "PR approved", "cleanup worktree"

> ⛔ **STOP — 執行下方任何合併 / cleanup 指令前**：先確認 **Workflow 4.5（Pre-Merge Update Gate）已完成並已輸出「Pre-Merge Gate 確認」區塊**。若尚未完成，**立即回到 Workflow 4.5**，不得直接合併。
>
> 速查 gate（詳見 Workflow 4.5）：
> ```bash
> gh pr view <pr-number> --json body,url,closingIssuesReferences   # 先讀
> gh pr edit <pr-number> --body "<preserved body + 變更摘要, 含 Closes #N>"  # 保留再更新（僅實作描述）
> gh api repos/{owner}/{repo}/issues/<pr-number>/comments -X POST -f body="<測試 / Code Review 結果>"  # append 驗證產物
> ```

**合併與 Cleanup — 透過 GitHub PR（唯一允許）**：
```bash
# 0. ⛔ 先完成 Workflow 4.5 並輸出確認區塊（見上方 STOP）

# 1. 確認 PR 狀態（OPEN 才需合併；若已 MERGED，例如已由人類在 GitHub 合併，則跳過第 2 步、直接 cleanup）
gh pr view <pr-number> --json state --jq .state

# 2. 僅當狀態為 OPEN 時：在 GitHub 合併（--merge = no-ff merge commit；禁止 squash / rebase）
gh pr merge <pr-number> --merge   # 視情況加 --delete-branch

# 3. Return to main repo
cd <main-repo-path>

# 4. Pull merged changes
git pull origin main

# 5. Remove worktree
git worktree remove ../worktree/<name>

# 6. Delete local branch
git branch -d <branch-name>
```

> ❌ **禁止本地合併 main**：嚴禁在本地執行 `git checkout main && git merge --no-ff <branch> && git push origin main` 直接推送到 main。所有合併必須透過 GitHub PR（`gh pr merge --merge` 或 Web UI），以保留審查記錄與 PR 流程。

## Workflow 6: Abandon Task

**Triggers**: "abandon", "cancel task", "discard worktree"

```bash
# 1. Return to main repo
cd <main-repo-path>

# 2. Force remove worktree
git worktree remove ../worktree/<name> --force

# 3. Delete branch
git branch -D <branch-name>

# 4. Delete remote branch (if pushed)
git push origin --delete <branch-name>
```

**Always confirm with user before executing** — this is destructive.

## Monorepo Notes

- Run `pnpm install` at the **workspace root** of the worktree (where `pnpm-workspace.yaml` lives)
- `node_modules` is NOT shared between worktrees
- `.env` files are gitignored — Workflow 1 copies them automatically during worktree creation. If you need to refresh them later: `cp <main-repo-path>/.env ../worktree/<name>/.env`
- Do NOT simultaneously rebase/merge the same branch from multiple worktrees
- Run `pnpm tsc --noEmit` and `pnpm eslint` in affected sub-projects before pushing

## CLI Session Tips

### Same-session workflow (preferred)
- After creating a worktree, you are already `cd`'d into it — **just keep working**
- All subsequent terminal commands run in the worktree context automatically
- The conversation history (requirements, decisions, context) is fully preserved
- The worktree contains the same `.github/instructions/` and `.github/skills/`, so agent behavior is consistent

### Resuming an interrupted session
- If the CLI session was terminated, restart in the worktree: `cd ../worktree/<name> && gh copilot`
- Resume previous session: `gh copilot -- --resume`
- Continue most recent: `gh copilot -- --continue`

### Switching between worktrees mid-session
- Simply `cd ../worktree/<other-name>` — no need to restart the CLI
- Verify the switch: `git branch --show-current` and `pwd`

## Reference

| File | Contents |
|------|----------|
| [references/troubleshooting.md](references/troubleshooting.md) | pnpm, path, merge conflict solutions |
