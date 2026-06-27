# Git Worktree Troubleshooting

## pnpm install fails in worktree

**Symptom**: `ERR_PNPM_LOCKFILE_MISSING` or module resolution errors.

**Fix**:
```bash
# Ensure you're at the worktree root (where pnpm-workspace.yaml exists)
cd ../worktree/<name>
pnpm install
```

Do NOT delete `pnpm-lock.yaml` — it's tracked by git and shared across worktrees.

## Worktree path already exists

**Symptom**: `fatal: '<path>' already exists`

**Fix**:
```bash
# Check existing worktrees
git worktree list

# If stale entry, prune
git worktree prune

# If directory exists but isn't a worktree, choose a different name
```

## Branch already checked out

**Symptom**: `fatal: '<branch>' is already checked out at '<path>'`

**Cause**: Git does not allow the same branch to be checked out in multiple worktrees.

**Fix**: Use a different branch name, or remove the existing worktree first.

## .env files missing

**Symptom**: App fails to start because environment variables are undefined.

**Cause**: `.env` files are gitignored and not copied to new worktrees.

**Fix**:
```bash
cp <main-repo-path>/.env ../worktree/<name>/.env
# Copy any sub-project .env files too:
cp <main-repo-path>/src/mone-web/api/.dev.vars ../worktree/<name>/src/mone-web/api/.dev.vars
```

## Merge conflicts during rebase

**Fix**:
```bash
# In the worktree
git rebase main
# Resolve conflicts in editor
git add <resolved-files>
git rebase --continue

# Or abort and use merge instead
git rebase --abort
git merge main
```

## Windows path issues

- Avoid spaces in worktree paths
- Use forward slashes in shell commands: `../worktree/my-feature`
- PowerShell: use `Set-Location` or `cd` with quoted paths if needed

## Worktree removal fails

**Symptom**: `fatal: '<path>' contains modified or untracked files`

**Fix**:
```bash
# Force removal (discards uncommitted changes)
git worktree remove ../worktree/<name> --force
```

**Always confirm with the user before force removal.**

## Multiple worktrees + git operations

- Do NOT run `git rebase` or `git merge` on the same branch from two worktrees simultaneously
- Each worktree has its own working tree but shares the `.git` directory
- `git stash` is branch-specific and works independently per worktree
