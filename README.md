# Console MCP

MCP server for capturing and querying browser console logs with an AI assistant.

## Features

- 🔍 **Real-time Log Capture**: Browser extension captures console logs from all tabs
- 🤖 **AI Integration**: Query logs using natural language through MCP tools
- 🔎 **Advanced Search**: Regex and keyword search with filtering
- 📊 **Session Management**: Save and restore log sessions
- 🔒 **Data Sanitization**: Automatically mask sensitive information
- 📤 **Export**: Export logs in JSON, CSV, or plain text formats

## Architecture

The project consists of three packages:

- **`@console-mcp/server`**: MCP server with WebSocket server for receiving logs
- **`@console-mcp/extension`**: Chrome/Edge browser extension for capturing logs
- **`@console-mcp/shared`**: Shared TypeScript types and schemas

## Installation

### 1. Install the MCP Server

```bash
npm install -g console-mcp
```

Or run directly with npx:

```bash
npx console-mcp
```

### 2. Install the Browser Extension

1. Build the extension:
   ```bash
   npm install
   npm run build
   ```

2. Load in Chrome/Edge:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `packages/extension/dist` directory

### 3. Configure Your AI Assistant

Add to your MCP configuration (e.g., Claude Desktop, Cline, Cursor):

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

## Usage

### Starting the Server

```bash
console-mcp
```

The server will:
- Start WebSocket server on `localhost:3333` (configurable)
- Listen for MCP tool calls via stdio

### Using MCP Tools

Once configured, you can use these tools with your AI assistant:

#### List Logs
```
List all error logs from the last hour
```

#### Search Logs
```
Search for "authentication failed" in console logs
```

#### Get Statistics
```
Show me console log statistics
```

#### Export Logs
```
Export all logs as JSON
```

## MCP Tools Reference

- `console_list_logs` - List logs with filtering and pagination
- `console_get_log` - Get a specific log by ID
- `console_search_logs` - Search logs using regex patterns
- `console_search_keywords` - Search using keyword matching
- `console_tail_logs` - Stream recent logs
- `console_get_tabs` - Get active tab information
- `console_clear_logs` - Clear stored logs
- `console_export_logs` - Export logs in various formats
- `console_save_session` - Save current logs as a session
- `console_load_session` - Load a saved session
- `console_list_sessions` - List all saved sessions
- `console_get_stats` - Get server statistics

## Configuration

Environment variables:

```bash
CONSOLE_MCP_PORT=3333              # WebSocket server port
CONSOLE_MCP_MAX_LOGS=10000         # Maximum logs to store
CONSOLE_MCP_SANITIZE_LOGS=true     # Enable sanitization
CONSOLE_MCP_BATCH_SIZE=50          # Batch size for log sending
CONSOLE_MCP_BATCH_INTERVAL_MS=100  # Batch interval in ms
```

## Development

### Setup

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run in development mode
npm run dev:server    # Server
npm run dev:extension # Extension
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
npm run format
```

## Project Structure

```
console-mcp/
├── packages/
│   ├── server/          # MCP + WebSocket server
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── mcp-server.ts
│   │   │   ├── websocket-server.ts
│   │   │   ├── log-storage.ts
│   │   │   ├── filter-engine.ts
│   │   │   ├── search-engine.ts
│   │   │   ├── sanitizer.ts
│   │   │   ├── export-engine.ts
│   │   │   └── session-manager.ts
│   │   └── package.json
│   ├── extension/       # Chrome extension
│   │   ├── src/
│   │   │   ├── background.ts
│   │   │   ├── content-script.ts
│   │   │   ├── lib/
│   │   │   │   ├── console-interceptor.ts
│   │   │   │   └── websocket-client.ts
│   │   │   └── popup/
│   │   │       └── popup.ts
│   │   ├── public/
│   │   │   ├── manifest.json
│   │   │   ├── popup.html
│   │   │   └── popup.css
│   │   └── package.json
│   └── shared/          # Shared types
│       ├── src/
│       │   ├── index.ts
│       │   └── types.ts
│       └── package.json
├── docs/
├── scripts/
└── package.json
```

## Contributing

Contributions are welcome! Please read our contributing guidelines.

## License

MIT

## Support

- GitHub Issues: [Report a bug](https://github.com/yourusername/console-mcp/issues)
- Documentation: See `/docs` folder

---

Built with [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
