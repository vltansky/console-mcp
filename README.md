<div align="center">

<img src="packages/extension/icon.png" alt="console-bridge icon" width="128" height="128">

# console-bridge

**Real-time Browser Console Logs for AI Assistants**

A Model Context Protocol (MCP) server that captures browser console logs in real-time and provides AI assistants with powerful tools to query, search, and analyze debugging information.

[![NPM Version](https://img.shields.io/npm/v/console-bridge)](https://www.npmjs.com/package/console-bridge)
[![License](https://img.shields.io/npm/l/console-bridge)](./LICENSE)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-MCP_Server-blue)](https://modelcontextprotocol.io)

</div>

---

## Table of Contents

- [See It In Action](#see-it-in-action)
- [Why console-bridge?](#why-console-bridge)
- [Features](#features)
- [Installation](#installation)
  - [Prerequisites](#prerequisites)
  - [Quick Start](#quick-start)
  - [Client-Specific Setup](#client-specific-setup)
- [Usage](#usage)
- [MCP Tools Reference](#mcp-tools-reference)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Development](#development)
- [Community](#community)
- [Contributing](#contributing)
- [License](#license)

---

## See It In Action

### Debugging React Application Errors in Real-Time

Watch how console-bridge transforms the debugging workflow by giving AI assistants direct access to browser console logs.

**Scenario**: You're building a React app and encountering authentication errors. Instead of manually copying logs, just ask your AI assistant:

**Prompt:**

> Show me all error logs from the last 5 minutes on localhost:3000

**What happens:**
- console-bridge instantly fetches matching logs with full stack traces
- AI analyzes the error patterns and identifies the root cause
- You get actionable fixes without switching between browser and editor

---

### Smart Tab Selection for Multi-Project Development

When working on multiple projects simultaneously, console-bridge intelligently suggests which browser tab to focus on.

**Prompt:**

> Which tab should I focus on for debugging my checkout flow?

**What happens:**
- console-bridge analyzes your hints (URL patterns, domains, dev-server ports)
- Ranks all open tabs by relevance
- Suggests the most likely tab with reasoning
- Shows recent error counts per tab

**Result**: No more hunting through dozens of browser tabs to find the right one.

---

### Pattern Analysis Across Sessions

**Prompt:**

> Search for "authentication failed" errors in the last hour and show me the pattern

**What happens:**
- console-bridge searches across all captured logs using regex/keyword matching
- Groups errors by frequency, URL, and time distribution
- AI identifies patterns (e.g., "All auth errors happen after token refresh")
- Suggests fixes based on the error context

---

### Navigation Awareness & Retention

- `console_tabs` always reports `isActive`, `sessionId`, and `lastNavigationAt` so you can distinguish the current tab from historical ones.
- `sessionScope: "current"` is available on both `console_logs` and `console_search`, ensuring queries only consider logs captured after the most recent refresh/page navigation for the chosen tab.
- Logs automatically expire after `CONSOLE_MCP_LOG_TTL_MINUTES` (60 minutes by default) so stored data never grows unbounded. Set the value to `0` if you want unlimited retention.

These guardrails keep the tool focused on fresh context without forcing you to manually clear logs.

---

## Why console-bridge?

### ❌ Without console-bridge

When debugging with AI assistants, you have to:

- Manually copy-paste console logs from browser DevTools
- Switch between browser and editor constantly
- Lose context when console clears or page reloads
- Struggle to describe complex error patterns

### ✅ With console-bridge

console-bridge automatically captures all browser console logs and lets AI assistants:

- **Query logs in real-time** - Ask "Show me all authentication errors from the last 5 minutes"
- **Search with natural language** - "Find network timeout errors on the checkout page"
- **Analyze patterns** - Get statistics, filter by severity, group by tab/URL
- **Debug faster** - AI sees the exact errors without manual copy-paste

**Example:**

```txt
Show me all error logs from the last 10 minutes on localhost:3000
```

console-bridge fetches matching logs instantly, with full stack traces, timestamps, and tab context.

---

## Features

| Feature | Description | Benefit |
|---------|-------------|---------|
| 🔍 **Real-time Log Capture** | Browser extension captures console logs from all tabs | Never miss a log, even on page reload |
| 🤖 **AI Integration** | Query logs using natural language through 7 focused MCP tools | Ask questions instead of writing filters |
| 🎯 **Smart Tab Selection** | Suggest relevant tabs by combining URL patterns, domains, and ports | Find the right tab instantly in multi-project setups |
| 🔎 **Advanced Search** | Regex and keyword search with filtering by level, URL, time | Powerful pattern matching and boolean logic |
| 📊 **Session Management** | Save and restore named log sessions for debugging | Compare before/after, reproduce issues with memorable names |
| 🧭 **Active Tab Awareness** | Tab listing includes `isActive`, `sessionId`, and `lastNavigationAt` | Immediately see which tab is focused and when it last refreshed |
| 🔒 **Data Sanitization** | Automatically mask sensitive information (tokens, keys) | Debug safely without exposing secrets |
| 📤 **Export** | Export logs in JSON, CSV, or plain text formats | Share logs with team, analyze offline |
| 🕒 **Auto Retention** | Configurable TTL trims old logs (60 minutes by default) | Keep memory usage predictable |
| ⚡ **Lightweight** | Batched WebSocket protocol, minimal performance impact | <1% CPU overhead, 95% network reduction |
| 🎮 **Browser Automation** | Execute JavaScript, query DOM, get page info directly from AI | Reproduce issues, test fixes, inspect state without DevTools |

---

## Installation

### Prerequisites

- **Node.js** >= 18.0.0
- **Chrome or Edge** browser
- **MCP Client** (Cursor, Claude Code, VS Code, Windsurf, etc.)

### Quick Start

console-bridge requires two components: the MCP server and the browser extension.

#### Step 1: Install the MCP Server

```bash
npx console-bridge@latest
```

#### Step 2: Install Browser Extension

```bash
# Clone and build
git clone https://github.com/AiCodeCraft/console-bridge.git
cd console-bridge
npm install
npm run build

# Load extension in Chrome/Edge:
# 1. Open chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select packages/extension/dist
```

> **Note**: The extension is currently in development and not yet published to the Chrome Web Store. You'll need to load it as an unpacked extension.

#### Step 3: Configure Your MCP Client

See [Client-Specific Setup](#client-specific-setup) below for your preferred tool.

#### Step 4: Verify Installation

After installation, verify console-bridge is working:

1. **Restart your MCP client** completely
2. **Check connection status**:
   - **Cursor**: Look for green dot in Settings → Tools & Integrations → MCP Tools
   - **Claude Desktop**: Check for "console-bridge" in available tools
   - **VS Code**: Verify in GitHub Copilot settings
3. **Test with a simple query**:
   ```
   Show me all console logs from the last 5 minutes
   ```

If you see console-bridge tools being used, you're all set! 🎉

---

### Client-Specific Setup

<details>
<summary><b>Cursor</b></summary>

#### One-Click Install

[<img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Install in Cursor">](https://cursor.com/en/install-mcp?name=console-bridge&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNvbnNvbGUtYnJpZGdlQGxhdGVzdCJdfQ==)

#### Manual Install

Go to `Cursor Settings` → `MCP` → `Add new MCP Server`. Name to your liking, use `command` type with the command `npx -y console-bridge@latest`. You can also verify config or add command arguments via clicking `Edit`.

#### Project-Specific Configuration

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "console-bridge": {
      "command": "npx",
      "args": ["-y", "console-bridge@latest"]
    }
  }
}
```

</details>

<details>
<summary><b>Claude Code</b></summary>

Use the Claude Code CLI:

```bash
claude mcp add console-bridge npx -y console-bridge@latest
```

Or manually edit `~/.claude/config.json`:

```json
{
  "mcpServers": {
    "console-bridge": {
      "command": "npx",
      "args": ["-y", "console-bridge@latest"]
    }
  }
}
```

</details>

<details>
<summary><b>VS Code / VS Code Insiders</b></summary>

#### Click the button to install:

[<img src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Server&color=0098FF" alt="Install in VS Code">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22console-bridge%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22console-bridge%40latest%22%5D%7D) [<img alt="Install in VS Code Insiders" src="https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Install%20Server&color=24bfa5">](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%7B%22name%22%3A%22console-bridge%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22console-bridge%40latest%22%5D%7D)

#### Or install manually:

Follow the MCP install [guide](https://code.visualstudio.com/docs/copilot/chat/mcp-servers#_add-an-mcp-server). You can also install using the VS Code CLI:

```bash
# For VS Code
code --add-mcp '{"name":"console-bridge","command":"npx","args":["-y","console-bridge@latest"]}'
```

Or add to `settings.json`:

```json
{
  "mcp.servers": {
    "console-bridge": {
      "command": "npx",
      "args": ["-y", "console-bridge@latest"]
    }
  }
}
```

</details>

<details>
<summary><b>Windsurf</b></summary>

Add to your Windsurf MCP configuration:

```json
{
  "mcpServers": {
    "console-bridge": {
      "command": "npx",
      "args": ["-y", "console-bridge@latest"]
    }
  }
}
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

Follow the [MCP install guide](https://modelcontextprotocol.io/quickstart/user), then add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "console-bridge": {
      "command": "npx",
      "args": ["-y", "console-bridge@latest"]
    }
  }
}
```

</details>

---

## Usage

Once installed, the browser extension automatically captures console logs. Your AI assistant can now query them using natural language.

### Example Prompts

**List recent errors:**
```
Show me all error logs from the last 5 minutes
```

**Search for patterns:**
```
Search console logs for "authentication failed" or "401"
```

**Filter by URL:**
```
List warning logs from localhost:3000/checkout
```

**Smart tab selection:**
```
Which tab should I focus on for this project?
```

**Get statistics:**
```
Show console log statistics grouped by level
```

**Export logs:**
```
Export all error logs from the last hour as JSON
```

**Session management:**
```
Save current console logs as session "bug-investigation-2025"
```

**Browser automation:**
```
Execute JavaScript: document.querySelector('.error-message').textContent
```

```
Query DOM for '.submit-btn' and get disabled, className properties
```

---

## MCP Tools Reference

console-bridge now exposes **seven focused tools**. Each one keeps the surface area small while still covering the entire debugging workflow. Pass the desired `action` (or `mode`) plus only the fields you need and the server routes the request to the right handler.

---

### 🎯 `console_tabs`

Centralized tab intelligence.

- **`action: "list"`** — returns every connected tab with URLs, titles, and log counts; perfect for quick situational awareness.
- **`action: "suggest"`** — feeds working directory, URL patterns, domains, or expected ports to get a ranked list of likely tabs with reasoning.

**Response metadata**
- `isActive`: `true` for the tab currently focused in the browser.
- `sessionId`: Latest navigation/session identifier (changes after refresh or page navigation).
- `lastNavigationAt`: Timestamp (ms) for the most recent navigation, so you can compare "current" vs historical logs at a glance.

**Tips**
- Provide multiple `urlPatterns` when juggling monorepos or staging environments.
- Include likely dev-server ports (e.g., [3000, 5173]) so suggestions prioritize local tabs.

---

### 📋 `console_logs`

One tool for all direct log access.

- **`action: "list"`** — filter logs by level, tab, URL regex, or time window with pagination plus optional args/stack fields.
- **`action: "get"`** — fetch one log by ID for deep inspection (optionally sanitized).
- **`action: "tail"`** — stream the most recent logs while you reproduce an issue; reuses the same filters as `list`.

**Tips**
- Default responses omit `args`/`stack`; only include them when needed to save tokens.
- Use relative time strings like `"10m"` or `"2h"` for quick windowing.
- Pass `sessionScope: "current"` alongside `tabId` to automatically limit results to the latest navigation/session for that tab.
- The default page size is 50 logs; bump `limit` only when you really need more context.
- `sessionScope: "current"` always requires `tabId` so the server knows which navigation to target.

---

### 🔍 `console_search`

Pattern and keyword discovery in a single entry point.

- **`action: "regex"`** — run full regex queries across message/args/stack with optional context lines.
- **`action: "keywords"`** — boolean keyword search with AND/OR logic plus exclusions for fast text filtering.

**Tips**
- Pair with `tabId` filters to keep searches scoped.
- Start with small result limits, then broaden if you need more hits.
- Use `sessionScope: "current"` with `tabId` to search only the latest navigation logs.
- `levels`, `urlPattern`, `after`, and `before` match the same filter semantics as `console_logs`.
- Default `limit` is 50; request more only when necessary.

---

### 💾 `console_sessions`

Session lifecycle without juggling three separate tools.

- **`action: "save"`** — snapshot current (or filtered) logs with a name + description for later comparison.
- **`action: "load"`** — restore a saved session by human-friendly name or UUID.
- **`action: "list"`** — enumerate existing sessions with timestamps and counts.

**Tips**
- Use descriptive names like `"checkout-bug-before-fix"` to speed up lookups.
- Combine with `console_logs` after a `load` to re-run filters against the restored data.

---

### 🎮 `console_browser_info`

Lightweight page context without overloading the transcript.

- Returns page title and URL for a specified tab (defaults to active tab).
- Optional `includeHtml: true` dumps markup, but defaults to `false` to preserve tokens.

**Tips**
- Call before other actions to confirm you’re on the expected route.
- Keep `includeHtml` off unless you truly need the DOM dump.

---

### 🧪 `console_browser_execute`

Focused surface for in-page actions.

- **`mode: "execute_js"`** — run small JS snippets (e.g., toggle feature flags, inspect globals).
- **`mode: "query_dom"`** — fetch DOM nodes with CSS selectors and return chosen properties.

**Tips**
- Always pass `tabId` from `console_tabs` when working with multiple tabs.
- Provide specific selectors/properties; default DOM properties include `textContent`, `className`, `id`, `tagName`.
- Keep JS snippets idempotent—chain multiple calls for multi-step flows instead of one giant script.

---

### 📸 `console_snapshot`

Condensed view of recent log activity.

- **`window`** — choose `1m`, `5m`, or `15m` (default `5m`) to summarize that time range.
- Reports total logs, counts per level, top error messages, and (optionally) sample log IDs.
- Use `tabId` to focus on a specific tab; omit it for a holistic view across all tabs.

**Tips**
- Start with a snapshot before diving into `console_logs` to understand the error landscape.
- Set `includeExamples: true` when you need concrete log IDs to investigate further.

---

### 🧩 Maintenance via Extension

- Open the browser extension popup to clear logs or download exports directly without using MCP tools.
- The popup also shows live stats (total logs, active tabs) and provides a one-click JSON export.

---

## Configuration

Environment variables for the server:

```bash
CONSOLE_MCP_PORT=9847              # WebSocket server port (default: 9847)
CONSOLE_MCP_MAX_LOGS=10000         # Maximum logs to store in memory (default: 10000)
CONSOLE_MCP_SANITIZE_LOGS=true     # Enable automatic data sanitization (default: true)
CONSOLE_MCP_BATCH_SIZE=50          # Batch size for log sending (default: 50)
CONSOLE_MCP_BATCH_INTERVAL_MS=100  # Batch interval in milliseconds (default: 100)
CONSOLE_MCP_LOG_TTL_MINUTES=60     # Minutes to retain logs before automatic cleanup (set <= 0 to disable)
```

**Example:**

```bash
# Increase log storage and change port
CONSOLE_MCP_PORT=8080 CONSOLE_MCP_MAX_LOGS=50000 npx console-bridge@latest
```

> Logs older than `CONSOLE_MCP_LOG_TTL_MINUTES` are automatically purged. Set the value to `0` or a negative number if you prefer unlimited retention.

---

## Architecture

console-bridge uses a three-component architecture for efficient real-time log capture and analysis:

```
┌─────────────────────┐          ┌──────────────────────┐          ┌─────────────────┐
│   Browser Tabs      │          │    MCP Server        │          │  AI Assistant   │
│                     │          │                      │          │                 │
│  Console Logs       │─────────▶│  WebSocket :9847     │◀─────────│  MCP Tools      │
│  (Extension)        │  Batched │  • Log Storage       │  stdio   │  (Cursor/etc)   │
│  • Intercept        │          │  • Filter Engine     │          │                 │
│  • Batch            │          │  • Search Engine     │          │                 │
│  • Send             │          │  • Tab Suggester     │          │                 │
└─────────────────────┘          └──────────────────────┘          └─────────────────┘
```

### Packages

| Package | Description | Key Components |
|---------|-------------|----------------|
| **`console-bridge`** | MCP server exposing 7 focused tools + WebSocket server | MCP tools, WebSocket server, log storage, filter/search engines, tab suggester, session manager |
| **`console-bridge-extension`** | Chrome/Edge extension capturing console logs | Content script, console interceptor, WebSocket client, popup UI |
| **`console-bridge-shared`** | Shared TypeScript types and Zod schemas | LogMessage, FilterOptions, SearchOptions, TabInfo types |

### Data Flow

1. **Capture**: Extension content script intercepts `console.log/warn/error/etc` in browser tabs
2. **Batch**: Logs are batched and sent via WebSocket to server (default: 50 logs per 100ms)
3. **Store**: Server stores logs in-memory (max 10,000 by default) with filtering/search indexes
4. **Query**: AI assistant queries logs via MCP tools through stdio transport
5. **Respond**: Server returns structured log data with context (timestamps, stack traces, tab info)

### Performance Characteristics

- **Batching**: Reduces network overhead by 95% compared to per-log transmission
- **In-Memory Storage**: Sub-millisecond query response times
- **Indexed Search**: Regex and keyword search optimized with pre-built indexes
- **Minimal Browser Impact**: <1% CPU overhead in typical usage

---

## Development

### Setup

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run in development mode (auto-rebuild on changes)
npm run dev:server    # Server with hot reload
npm run dev:extension # Extension with hot reload
```

### Testing

```bash
npm test
```

### Linting & Formatting

```bash
npm run lint    # Lint with Biome
npm run format  # Format with Biome
```

### Project Structure

```
console-bridge/
├── packages/
│   ├── server/          # MCP + WebSocket server
│   │   ├── src/
│   │   │   ├── index.ts              # Entry point
│   │   │   ├── mcp-server.ts         # MCP tool definitions
│   │   │   ├── websocket-server.ts   # WebSocket server
│   │   │   ├── log-storage.ts        # In-memory storage
│   │   │   ├── filter-engine.ts      # Log filtering
│   │   │   ├── search-engine.ts      # Regex/keyword search
│   │   │   ├── tab-suggester.ts      # Intelligent tab suggestions
│   │   │   ├── sanitizer.ts          # Data sanitization
│   │   │   ├── export-engine.ts      # Export to JSON/CSV/text
│   │   │   └── session-manager.ts    # Session save/load
│   │   └── package.json
│   ├── extension/       # Chrome extension
│   │   ├── src/
│   │   │   ├── background.ts         # Service worker
│   │   │   ├── content-script.ts     # Page injection
│   │   │   ├── lib/
│   │   │   │   ├── console-interceptor.ts  # Intercept console calls
│   │   │   │   └── websocket-client.ts     # WebSocket client
│   │   │   └── popup/                # Extension UI
│   │   ├── public/
│   │   │   ├── manifest.json
│   │   │   └── popup.html
│   │   └── package.json
│   └── shared/          # Shared types
│       ├── src/
│       │   ├── index.ts
│       │   └── types.ts              # LogMessage, FilterOptions, etc.
│       └── package.json
└── package.json
```

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CLAUDE.md](./CLAUDE.md) for detailed development guidelines.

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Community

### Get Support

- **GitHub Issues**: [Report bugs, request features](https://github.com/vltansky/console-bridge/issues)
- **GitHub Discussions**: [Ask questions, share ideas](https://github.com/vltansky/console-bridge/discussions)
- **Documentation**: See [CLAUDE.md](./CLAUDE.md) for architecture details

### Show Your Support

If console-bridge improves your debugging workflow:

- **Star the repository** on [GitHub](https://github.com/vltansky/console-bridge)
- **Share on social media** with #consolebridge
- **Write about your experience** on your blog
- **Create tutorials** and share with the community
- **Contribute** improvements and bug fixes

---

<div align="center">

**Built with care for developers by developers**

[GitHub](https://github.com/vltansky/console-bridge) • [NPM](https://www.npmjs.com/package/console-bridge)

---

Built with [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

</div>
