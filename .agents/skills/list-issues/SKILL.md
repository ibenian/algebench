---
name: list-issues
description: List, filter, prioritize, and pick GitHub issues for the current repo. Supports --type filtering by label, --prioritize to mark issues as high priority, and --pick to select and set up a branch for the top issue.
---

# List Issues

Manage the GitHub issue backlog — list, filter, prioritize, and pick issues to work on.

---

## Usage

```
/list-issues [--type <label>[,<label>...]] [--prioritize] [--pick]
```

### Flags

| Flag | Description |
|------|-------------|
| `--type <label>` | Filter issues by GitHub label(s). Comma-separated for multiple. Examples: `bug`, `enhancement`, `semantic-graph`, `ui` |
| `--prioritize` | After listing, prompt the user to approve marking specific issues with the `high` label |
| `--pick` | Automatically pick the highest-priority issue, sync main, create a branch, and prepare to work on it |

Flags can be combined: `/list-issues --type bug --prioritize --pick`

---

## Behavior

### Default (no flags)

1. Run `gh issue list --state open --limit 30` to fetch open issues.
2. Display issues in a table with columns: **#**, **Title**, **Type** (labels), **Priority** (whether `high` label is present), **Age**.
3. Issues with the `high` label sort to the top.

### With `--type <label>`

1. Run `gh issue list --state open --label "<label>" --limit 30` for each specified label.
2. Display the filtered list in the same table format.
3. If multiple labels are given (comma-separated), combine results and deduplicate by issue number.

### With `--prioritize`

1. First, display the issue list (filtered by `--type` if provided).
2. Suggest which issues should be prioritized based on:
   - **Bugs** over enhancements (correctness first)
   - **Data loss / silent failures** over cosmetic issues
   - **Dependency blockers** (issues that unblock other issues)
   - **Recency** (newer issues may reflect active pain)
3. Present the recommendation and ask the user to approve.
4. On approval, add the `high` label to the approved issues:
   ```bash
   gh issue edit <number> --add-label "high"
   ```
5. Confirm the labels were applied.

### With `--pick`

1. Display the issue list (respecting `--type` filter if provided).
2. Select the top issue using this priority order:
   - Issues labeled `high` come first
   - Among `high` issues: bugs before enhancements, then by issue number (oldest first)
   - If no `high` issues: apply the same bug-first, oldest-first heuristic
3. Show the picked issue with its full description:
   ```bash
   gh issue view <number>
   ```
4. Summarize the issue and propose a solution approach:
   - What the problem is
   - What files/areas are likely involved
   - Proposed solution(s) — if multiple approaches exist, list them with tradeoffs
   - Any probing questions if the issue is ambiguous
5. **Wait for user approval before implementing.**
6. On approval, set up the working branch:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b fix/<number>-<short-slug>   # or feat/ for enhancements
   ```
   Use `fix/` prefix for bugs, `feat/` prefix for enhancements.
7. Implement the solution.
8. After implementation, run all relevant tests and validations:
   ```bash
   npm test        # or project-appropriate test command
   npm run lint    # if available
   ```
9. Report results: what was done, test status, and any remaining concerns.
10. **Do NOT auto-commit.** Wait for the user to say "commit" or similar.

---

## Label Management

- The `high` label is created automatically if it doesn't exist:
  ```bash
  gh label create "high" --description "High priority" --color "d73a4a" 2>/dev/null || true
  ```
- Only the `high` label is managed by this skill. Other labels are left untouched.

---

## Display Format

```
| #   | Title                                              | Type              | Pri  | Age  |
|-----|----------------------------------------------------|-------------------|------|------|
| 144 | Comma-separated equations: second clause dropped   | bug, semantic-graph | HIGH | 2d  |
| 153 | Improve left/right panel expand/collapse UX         | enhancement, ui   |      | 1d  |
```

- **Pri** column shows `HIGH` if the issue has the `high` label, blank otherwise.
- **Age** is relative (e.g. `1d`, `3d`, `2w`, `1mo`).
- Sort order: HIGH first, then bugs before enhancements, then oldest first.

---

## Notes

- Never auto-commit. Implementation changes require explicit user instruction to commit.
- Always sync main before creating a new branch when using `--pick`.
- Branch naming: `fix/<number>-<slug>` for bugs, `feat/<number>-<slug>` for enhancements.
- If the picked issue is complex or ambiguous, ask probing questions and present options before implementing.
- If the issue is straightforward, present the solution and ask for a simple go/no-go.
