---
name: a2a-git-state
description: Capture trustworthy Git evidence and isolate agent work without overwriting a user's existing changes.
---

# A2A Git State

Inspect status, branch, recent log, remotes, tracking state, worktrees, staged changes, unstaged changes, and untracked files before mutation.

If work already exists, preserve it and use a dedicated branch plus worktree when practical. Never use `git reset --hard`, `git checkout -- .`, delete untracked files, or force-push as routine recovery.

Evidence must include:

- worktree path and branch;
- base, `HEAD`, and remote commit identifiers;
- clean/dirty state with affected paths;
- final diff summary and validation tied to the commit;
- push result and remote tracking commit when a push is authorized.

Do not claim deployment evidence from a local commit alone. Treat destructive history changes and production-branch overwrites as review-required actions.
