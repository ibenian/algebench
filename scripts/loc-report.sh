#!/usr/bin/env bash
set -euo pipefail

# Lines-of-code report using tokei
# Generates a detailed breakdown by language, file, and category.

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPORT_FILE="${1:-LOC-REPORT.md}"
EXCLUDE=(-e .venv -e node_modules -e __pycache__)

if ! command -v tokei &>/dev/null; then
  echo "tokei not found, installing..."
  if command -v brew &>/dev/null; then
    brew install tokei
  elif command -v cargo &>/dev/null; then
    cargo install tokei
  else
    echo "Error: neither brew nor cargo available to install tokei" >&2
    exit 1
  fi
fi

COMMIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
COMMIT_DATE="$(git -C "$REPO_ROOT" log -1 --format=%ci)"
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"

{
  echo "# Lines of Code Report"
  echo ""
  echo "> **Auto-generated** by [\`scripts/loc-report.sh\`](scripts/loc-report.sh) — do not edit manually."
  echo ""
  echo "| Field | Value |"
  echo "|---|---|"
  echo "| **Branch** | \`$BRANCH\` |"
  echo "| **Commit** | \`$COMMIT_SHA\` |"
  echo "| **Date** | $COMMIT_DATE |"
  echo ""

  echo "## Language Breakdown"
  echo ""
  tokei "$REPO_ROOT" "${EXCLUDE[@]}" --output json 2>/dev/null | python3 -c "
import sys, json

data = json.load(sys.stdin)
langs = []
for lang, stats in data.items():
    if lang == 'Total':
        continue
    if isinstance(stats, dict) and 'code' in stats:
        code = stats['code']
        comments = stats.get('comments', 0)
        blanks = stats.get('blanks', 0)
        if code > 0:
            langs.append((lang, code, comments, blanks))

langs.sort(key=lambda x: x[1], reverse=True)

# Mermaid xychart
names = ', '.join(f'\"{l[0]}\"' for l in langs)
values = ', '.join(str(l[1]) for l in langs)
print('> [!NOTE]')
print('> Chart renders on GitHub and in Mermaid-compatible viewers.')
print()
print('\`\`\`mermaid')
print('xychart-beta horizontal')
print('  title \"Lines of Code by Language\"')
print(f'  x-axis [{names}]')
print(f'  bar [{values}]')
print('\`\`\`')
"
  echo ""

  echo "## Summary by Language"
  echo ""
  echo '```'
  tokei "$REPO_ROOT" "${EXCLUDE[@]}" --sort code
  echo '```'
  echo ""

  echo "## Frontend Assets (per file)"
  echo ""
  echo '```'
  tokei "$REPO_ROOT/static" --files --sort code
  echo '```'
  echo ""

  echo "## Backend Python (per file)"
  echo ""
  echo '```'
  tokei "$REPO_ROOT" "${EXCLUDE[@]}" --types Python --files --sort code
  echo '```'
  echo ""

  echo "## Category Breakdown"
  echo ""

  js_lines=$(tokei "$REPO_ROOT/static" --output json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
js = data.get('JavaScript', data.get('Inner', {}))
print(js.get('code', 0) if isinstance(js, dict) else 0)
" 2>/dev/null || echo "0")

  py_lines=$(tokei "$REPO_ROOT" "${EXCLUDE[@]}" --types Python --output json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
py = data.get('Python', data.get('Inner', {}))
print(py.get('code', 0) if isinstance(py, dict) else 0)
" 2>/dev/null || echo "0")

  total=$((js_lines + py_lines))
  if [ "$total" -gt 0 ]; then
    js_pct=$((js_lines * 100 / total))
    py_pct=$((100 - js_pct))
  else
    js_pct=0
    py_pct=0
  fi

  echo "| Category | Code Lines | % of JS+Python |"
  echo "|---|---|---|"
  echo "| JavaScript (frontend) | $js_lines | ${js_pct}% |"
  echo "| Python (backend) | $py_lines | ${py_pct}% |"
  echo "| **Total** | **$total** | **100%** |"

} > "$REPORT_FILE"

echo "Report written to $REPORT_FILE"
