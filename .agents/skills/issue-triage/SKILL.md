---
name: issue-triage
description: Triage the GitHub issue backlog for the current repo — list, filter, prioritize, and pick issues. Supports --type filtering by label, --prioritize to mark issues as high priority, and --pick to select and set up a branch for the top issue.
---

# Issue Triage

Triage the GitHub issue backlog — list, filter, prioritize, and pick issues to work on.

**This skill is opinionated.** It does not simply dump a list and wait. It actively reads the backlog, forms a judgment about what matters most *right now*, and proposes a recommendation the user can accept, override, or challenge. Passive listing without a proposal is a failure mode — always take a stance.

---

## Usage

```
/issue-triage [--type <label>[,<label>...]] [--top <N>] [--prioritize] [--pick]
```

### Flags

| Flag | Description |
|------|-------------|
| `--type <label>` | Filter issues by GitHub label(s). Comma-separated for multiple. Examples: `bug`, `enhancement`, `semantic-graph`, `ui` |
| `--top <N>` | Show the top N issues (default: **5**). All `high`-labeled issues are always shown in addition to the top N candidates. |
| `--prioritize` | After listing, prompt the user to approve marking specific issues with the `high` label |
| `--pick` | Automatically pick the highest-priority issue, sync main, create a branch, and prepare to work on it |

Flags can be combined: `/issue-triage --type bug --prioritize --pick`

---

## Behavior

### Default (no flags)

1. Run `gh issue list --state open --limit 100` to fetch all open issues.
2. Display a **Stats** summary first (see [Stats Summary](#stats-summary) below).
3. Then display **only the top issues that should be considered first** — not the full list:
   - All issues with the `high` label (always shown)
   - Plus top candidates up to **N** total (where N is `--top <N>`, default **5**)
   - Ranking: `high` first, then bugs before enhancements, then newer before older (recency signals active pain)
4. **Always close with a Recommendation block** (see [Recommendation](#recommendation) below) — name one issue you'd pick next, give a 1–2 sentence rationale, and invite the user to accept or redirect. Never end a triage turn without a proposal.
5. If there are more issues not shown, end with a one-liner: `… and N more open issues. Use --type <label> to filter or --top <N> to show more.`

### With `--type <label>`

1. Run `gh issue list --state open --label "<label>" --limit 100` for each specified label.
2. Display the **Stats** summary scoped to the filtered set.
3. Display only the top **N** issues from the filtered set (default 5, overridable with `--top <N>`) using the same ranking rules.
4. If multiple labels are given (comma-separated), combine results and deduplicate by issue number.

### With `--prioritize`

1. First, display the stats summary and the top-issues table (filtered by `--type` if provided).
2. Suggest which of the **shown** issues should be prioritized based on:
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

## Stats Summary

Always display a stats block before the top-issues table:

```
📊 Open Issues: 23 total
   • High priority: 2
   • Bugs: 4 · Enhancements: 15 · Other: 4
   • By label: semantic-graph (11), ui (6), architecture (4), tooling (3), testing (2)
   • Oldest open: #125 (3d) · Newest: #153 (1h)
```

Compute counts from the fetched issue list. When `--type` is used, stats are scoped to the filtered set.

---

## Recommendation

**Always** end the default / `--type` flows with an opinionated recommendation. Pick **one** issue (not three, not a menu) and defend the choice briefly. Example:

```
💡 Recommendation: tackle #144 next.
   It's the only open bug and it silently drops user input — correctness bugs with
   silent failure modes erode trust fast. The semantic-graph cluster (#132–143) is
   bigger in volume but most of those are rendering/cosmetic; #144 is the one
   actively producing wrong output. Say `--pick` to start on it, or tell me what
   to pick instead.
```

Rules:
- Exactly **one** recommended issue per turn.
- Rationale must reference the *specific* issue — not generic platitudes.
- Weigh: correctness > UX > polish; silent failures > loud failures; blockers > leaves; recency as a tiebreaker.
- If the user's `--type` filter narrows things such that the recommendation feels weak, say so honestly ("nothing here feels urgent — consider dropping the filter").
- Never hedge with "it depends" or "you could pick any of these." Take a stance.

---

## Display Format

Show only the **top N issues to consider first** (default 5, configurable with `--top <N>`):

```
🎯 Top 5 issues to consider first:

| #   | Title                                              | Type              | Pri  | Age |
|-----|----------------------------------------------------|-------------------|------|-----|
| 144 | Comma-separated equations: second clause dropped   | bug, semantic-graph | HIGH | 2d  |
| 153 | Improve left/right panel expand/collapse UX         | enhancement, ui   |      | 1d  |
```

- **Pri** column shows `HIGH` if the issue has the `high` label, blank otherwise.
- **Age** is relative (e.g. `1h`, `1d`, `3d`, `2w`, `1mo`).
- Ranking: HIGH first, then bugs before enhancements, then newer before older.
- End with `… and N more open issues` if the full list is longer than what's shown.

---

## Notes

- Never auto-commit. Implementation changes require explicit user instruction to commit.
- Always sync main before creating a new branch when using `--pick`.
- Branch naming: `fix/<number>-<slug>` for bugs, `feat/<number>-<slug>` for enhancements.
- If the picked issue is complex or ambiguous, ask probing questions and present options before implementing.
- If the issue is straightforward, present the solution and ask for a simple go/no-go.
