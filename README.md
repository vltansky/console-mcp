<div align="center">

<img src="packages/extension/icon.png" alt="console-bridge icon" width="128" height="128">

# console-bridge

**Control your Chrome browser from AI assistants**

Query console logs, execute JavaScript, and inspect DOM — all through natural language.

[![NPM Version](https://img.shields.io/npm/v/console-bridge)](https://www.npmjs.com/package/console-bridge)
[![License](https://img.shields.io/npm/l/console-bridge)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io)

</div>

---

## Quick Start

### 1. Install Extension

```bash
git clone https://github.com/vltansky/console-bridge-mcp.git
cd console-bridge-mcp && npm install && npm run build
```

Load in Chrome: `chrome://extensions` → Enable Developer mode → Load unpacked → Select `packages/extension/dist`

### 2. Add MCP Server

**Cursor** (one-click): [Install](https://cursor.com/en/install-mcp?name=console-bridge&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNvbnNvbGUtYnJpZGdlQGxhdGVzdCJdfQ==)

**Manual** — add to your MCP config:

```json
{
  "mcpServers": {
    "console-bridge": {
      "command": "npx",
      "args": ["-y", "console-bridge-mcp@latest"]
    }
  }
}
```

### 3. Use It

```
Show me all error logs from localhost:3000
```

```
Execute: document.querySelector('.submit-btn').click()
```

```
Query DOM for '.error-message' and get textContent
```

---

## What You Can Do

| Prompt | What Happens |
|--------|--------------|
| `Show error logs from the last 5 minutes` | Fetches filtered console logs with stack traces |
| `Search for "authentication failed"` | Regex/keyword search across all captured logs |
| `Which tab should I focus on?` | Ranks open tabs by URL patterns, ports, domains |
| `Execute: localStorage.getItem('token')` | Runs JS in the page, returns result |
| `Query DOM for '.btn' properties` | Extracts element attributes without DevTools |
| `Show me a snapshot of recent errors` | Summarizes error counts and patterns |

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `console_tabs` | List/suggest browser tabs |
| `console_logs` | List, get, or tail logs |
| `console_search` | Regex/keyword search |
| `console_snapshot` | Quick error summary |
| `console_browser_execute` | Run JS or query DOM |
| `console_browser_info` | Get page title/URL |
| `console_sessions` | Save/load log snapshots |
| `console_skills_list/load` | Project-specific playbooks |

---

## Configuration

```bash
CONSOLE_MCP_PORT=9847              # WebSocket port
CONSOLE_MCP_MAX_LOGS=10000         # Max logs in memory
CONSOLE_MCP_LOG_TTL_MINUTES=60     # Auto-cleanup (0 = unlimited)
```

---

## Architecture

```
Browser Extension  ──WebSocket──▶  MCP Server  ◀──stdio──  AI Assistant
(captures logs)                    (stores/queries)        (Cursor/Claude)
```

---

## Development

```bash
npm install && npm run build
npm run dev:server    # Hot reload server
npm run dev:extension # Hot reload extension
```

---

## License

MIT
