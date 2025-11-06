<div align="center">

# Console MCP

**Real-time Browser Console Logs for AI Assistants**

A Model Context Protocol (MCP) server that captures browser console logs in real-time and provides AI assistants with powerful tools to query, search, and analyze debugging information.

[![NPM Version](https://img.shields.io/npm/v/console-mcp)](https://www.npmjs.com/package/console-mcp)
[![License](https://img.shields.io/npm/l/console-mcp)](./LICENSE)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-MCP_Server-blue)](https://modelcontextprotocol.io)

</div>

---

## Table of Contents

- [Why Console MCP?](#why-console-mcp)
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
- [Contributing](#contributing)
- [License](#license)

---

## Why Console MCP?

### ❌ Without Console MCP

When debugging with AI assistants, you have to:

- Manually copy-paste console logs from browser DevTools
- Switch between browser and editor constantly
- Lose context when console clears or page reloads
- Struggle to describe complex error patterns

### ✅ With Console MCP

Console MCP automatically captures all browser console logs and lets AI assistants:

- **Query logs in real-time** - Ask "Show me all authentication errors from the last 5 minutes"
- **Search with natural language** - "Find network timeout errors on the checkout page"
- **Analyze patterns** - Get statistics, filter by severity, group by tab/URL
- **Debug faster** - AI sees the exact errors without manual copy-paste

**Example:**

```txt
Show me all error logs from the last 10 minutes on localhost:3000
```

Console MCP fetches matching logs instantly, with full stack traces, timestamps, and tab context.

---

## Features

- 🔍 **Real-time Log Capture**: Browser extension captures console logs from all tabs
- 🤖 **AI Integration**: Query logs using natural language through 12 MCP tools
- 🔎 **Advanced Search**: Regex and keyword search with filtering by level, URL, time
- 📊 **Session Management**: Save and restore log sessions for debugging
- 🔒 **Data Sanitization**: Automatically mask sensitive information (tokens, keys)
- 📤 **Export**: Export logs in JSON, CSV, or plain text formats
- ⚡ **Lightweight**: Batched WebSocket protocol, minimal performance impact
- 🎯 **Tab Awareness**: Filter logs by specific tabs, URLs, or sessions

---

## Installation

### Prerequisites

- **Node.js** >= 18.0.0
- **Chrome or Edge** browser
- **MCP Client** (Cursor, Claude Code, VS Code, Windsurf, etc.)

### Quick Start

**1. Install the MCP Server**

```bash
npx console-mcp@latest
```

**2. Install Browser Extension**

```bash
# Clone and build
git clone https://github.com/vltansky/console-mcp.git
cd console-mcp
npm install
npm run build

# Load extension in Chrome/Edge:
# 1. Open chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select packages/extension/dist
```

**3. Configure Your Client**

See [Client-Specific Setup](#client-specific-setup) below for your preferred tool.

---

### Client-Specific Setup

<details>
<summary><b>Cursor</b></summary>

#### One-Click Install

[<img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Install in Cursor">](https://cursor.com/en/install-mcp?name=console-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNvbnNvbGUtbWNwQGxhdGVzdCJdfQ%3D%3D)

#### Manual Install

Go to `Cursor Settings` → `MCP` → `Add new global MCP server`

```json
{
  "mcpServers": {
    "console-mcp": {
      "command": "npx",
      "args": ["-y", "console-mcp@latest"]
    }
  }
}
```

</details>

<details>
<summary><b>Claude Code</b></summary>

Use the Claude Code CLI:

```bash
claude mcp add console-mcp npx -y console-mcp@latest
```

Or manually edit `~/.claude/config.json`:

```json
{
  "mcpServers": {
    "console-mcp": {
      "command": "npx",
      "args": ["-y", "console-mcp@latest"]
    }
  }
}
```

</details>

<details>
<summary><b>VS Code / VS Code Insiders</b></summary>

[<img src="https://img.shields.io/badge/Install%20in%20VS%20Code-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Install in VS Code">](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22console-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22console-mcp%40latest%22%5D%7D)

Or add to `settings.json`:

```json
{
  "mcp.servers": {
    "console-mcp": {
      "command": "npx",
      "args": ["-y", "console-mcp@latest"]
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
    "console-mcp": {
      "command": "npx",
      "args": ["-y", "console-mcp@latest"]
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
    "console-mcp": {
      "command": "npx",
      "args": ["-y", "console-mcp@latest"]
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

---

## MCP Tools Reference

Console MCP provides 12 tools for comprehensive log management:

### Query & Filter
- **`console_list_logs`** - List logs with filtering by level, tab, URL, time range
- **`console_get_log`** - Get a specific log entry by ID
- **`console_tail_logs`** - Stream the most recent logs (live feed)
- **`console_get_tabs`** - Get active browser tabs with log counts

### Search
- **`console_search_logs`** - Search using regex patterns
- **`console_search_keywords`** - Search using keyword matching (AND/OR logic)

### Analytics
- **`console_get_stats`** - Get statistics (log counts by level, tab, time distribution)

### Management
- **`console_clear_logs`** - Clear stored logs from memory
- **`console_export_logs`** - Export logs in JSON, CSV, or text format

### Sessions
- **`console_save_session`** - Save current logs as a named session
- **`console_load_session`** - Load a previously saved session
- **`console_list_sessions`** - List all saved sessions

---

## Configuration

Environment variables for the server:

```bash
CONSOLE_MCP_PORT=3333              # WebSocket server port (default: 3333)
CONSOLE_MCP_MAX_LOGS=10000         # Maximum logs to store in memory (default: 10000)
CONSOLE_MCP_SANITIZE_LOGS=true     # Enable automatic data sanitization (default: true)
CONSOLE_MCP_BATCH_SIZE=50          # Batch size for log sending (default: 50)
CONSOLE_MCP_BATCH_INTERVAL_MS=100  # Batch interval in milliseconds (default: 100)
```

**Example:**

```bash
# Increase log storage and change port
CONSOLE_MCP_PORT=8080 CONSOLE_MCP_MAX_LOGS=50000 npx console-mcp@latest
```

---

## Architecture

Console MCP uses a three-component architecture:

```
┌─────────────────┐          ┌──────────────────┐          ┌─────────────────┐
│  Browser Tabs   │          │   MCP Server     │          │  AI Assistant   │
│                 │          │                  │          │                 │
│  Console Logs   │─────────▶│  WebSocket :3333 │◀─────────│  MCP Tools      │
│  (Extension)    │  Batched │  Log Storage     │  stdio   │  (Cursor/etc)   │
│                 │          │  Filter Engine   │          │                 │
└─────────────────┘          └──────────────────┘          └─────────────────┘
```

### Packages

- **`@console-mcp/server`**: MCP server exposing 12 tools + WebSocket server
- **`@console-mcp/extension`**: Chrome/Edge extension capturing console logs
- **`@console-mcp/shared`**: Shared TypeScript types and Zod schemas

### Data Flow

1. Extension content script intercepts `console.log/warn/error/etc` in browser tabs
2. Logs are batched and sent via WebSocket to server (default: 50 logs per 100ms)
3. Server stores logs in-memory (max 10,000 by default) with filtering/search indexes
4. AI assistant queries logs via MCP tools through stdio transport
5. Server returns structured log data with context (timestamps, stack traces, tab info)

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
console-mcp/
├── packages/
│   ├── server/          # MCP + WebSocket server
│   │   ├── src/
│   │   │   ├── index.ts              # Entry point
│   │   │   ├── mcp-server.ts         # MCP tool definitions
│   │   │   ├── websocket-server.ts   # WebSocket server
│   │   │   ├── log-storage.ts        # In-memory storage
│   │   │   ├── filter-engine.ts      # Log filtering
│   │   │   ├── search-engine.ts      # Regex/keyword search
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

## Support

- **Issues**: [GitHub Issues](https://github.com/vltansky/console-mcp/issues)
- **Documentation**: See [CLAUDE.md](./CLAUDE.md) for architecture details

---

Built with [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
