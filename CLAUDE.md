# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Console MCP is an MCP (Model Context Protocol) server that captures browser console logs in real-time via a browser extension and provides AI assistants with tools to query, search, and analyze these logs. The system consists of three packages in a monorepo:

- **`@console-mcp/server`**: MCP server with WebSocket server for receiving logs from browser extension
- **`@console-mcp/extension`**: Chrome/Edge browser extension that captures console logs
- **`@console-mcp/shared`**: Shared TypeScript types and Zod schemas

## Architecture

### Server Architecture (`packages/server/src/`)

The server follows a modular architecture with specialized engines:

- **`index.ts`**: Entry point that initializes LogStorage, ConsoleWebSocketServer, and McpServer
- **`mcp-server.ts`**: Core MCP server implementation exposing 12 tools for log querying
- **`websocket-server.ts`**: WebSocket server (port 3333) receiving log batches from extension
- **`log-storage.ts`**: In-memory log storage with filtering and pagination
- **`filter-engine.ts`**: Filters logs by level, tab, URL pattern, time range, session
- **`search-engine.ts`**: Regex and keyword search with context lines
- **`sanitizer.ts`**: Data sanitization to mask sensitive information
- **`export-engine.ts`**: Exports logs to JSON, CSV, or plain text
- **`session-manager.ts`**: Saves and restores log sessions

### Extension Architecture (`packages/extension/src/`)

- **`background.ts`**: Service worker managing WebSocket connection and extension state
- **`content-script.ts`**: Injected into pages to intercept console calls
- **`lib/console-interceptor.ts`**: Intercepts console.log/warn/error/etc and captures logs
- **`lib/websocket-client.ts`**: Batched WebSocket client sending logs to server
- **`popup/`**: Extension popup UI for configuration

### Data Flow

1. Extension content script intercepts console calls in browser tabs
2. Logs are batched and sent via WebSocket to server (default: 50 logs per 100ms)
3. Server stores logs in-memory (max 10,000 by default)
4. MCP tools query/search logs via stdio transport
5. AI assistant receives structured log data

## Development Commands

### Build & Run

```bash
# Install dependencies (run from root)
npm install

# Build all packages
npm run build

# Run server in development mode (auto-rebuild on changes)
npm run dev:server

# Run extension in development mode (auto-rebuild on changes)
npm run dev:extension

# Start production server
npm run start -w @console-mcp/server
```

### Testing & Linting

```bash
# Run tests (Vitest)
npm test

# Lint with Biome
npm run lint

# Format code with Biome
npm run format
```

### Extension Development

After running `npm run build` or `npm run dev:extension`:
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `packages/extension/dist` directory

## Configuration

Server configuration via environment variables:

- `CONSOLE_MCP_PORT=3333` - WebSocket server port
- `CONSOLE_MCP_MAX_LOGS=10000` - Maximum logs to store in memory
- `CONSOLE_MCP_SANITIZE_LOGS=true` - Enable/disable sanitization
- `CONSOLE_MCP_BATCH_SIZE=50` - Batch size for log sending
- `CONSOLE_MCP_BATCH_INTERVAL_MS=100` - Batch interval in milliseconds

## Code Standards

### Tooling
- **Biome** for linting and formatting (not ESLint/Prettier)
- **TypeScript** strict mode enabled
- **Zod** for runtime validation of WebSocket messages

### Style
- Single quotes for strings
- Trailing commas
- 2-space indentation
- 100 character line width
- `noExplicitAny` disabled (explicit any allowed)

### Type Safety
- Shared types in `@console-mcp/shared` imported by both server and extension
- Zod schemas for WebSocket protocol validation
- All log messages conform to `LogMessage` interface
- Extension/Server messages use discriminated unions

## Important Patterns

### WebSocket Protocol
Messages between extension and server follow typed protocols:
- **Extension → Server**: `ExtensionMessage` (log, tab_opened, tab_closed, heartbeat)
- **Server → Extension**: `ServerMessage` (configure, ping)

All messages validated with Zod schemas at runtime.

### Log Storage & Filtering
`LogStorage.getAll(filter?)` returns logs matching optional `FilterOptions`:
- `levels`: Array of log levels to include
- `tabId`: Filter by specific tab
- `urlPattern`: Regex pattern matching URL
- `after`/`before`: Time range (ISO timestamp or relative like "5m", "1h")
- `sessionId`: Filter by session

### MCP Tools
All 12 MCP tools are defined in `mcp-server.ts`:
- Tools accept JSON arguments validated against input schemas
- Tools return text content (usually JSON stringified)
- Error handling returns `isError: true` with error message

## Testing Strategy

Tests use Vitest. When adding features:
1. Add unit tests for new engines/utilities
2. Test WebSocket message validation with invalid payloads
3. Test filter logic edge cases (empty results, time parsing, regex)
4. Test MCP tool error handling

## Package Dependencies

- **Server**: `@modelcontextprotocol/sdk`, `ws`, `zod`
- **Extension**: `@types/chrome`, `vite` (for build)
- **Shared**: `zod`
- **Dev**: `biome`, `vitest`, `typescript`, `tsup`

## Build System

- **Server**: Built with `tsup` → outputs to `dist/` with `index.js` as entry point
- **Extension**: Built with `vite` → outputs to `dist/` with manifest.json
- **Shared**: Built with `tsc` → outputs to `dist/` with type declarations

## Common Workflows

### Adding a New MCP Tool
1. Add tool definition to `ListToolsRequestSchema` handler in `mcp-server.ts`
2. Add case to `CallToolRequestSchema` switch statement
3. Implement handler method (e.g., `handleNewTool()`)
4. Update README.md with tool documentation

### Adding Log Metadata
1. Update `LogMessage` interface in `packages/shared/src/types.ts`
2. Update `LogMessageSchema` Zod validator
3. Update console interceptor to capture new metadata
4. Update filter/search logic if needed

### Modifying WebSocket Protocol
1. Update message types in `packages/shared/src/types.ts`
2. Update Zod schemas for validation
3. Update sender in extension or receiver in server
4. Ensure backward compatibility if deployed
