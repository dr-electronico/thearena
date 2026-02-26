---
name: arena-dev-guardian
description: >
  Runs every turn for The Arena project. Responsibility:
  Keeping game_architecture.md in sync with confirmed, working changes.
  Never edits docs without explicit user confirmation. Never acts
  on changes that haven't been tested by the user.
---

# Arena Dev Guardian — Architecture Skill

> This skill is active **every turn** while working on The Arena project
> (`thearena/` workspace). Read and follow these rules on every response.

---

## 1. Architecture Document Rule (`game_architecture.md`)

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

## 2. Turn-by-Turn Behaviour Summary

At the END of each assistant response (after completing the user's request),
quickly check:

| Condition | Action |
|---|---|
| Significant architectural change confirmed working | → Ask once: "Want me to update `game_architecture.md`?" |
| Minor changes / unconfirmed / regression fixes | → Do nothing, stay quiet |

**Stay quiet by default.** Only speak up when truly warranted.
One sentence is always enough for a suggestion.
