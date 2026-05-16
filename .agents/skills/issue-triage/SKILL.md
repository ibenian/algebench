---
name: issue-triage
description: Triage the GitHub issue backlog and code scanning alerts for the current repo — list, filter, prioritize, and pick issues or alerts. Supports --type filtering by label, --code-scanning for CodeQL/security alerts, --prioritize to mark issues as high priority, and --pick to select and set up a branch for the top item.
---

# Issue Triage

Triage the GitHub issue backlog and code scanning alerts — list, filter, prioritize, and pick issues or alerts to work on.

**This skill is opinionated.** It does not simply dump a list and wait. It actively reads the backlog, forms a judgment about what matters most *right now*, and proposes a recommendation the user can accept, override, or challenge. Passive listing without a proposal is a failure mode — always take a stance.

---

## Usage

```
/issue-triage [--type <label>[,<label>...]] [--top <N>] [--prioritize] [--pick]
/issue-triage --code-scanning [--top <N>] [--pick]
```

### Flags

| Flag | Description |
|------|-------------|
| `--type <label>` | Filter issues by GitHub label(s). Comma-separated for multiple. Examples: `bug`, `enhancement`, `semantic-graph`, `ui` |
| `--code-scanning` | Triage open GitHub code scanning alerts instead of issues. Focuses on CodeQL/security alerts and links to the alert URL. |
| `--top <N>` | Show the top N issues or code scanning alerts (default: **5**). For issue triage, all `high`-labeled issues are always shown in addition to the top N candidates. |
| `--prioritize` | After listing, prompt the user to approve marking specific issues with the `high` label |
| `--pick` | Automatically pick the highest-priority issue or code scanning alert, sync main, create a branch, and prepare to work on it |

Issue-triage flags can be combined: `/issue-triage --type bug --prioritize --pick`
Use `/issue-triage --code-scanning` for CodeQL/code scanning alert triage. `--code-scanning` is mutually exclusive with `--type`, because it triages alerts instead of issues. `--prioritize` does not apply to `--code-scanning`; if both are provided, ignore `--prioritize` and say alerts do not have issue labels.

---

## Behavior

### Default (no flags)

1. Fetch the issue list and the quick high-severity code scanning preflight **in parallel**. Use `multi_tool_use.parallel` when available; otherwise start both shell commands before waiting on either result.
   Issue command:
   ```bash
   gh issue list --state open --limit 100
   ```
   Security preflight command:
   ```bash
   gh api --paginate --method GET -F per_page=100 repos/:owner/:repo/code-scanning/alerts --jq '.[] | select(.state=="open" and (.rule.security_severity_level=="critical" or .rule.security_severity_level=="high")) | {
     number,
     rule: .rule.id,
     severity: .rule.security_severity_level,
     description: .rule.description,
     path: .most_recent_instance.location.path,
     line: .most_recent_instance.location.start_line,
     url: .html_url
   }'
   ```
   After fetching the complete high/critical alert set, rank the results with the same code-scanning ranking rules and show only the top 5 in a compact **Security Alerts** block. Do not rely on API order or first-page order for this block. Include a one-line prompt: `Security alerts are open. Say --code-scanning to triage them fully.`
