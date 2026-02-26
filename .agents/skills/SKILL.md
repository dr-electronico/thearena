---
name: arena-dev-guardian
description: >
  Runs every turn for The Arena project. Manages two responsibilities:
  (1) GitHub commits when the user explicitly requests a backup,
  (2) Keeping game_architecture.md in sync with confirmed, working changes.
  Never commits or edits docs without explicit user confirmation. Never acts
  on changes that haven't been tested by the user.
---

# Arena Dev Guardian — Persistent Skill

> This skill is active **every turn** while working on The Arena project
> (`thearena/` workspace). Read and follow these rules on every response.

---

## 1. GitHub Backup Rule

### When to offer a commit
- ONLY when the user **explicitly** uses phrases like:
  - "please backup", "backup the code", "commit", "push to github", "save to git"
- You MAY proactively suggest a backup **once per session** if all of the
  following are true:
  - A significant feature was just confirmed working (e.g. new system,
    major bug fix, new weapon type, new world element)
  - No commit has been made yet in this session
  - The suggestion is brief and non-intrusive (one sentence max)

### Pre-commit checklist (REQUIRED — never skip)
Before running any git command, you MUST verbally confirm all of the following
with the user:

1. **Regression check**: "Have you tested the game and confirmed nothing is
   broken from the previous session?" — wait for explicit "yes" or "all good".
2. **Scope summary**: Tell the user exactly what files changed and what the
   commit message will be.
3. Only after both confirmations, proceed with the commit steps below.

### Commit steps (project root: `/Users/lautaroanriquez/coding/2026/thearena`)

```bash
# 1. Stage all tracked + new files
git add -A

# 2. Commit with a descriptive message (fill in based on actual changes)
git commit -m "feat: <short description of what was added/fixed>"

# 3. Push to origin
git push
```

Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `perf:`.

### What NOT to do
- Never commit if the user hasn't tested the game after the last change.
- Never auto-run git commands without user approval (SafeToAutoRun = false).
- Never commit half-working features or known regressions.

---

## 2. Architecture Document Rule (`game_architecture.md`)

### File location
`/Users/lautaroanriquez/coding/2026/thearena/game_architecture.md`

### When to update
Update the architecture doc ONLY when ALL of the following are true:
- A **significant structural change** was made (new system, changed constants,
  new method, changed collision logic, new world element, new weapon type, etc.)
- The user has **explicitly confirmed the change works** (they tested it)
- The change is **not a regression fix for something broken** — only
  confirmed, stable additions/changes go in

### What counts as "significant"
- ✅ New weapon type added
- ✅ New world element (environment, structure, terrain feature)
- ✅ New game system (NPC enemies, game-over logic, consumables, scoring, etc.)
- ✅ Constants changed (speed, physics values, arena size, etc.)
- ✅ New HUD element or new DOM ID added
- ✅ Collision or physics behaviour changed
- ✅ New inventory slot logic or pickup mechanic changed
- ❌ Minor style tweaks
- ❌ Small bug fixes that don't change architecture
- ❌ Refactors with identical external behaviour

### How to update
1. Only use `multi_replace_file_content` or `replace_file_content` — never
   rewrite the whole document.
2. Update only the relevant section(s) — do not change unrelated sections.
3. Update the `> Last updated:` date at the top of the file.
4. Update relevant tables (constants, HUD IDs, weapon types, etc.) if values changed.
5. Add new subsections under the relevant heading if a new system was added.
6. Always keep gotchas section (#22) current — add a new row if a subtle
   behaviour was discovered.

### Before updating, briefly tell the user
"I'm going to update `game_architecture.md` to document [what changed].
Is that okay?" — proceed only on confirmation.

---

## 3. Turn-by-Turn Behaviour Summary

At the END of each assistant response (after completing the user's request),
quickly check:

| Condition | Action |
|---|---|
| User said "backup" / "commit" / "push" | → Run Pre-commit checklist, then commit |
| Significant feature just confirmed working + no commit yet this session | → ONE brief suggestion: "Want me to back this up to GitHub?" |
| Significant architectural change confirmed working | → Ask once: "Want me to update `game_architecture.md`?" |
| Minor changes / unconfirmed / regression fixes | → Do nothing, stay quiet |

**Stay quiet by default.** Only speak up when truly warranted.
One sentence is always enough for a suggestion.

---

## 4. Git Setup Reference

```
Repo root : /Users/lautaroanriquez/coding/2026/thearena
Remote    : origin (GitHub — already configured)
Branch    : whatever is currently checked out (do not switch branches)
```

To check current git status before committing:
```bash
git -C /Users/lautaroanriquez/coding/2026/thearena status --short
git -C /Users/lautaroanriquez/coding/2026/thearena log --oneline -5
```
