---
name: backup-manager
description: >
  Handles automated GitHub backups. Initiates when the user asks to
  "backup", "commit", or "push". Ensures changes are staged, committed
  with a meaningful message, and pushed to origin.
---

# Backup Manager — Git Workflow Skill

This skill defines the standard procedure for backing up the project to GitHub.

## 1. Triggers
This skill should be executed whenever the user uses keywords like:
- "backup"
- "commit"
- "push to github"
- "save changes"

## 2. Pre-backup Routine
Before executing any git commands, perform the following:

1. **Test Confirmation**: Confirm with the user that the code has been tested and is working as expected.
2. **Review Changes**: List the files that have been modified or added.
3. **Commit Message Proposal**: Suggest a descriptive commit message based on the work done in the session.

## 3. Implementation Steps
Once the user confirms "yes" to the backup:

```bash
# Workspace: /Users/lautaroanriquez/coding/2026/thearena

# 1. Stage all changes (tracked and untracked)
git add -A

# 2. Create a local commit
git commit -m "[type]: [description]"
# Use Conventional Commits: feat, fix, docs, style, refactor, perf, test, chore.

# 3. Push to the remote repository
git push
```

## 4. Post-backup
- Inform the user that the backup was successful.
- Provide the short hash of the new commit if possible.
