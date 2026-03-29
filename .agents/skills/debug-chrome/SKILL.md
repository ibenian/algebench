# Debug AlgeBench in Chrome

Launch AlgeBench (if not already running), open it in Chrome via browser tools, and interactively debug the UI.

---

## Usage

```
/debug-chrome [stop|restart]
```

- `/debug-chrome` — ensure the app is running and open it in Chrome
- `/debug-chrome stop` — kill the running server
- `/debug-chrome restart` — kill and relaunch the server

---

## Steps

### 1. Check if the server is already running

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:8785/
```

- If HTTP 200 → server is running, skip to step 3.
- If connection refused or non-200 → server is not running, go to step 2.
- If the user passed `stop`, go to step 5.
- If the user passed `restart`, go to step 5 first, then step 2.

### 2. Launch the server

Run in background:

```bash
./algebench scenes/test/test-proof-quadratic.json --debug --server-only &
```

Wait a few seconds, then verify it's up:

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:8785/
```

If still not responding, check if the port is different:

```bash
grep 'DEFAULT_PORT' server.py
```

Adjust the URL accordingly.

### 3. Open in Chrome

Use the Chrome browser tools:

1. `tabs_context_mcp` with `createIfEmpty: true`
2. Create a new tab or reuse an existing one
3. Navigate to `http://localhost:8785`
4. Click the **Chat** tab to access AI chat and TTS controls

### 4. Debug interactively

Now use Chrome tools (screenshot, javascript_tool, read_console_messages, read_page, etc.) to debug whatever the user needs.

- **Check console errors**: `read_console_messages` with `onlyErrors: true`
- **Inspect state**: `javascript_tool` to query JS variables and DOM
- **Take screenshots**: `computer` with `action: screenshot`
- **Click elements**: `computer` with `action: left_click`

**Important**: `chat.js` variables like `activeSpeakBtn`, `ttsRequestId`, `ttsPlayer` are script-scoped (not ES modules), so they ARE accessible from `javascript_tool`. If a variable is not accessible, check if it was declared inside a function closure.

### 5. Stop the server

Find and kill the process:

```bash
lsof -ti :8785 | xargs kill 2>/dev/null || true
```

Verify it's stopped:

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:8785/ 2>/dev/null || echo 'stopped'
```

### Notes

- The server auto-reloads static files (JS/CSS/HTML) on each request — no restart needed for frontend changes.
- **Restart is needed** when Python files (server.py, agent_tools.py) change.
- Use `--debug` flag for verbose server logging.