2. After both parallel fetches complete, display results in this order:
   - **Security Alerts** block first, only if high/critical alerts exist
   - Issue **Stats** summary next (see [Stats Summary](#stats-summary) below)
   - Top issue table after the stats
3. Then display **only the top issues that should be considered first** — not the full list:
   - All issues with the `high` label (always shown)
   - Plus top candidates up to **N** total (where N is `--top <N>`, default **5**)
   - Ranking: `high` first, then bugs before enhancements, then newer before older (recency signals active pain)
4. **Always close with a Recommendation block** (see [Recommendation](#recommendation) below) — name one issue you'd pick next, give a 1–2 sentence rationale, and invite the user to accept or redirect. Never end a triage turn without a proposal.
5. If the preflight found no high/critical code scanning alerts, offer to check all code scanning alerts as a separate follow-up: `Say --code-scanning to also triage CodeQL/security alerts.`
6. If there are more issues not shown, end with a one-liner: `… and N more open issues. Use --type <label> to filter or --top <N> to show more.`

### With `--type <label>`

1. Fetch the filtered issue list(s) and the same paginated high-severity code scanning preflight from the default flow **in parallel**. Use `multi_tool_use.parallel` when available; otherwise start the issue query/query set and security preflight before waiting on either result. If any high/critical alerts exist, rank the complete preflight result set and show the compact **Security Alerts** block before the filtered issue stats.
2. Run `gh issue list --state open --label "<label>" --limit 100` for each specified label as the issue-side parallel work.
3. Display the **Stats** summary scoped to the filtered set.
4. Display only the top **N** issues from the filtered set (default 5, overridable with `--top <N>`) using the same ranking rules.
5. If multiple labels are given (comma-separated), combine results and deduplicate by issue number.
6. If the preflight found no high/critical code scanning alerts, offer to check all code scanning alerts as a separate follow-up: `Say --code-scanning to also triage CodeQL/security alerts.`

### With `--code-scanning`

1. Triage code scanning alerts instead of GitHub issues. Do not mix issue rows and alert rows in the same table unless the user explicitly asks for both.
2. Fetch open alerts with:
   ```bash
   gh api --paginate --method GET -F per_page=100 repos/:owner/:repo/code-scanning/alerts --jq '.[] | select(.state=="open") | {
     number,
     rule: .rule.id,
     severity: .rule.security_severity_level,
     description: .rule.description,
     tool: .tool.name,
     path: .most_recent_instance.location.path,
     line: .most_recent_instance.location.start_line,
     url: .html_url,
     created_at,
     updated_at
   }'
   ```
3. If `:owner/:repo` expansion is unavailable in the current shell/context, resolve it with:
   ```bash
   gh repo view --json nameWithOwner --jq .nameWithOwner
   ```
   then call `gh api --paginate --method GET -F per_page=100 repos/<owner>/<repo>/code-scanning/alerts`.
4. Display a **Code Scanning Stats** block before the alert table:
   ```text
   🔒 Open Code Scanning Alerts: 30 total
      • High: 20 · Medium: 10 · Low/Other: 0
      • By rule: py/path-injection (18), py/stack-trace-exposure (10), js/xss-through-dom (1)
      • By file: server.py (29), static/chat.js (1)
   ```
5. Display only the top **N** alerts (default 5), ranked:
   - `critical` before `high`, then `medium`, then `low`, then unset/unknown
   - Injection/XSS/path traversal/code execution/auth bypass before DoS/performance findings
   - Alerts in exposed request/response paths before offline tooling
   - Newer alerts before older alerts as a tiebreaker
6. Use this display format:
   ```text
   🔒 Top 5 code scanning alerts to consider first:

   | Alert | Severity | Rule | Location | Summary |
   |-------|----------|------|----------|---------|
   | #32 | high | js/xss-through-dom | static/chat.js:724 | DOM text reinterpreted as HTML |
   ```
7. End with exactly one **Recommendation** for the alert to fix next. Link to the alert URL and explain why it outranks the other alerts.
8. Do **not** use `Closes #<number>` for code scanning alerts. GitHub issue-closing keywords do not close code scanning alerts. Use phrasing like:
   ```markdown
   Addresses [Code scanning #31](https://github.com/OWNER/REPO/security/code-scanning/31).
   ```
   GitHub closes a code scanning alert automatically after the fix is merged into the scanned branch and the next CodeQL/code scanning run no longer reports that finding.
9. `--prioritize` does not apply to code scanning alerts because alerts do not have issue labels. If the user asks to prioritize code scanning alerts, rank them in the table and recommendation only.
10. If `--pick --code-scanning` is used, pick the highest-ranked alert, show its details, propose a fix, then wait for user approval before implementing. Branch naming should use:
   ```bash
   git checkout main
   git pull --ff-only origin main
   git checkout -b fix/code-scanning-<alert-number>-<short-slug>
   ```

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

If `--pick` is combined with `--code-scanning`, use the code scanning ranking and branch naming rules from the `--code-scanning` section instead of issue labels/issue numbers.

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

**Always** end the default / `--type` / `--code-scanning` flows with an opinionated recommendation. Pick **one** issue or alert (not three, not a menu) and defend the choice briefly. Example:

```
💡 Recommendation: tackle #144 next.
   It's the only open bug and it silently drops user input — correctness bugs with
   silent failure modes erode trust fast. The semantic-graph cluster (#132–143) is
   bigger in volume but most of those are rendering/cosmetic; #144 is the one
   actively producing wrong output. Say `--pick` to start on it, or tell me what
   to pick instead.
```

Rules:
- Exactly **one** recommended issue or alert per turn.
- Rationale must reference the *specific* issue or alert — not generic platitudes.
- Weigh: correctness > UX > polish; silent failures > loud failures; blockers > leaves; recency as a tiebreaker.
- For code scanning alerts, weigh exploitability and exposure first: XSS/injection/path traversal/code execution/auth bypass > sensitive data exposure > denial of service > diagnostics/noise.
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
