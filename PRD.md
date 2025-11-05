# Product Requirements Document: Browser Console MCP Server

## Overview

A Model Context Protocol (MCP) server that captures browser console logs through a browser extension and provides robust filtering, search, and streaming capabilities to AI coding assistants.

**Key Differentiator**: Extension-based real-time capture with advanced search and filtering capabilities, combining the best of consolespy's architecture with browserloop's filtering features.

## Problem Statement

AI coding assistants need access to browser console logs for debugging web applications, but existing solutions have limitations:
- **Chrome DevTools MCP**: Requires launching new browser instances, can't capture from existing browsing sessions
- **consolespy**: Real-time capture but lacks filtering, search, and regex capabilities
- **browserloop**: Good filtering but uses Playwright, not real-time browsing sessions

**Gap**: No MCP server provides real-time console capture from live browser sessions with comprehensive search/filter/regex capabilities.

## Goals

### Primary Goals
1. Capture console logs from active browser sessions in real-time
2. Provide robust search functionality (regex, keywords, patterns)
3. Support log level filtering and tail mode
4. Enable WebSocket communication for efficient streaming
5. Make logs accessible to AI assistants through MCP protocol

### Secondary Goals
1. Log sanitization for sensitive data
2. Multiple browser tab support
3. Session management and history
4. Export capabilities

## Non-Goals

- Browser automation (clicking, navigation) - use Chrome DevTools MCP instead
- Screenshot capture - use Chrome DevTools MCP instead
- Performance profiling - use Chrome DevTools MCP instead
- Supporting browsers other than Chrome/Chromium (initial version)

## User Stories

### As a Developer using an AI Assistant
- I want to see console logs from my running web app in real-time
- I want to search console logs using regex patterns to find specific errors
- I want to filter logs by level (error, warn, info) to reduce noise
- I want to tail logs continuously as they appear
- I want sensitive data automatically masked in logs

### As a DevOps Engineer
- I want to monitor multiple browser tabs simultaneously
- I want to export filtered logs for bug reports
- I want to search across historical log sessions

## Technical Architecture

### High-Level Architecture

```
┌─────────────────────┐
│  Browser Extension  │
│  (Chrome/Edge)      │
│  - Console capture  │
│  - Tab tracking     │
└──────────┬──────────┘
           │ WebSocket
           │ (bidirectional)
           ▼
┌─────────────────────┐
│   MCP Server        │
│  - WebSocket server │
│  - Log storage      │
│  - Search engine    │
│  - Filter engine    │
└──────────┬──────────┘
           │ stdio/SSE
           │ (MCP protocol)
           ▼
┌─────────────────────┐
│   AI Assistant      │
│  (Cursor/Claude)    │
└─────────────────────┘
```

### Component Breakdown

#### 1. Browser Extension
**Technology**: Chrome Extension Manifest V3
**Responsibilities**:
- Intercept all console messages (log, info, warn, error, debug)
- Capture uncaught errors and promise rejections
- Track browser warnings (Permissions-Policy, CSP, etc.)
- Maintain WebSocket connection to MCP server
- Support multiple tab tracking
- Send logs in real-time

**Key Files**:
- `manifest.json` - Extension configuration
- `background.js` - Service worker for WebSocket management
- `content-script.js` - Injected into pages to capture console
- `popup.html/js` - Extension UI for settings

#### 2. MCP Server
**Technology**: Node.js + TypeScript
**Responsibilities**:
- WebSocket server for extension communication
- MCP protocol server (stdio/SSE) for AI assistants
- Log storage and indexing
- Search and filter engine
- Session management

**Key Components**:
- `websocket-server.ts` - Handles extension connections
- `mcp-server.ts` - MCP protocol implementation
- `log-storage.ts` - In-memory/persistent log storage
- `search-engine.ts` - Regex and keyword search
- `filter-engine.ts` - Log level, time-based filtering
- `sanitizer.ts` - Sensitive data masking

#### 3. Communication Protocol

**Extension → Server (WebSocket)**:
```typescript
interface LogMessage {
  id: string;              // Unique log ID
  timestamp: number;       // Unix timestamp
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;         // Main log message
  args: unknown[];         // Console arguments
  stack?: string;          // Error stack trace
  tabId: number;           // Browser tab ID
  url: string;             // Page URL
  sessionId: string;       // Extension session ID
}

interface TabInfo {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
}

// Extension → Server messages
type ExtensionMessage =
  | { type: 'log', data: LogMessage }
  | { type: 'tab_opened', data: TabInfo }
  | { type: 'tab_closed', data: { tabId: number } }
  | { type: 'heartbeat' };

// Server → Extension messages
type ServerMessage =
  | { type: 'configure', data: { logLevels: string[], sanitize: boolean } }
  | { type: 'ping' };
```

**Server → MCP Client**:
Standard MCP protocol with custom tools (see Tools section)

## Features & Requirements

### Phase 1: Core Functionality (MVP)

#### F1.1: Console Log Capture
**Priority**: P0
**Description**: Capture all console messages from browser tabs

**Requirements**:
- Capture log, info, warn, error, debug levels
- Include timestamps (ms precision)
- Include stack traces for errors
- Capture uncaught errors and promise rejections
- Support multiple tabs simultaneously
- Store tab URL and title with each log

**Technical Approach**:
```javascript
// Intercept console methods
['log', 'info', 'warn', 'error', 'debug'].forEach(level => {
  const original = console[level];
  console[level] = function(...args) {
    // Send to extension background script
    window.postMessage({
      type: 'console_log',
      level,
      args: args.map(serializeArg),
      timestamp: Date.now(),
      stack: new Error().stack
    }, '*');
    return original.apply(console, args);
  };
});
```

#### F1.2: WebSocket Communication
**Priority**: P0
**Description**: Real-time bidirectional communication between extension and server

**Requirements**:
- WebSocket server on configurable port (default: 3333)
- Auto-reconnect with exponential backoff
- Message queuing during disconnection
- Heartbeat/ping-pong for connection health
- Connection status in extension popup

#### F1.3: Basic MCP Tools
**Priority**: P0
**Description**: Essential MCP tools for accessing logs

**Tools**:
1. `console_list_logs` - List all captured logs with pagination
2. `console_get_log` - Get specific log by ID
3. `console_stream_logs` - Stream logs in real-time (tail mode)
4. `console_clear_logs` - Clear all logs

#### F1.4: Log Level Filtering
**Priority**: P0
**Description**: Filter logs by level

**Requirements**:
- Filter by single level: `--level=error`
- Filter by multiple levels: `--levels=error,warn`
- Support in all MCP tools

### Phase 2: Search & Advanced Filtering

#### F2.1: Regex Search
**Priority**: P0
**Description**: Search logs using regex patterns

**Requirements**:
- Case-sensitive and case-insensitive modes
- Search in message text and arguments
- Multiline regex support
- Return matching logs with context

**MCP Tool**:
```typescript
tool: 'console_search_logs'
parameters: {
  pattern: string;          // Regex pattern
  caseSensitive?: boolean;  // Default: false
  fields?: ('message' | 'args' | 'stack')[];  // Where to search
  limit?: number;           // Max results
  contextLines?: number;    // Logs before/after match
}
```

**Example Usage**:
```
Search console logs for pattern "API.*error" case insensitive
Search for /fetch.*failed/i in the last 100 logs
```

#### F2.2: Keyword Search
**Priority**: P1
**Description**: Search logs using multiple keywords (AND/OR logic)

**Requirements**:
- Multiple keywords with AND logic: `keyword1 AND keyword2`
- OR logic: `keyword1 OR keyword2`
- Exclude keywords: `NOT keyword`
- Fuzzy matching option

**MCP Tool**:
```typescript
tool: 'console_search_keywords'
parameters: {
  keywords: string[];       // Keywords to search
  logic?: 'AND' | 'OR';     // Default: AND
  exclude?: string[];       // Keywords to exclude
  fuzzy?: boolean;          // Fuzzy matching
}
```

#### F2.3: Time-Based Filtering
**Priority**: P1
**Description**: Filter logs by time range

**Requirements**:
- Absolute time: `--after=2024-01-01T10:00:00Z`
- Relative time: `--last=5m`, `--last=1h`, `--last=24h`
- Time range: `--from=10:00 --to=11:00`

#### F2.4: URL/Tab Filtering
**Priority**: P1
**Description**: Filter logs by source URL or tab

**Requirements**:
- Filter by exact URL
- Filter by URL pattern (regex)
- Filter by tab ID
- Filter by active tab only

### Phase 3: Advanced Features

#### F3.1: Log Sanitization
**Priority**: P1
**Description**: Automatically mask sensitive data in logs

**Requirements**:
- Mask API keys, tokens, JWT
- Mask email addresses
- Mask credit card numbers
- Mask passwords and secrets
- Mask URLs with credentials
- Configurable patterns
- Option to disable sanitization

**Sanitization Patterns** (inspired by browserloop):
```typescript
const patterns = [
  { pattern: /\b[A-Za-z0-9_-]{20,}\b/g, replacement: '[API_KEY_MASKED]' },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL_MASKED]' },
  { pattern: /\bey[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*\b/g, replacement: '[JWT_TOKEN_MASKED]' },
  { pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_-]+/gi, replacement: '[AUTH_HEADER_MASKED]' },
  { pattern: /\b(?:password|secret|api_?key)\s*[:=]\s*[^\s,}]*/gi, replacement: '$1: [VALUE_MASKED]' }
];
```

#### F3.2: Log Export
**Priority**: P2
**Description**: Export filtered logs to files

**Requirements**:
- Export formats: JSON, CSV, plain text
- Export with filters applied
- Include/exclude fields
- Timestamp formatting options

**MCP Tool**:
```typescript
tool: 'console_export_logs'
parameters: {
  format: 'json' | 'csv' | 'txt';
  filters?: FilterOptions;
  fields?: string[];
  filepath?: string;
}
```

#### F3.3: Session Management
**Priority**: P2
**Description**: Save and restore log sessions

**Requirements**:
- Auto-save sessions
- List saved sessions
- Load session by ID
- Delete sessions
- Session metadata (start time, log count, tabs)

#### F3.4: Real-Time Tail with Filters
**Priority**: P1
**Description**: Stream logs in real-time with filters applied

**Requirements**:
- Apply all filter types to stream
- Configurable buffer size
- Follow mode (auto-scroll to latest)
- Stop/resume streaming

**MCP Tool**:
```typescript
tool: 'console_tail_logs'
parameters: {
  follow?: boolean;         // Continue streaming
  filters?: FilterOptions;  // Apply filters to stream
  bufferSize?: number;      // Max logs to keep in stream
}
```

### Phase 4: Polish & UX

#### F4.1: Extension UI
**Priority**: P2
**Description**: User-friendly extension popup

**Features**:
- Connection status indicator
- Active tabs list with log counts
- Quick settings (log levels, sanitization)
- Clear logs button
- Extension enable/disable toggle

#### F4.2: Performance Optimization
**Priority**: P1
**Description**: Handle high-volume logs efficiently

**Requirements**:
- Log buffer with max size (default: 10,000 logs)
- Circular buffer (oldest logs dropped when full)
- Configurable retention: `--max-logs=50000`
- Log size limits per message
- Batch sending from extension (reduce WebSocket overhead)

#### F4.3: Error Handling & Resilience
**Priority**: P1
**Description**: Robust error handling

**Requirements**:
- WebSocket auto-reconnect with backoff
- Extension recovery after browser restart
- MCP server graceful shutdown
- Corrupted message handling
- Network failure recovery

## MCP Tools Reference

### Core Tools

#### `console_list_logs`
List captured console logs with pagination and filtering.

**Parameters**:
```typescript
{
  levels?: ('log' | 'info' | 'warn' | 'error' | 'debug')[];
  tabId?: number;
  url?: string;
  urlPattern?: string;      // Regex pattern
  after?: string;           // ISO timestamp or relative (5m, 1h)
  before?: string;
  limit?: number;           // Default: 100
  offset?: number;          // Pagination
  sortBy?: 'timestamp' | 'level';
  sortOrder?: 'asc' | 'desc';
}
```

**Returns**:
```typescript
{
  logs: LogMessage[];
  total: number;
  hasMore: boolean;
}
```

#### `console_search_logs`
Search logs using regex pattern.

**Parameters**:
```typescript
{
  pattern: string;          // Regex pattern
  caseSensitive?: boolean;
  fields?: ('message' | 'args' | 'stack')[];
  contextLines?: number;    // Logs before/after (default: 0)
  limit?: number;
}
```

**Returns**:
```typescript
{
  matches: Array<{
    log: LogMessage;
    matchedField: string;
    matchedText: string;
    context?: {
      before: LogMessage[];
      after: LogMessage[];
    };
  }>;
  total: number;
}
```

#### `console_tail_logs`
Stream logs in real-time (tail mode).

**Parameters**:
```typescript
{
  follow?: boolean;         // Continue streaming (default: true)
  filters?: {
    levels?: string[];
    pattern?: string;
    tabId?: number;
  };
  bufferSize?: number;      // Max logs in stream (default: 1000)
}
```

**Returns**: Streaming response with logs

#### `console_get_tabs`
List all tracked browser tabs.

**Returns**:
```typescript
{
  tabs: Array<{
    tabId: number;
    url: string;
    title: string;
    active: boolean;
    logCount: number;
    lastLogTimestamp?: number;
  }>;
}
```

#### `console_clear_logs`
Clear all or filtered logs.

**Parameters**:
```typescript
{
  tabId?: number;           // Clear logs from specific tab
  before?: string;          // Clear logs before timestamp
}
```

#### `console_export_logs`
Export logs to file.

**Parameters**:
```typescript
{
  format: 'json' | 'csv' | 'txt';
  filters?: FilterOptions;
  filepath?: string;        // If not provided, returns content
}
```

## Configuration

### Server Configuration

**Environment Variables**:
```bash
# Server settings
CONSOLE_MCP_PORT=3333                    # WebSocket port
CONSOLE_MCP_HOST=localhost               # WebSocket host
CONSOLE_MCP_MAX_LOGS=10000              # Max logs in memory
CONSOLE_MCP_LOG_RETENTION_HOURS=24      # Auto-delete old logs

# Feature flags
CONSOLE_MCP_SANITIZE_LOGS=true          # Enable sanitization
CONSOLE_MCP_ENABLE_EXPORT=true          # Enable export
CONSOLE_MCP_ENABLE_SESSIONS=true        # Enable session management

# Performance
CONSOLE_MCP_BATCH_SIZE=50               # Extension batch size
CONSOLE_MCP_BATCH_INTERVAL_MS=100       # Extension batch interval
```

**MCP Configuration** (Cursor/Claude):
```json
{
  "mcpServers": {
    "console-mcp": {
      "command": "npx",
      "args": ["-y", "console-mcp@latest"],
      "env": {
        "CONSOLE_MCP_PORT": "3333",
        "CONSOLE_MCP_SANITIZE_LOGS": "true"
      }
    }
  }
}
```

### Extension Configuration

**Extension Settings** (stored in chrome.storage):
```typescript
interface ExtensionSettings {
  serverUrl: string;              // Default: ws://localhost:3333
  logLevels: string[];            // Default: all levels
  sanitize: boolean;              // Default: true
  maxBufferSize: number;          // Default: 1000
  batchSize: number;              // Default: 50
  batchInterval: number;          // Default: 100ms
  enabledTabs: 'all' | 'active';  // Default: all
}
```

## Technical Stack

### Server
- **Runtime**: Node.js 20+ (LTS)
- **Language**: TypeScript 5.x
- **WebSocket**: `ws` library
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Testing**: Vitest
- **Build**: tsup
- **Linting**: Biome

### Extension
- **Manifest**: V3
- **Language**: TypeScript (compiled to JS)
- **Build**: esbuild or Vite
- **UI Framework**: Vanilla JS or React (TBD)

## Security Considerations

1. **WebSocket Security**:
   - localhost-only by default
   - Optional authentication token
   - Rate limiting to prevent abuse

2. **Data Sanitization**:
   - Enabled by default
   - Configurable patterns
   - Cannot be bypassed by extension

3. **Extension Permissions**:
   - Minimal permissions (activeTab, storage)
   - No host permissions unless required
   - Clear permission explanations

4. **Data Storage**:
   - Logs stored in memory by default
   - No persistent storage without explicit user consent
   - Clear data on server restart (configurable)

## Success Metrics

### Phase 1 (MVP)
- [ ] Extension can capture and send logs via WebSocket
- [ ] MCP server receives and stores logs
- [ ] AI assistant can list and filter logs
- [ ] Real-time tail mode works
- [ ] Works with 1000+ logs without performance degradation

### Phase 2 (Search)
- [ ] Regex search works with complex patterns
- [ ] Search returns results in <100ms for 10k logs
- [ ] Keyword search supports AND/OR logic
- [ ] Time-based filtering is accurate

### Phase 3 (Advanced)
- [ ] Sanitization masks all common sensitive patterns
- [ ] Export works for all formats
- [ ] Session management stores/restores correctly

## Project Structure

```
console-mcp/
├── packages/
│   ├── server/                 # MCP Server
│   │   ├── src/
│   │   │   ├── websocket-server.ts
│   │   │   ├── mcp-server.ts
│   │   │   ├── log-storage.ts
│   │   │   ├── search-engine.ts
│   │   │   ├── filter-engine.ts
│   │   │   ├── sanitizer.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   └── package.json
│   │
│   └── extension/              # Chrome Extension
│       ├── src/
│       │   ├── background.ts   # Service worker
│       │   ├── content-script.ts
│       │   ├── popup/
│       │   │   ├── popup.html
│       │   │   ├── popup.ts
│       │   │   └── popup.css
│       │   ├── lib/
│       │   │   ├── websocket-client.ts
│       │   │   ├── console-interceptor.ts
│       │   │   └── message-queue.ts
│       │   └── types.ts
│       ├── public/
│       │   ├── manifest.json
│       │   └── icons/
│       └── package.json
│
├── docs/
│   ├── SETUP.md                # Installation guide
│   ├── API.md                  # MCP tools reference
│   ├── ARCHITECTURE.md         # Technical architecture
│   └── EXAMPLES.md             # Usage examples
│
├── scripts/
│   ├── build.sh
│   └── release.sh
│
├── PRD.md                      # This file
├── README.md
├── package.json                # Root package.json
└── tsconfig.json
```

## References & Prior Art

### Existing Solutions Analyzed

1. **Chrome DevTools MCP** (https://github.com/ChromeDevTools/chrome-devtools-mcp)
   - ⭐ 13,899 stars - Official, most popular
   - **Architecture**: Puppeteer-based, launches new browser instances
   - **Console Tools**: `list_console_messages`, `get_console_message`
   - **Strengths**: Production-ready, comprehensive browser automation, WebSocket support
   - **Limitations**: Cannot capture from existing browsing sessions
   - **Takeaways**: Use as reference for MCP tool design, production quality standards

2. **consolespy** (https://github.com/mgsrevolver/consolespy)
   - ⭐ 12 stars - Browser extension approach
   - **Architecture**: Extension → HTTP POST → Server → SSE → MCP
   - **Strengths**: Real-time capture from active browsing, simple architecture
   - **Limitations**: No filtering, no search, no regex, HTTP-based (not WebSocket)
   - **Takeaways**:
     - Extension architecture pattern (background.js + content-script.js)
     - SSE for streaming logs to MCP client
     - Session management approach

3. **browserloop** (https://github.com/mattiasw/browserloop) - ⚠️ ARCHIVED
   - ⭐ 23 stars - Playwright-based (recommended Chrome DevTools MCP instead)
   - **Architecture**: Playwright + Chrome DevTools Protocol (CDP)
   - **Console Features**:
     - Log level filtering: `BROWSERLOOP_CONSOLE_LOG_LEVELS="warn,error"`
     - Sanitization: Masks API keys, JWT, emails, passwords
     - Log size limits, timeout configuration
   - **Strengths**: Best filtering/sanitization implementation
   - **Limitations**: Playwright-based (not extension), archived
   - **Takeaways**:
     - Sanitization patterns (console-service.ts:570-600)
     - Log level filtering implementation
     - CDP integration for browser-level console capture
     - Configuration approach for log collection

4. **figma-console-mcp** (https://github.com/southleft/figma-console-mcp)
   - ⭐ 28 stars - Figma plugin debugging
   - **Specialized**: Not general-purpose
   - **Takeaways**: Real-time monitoring approach for specific platforms

### Architecture Decision: Extension vs Playwright

**Why Extension-Based?**
- ✅ Capture from real browsing sessions (user requirement #1)
- ✅ Real-time streaming as logs occur
- ✅ No browser restart needed
- ✅ Works with existing Chrome profiles
- ✅ Lower resource overhead

**Why Not Playwright?**
- ❌ Requires launching new browser instances
- ❌ Cannot capture from developer's active browsing
- ❌ Higher resource usage
- ❌ Not suitable for real-time debugging during development

**Hybrid Approach Considered**:
Future enhancement: Support both extension and Playwright modes for different use cases.

### Key Implementation References

1. **Extension Console Capture** (from consolespy):
   - File: `extension/console-capture.js`
   - Pattern: Intercept console methods, send via postMessage
   - Session tracking, tab management

2. **Log Sanitization** (from browserloop):
   - File: `src/console-service.ts:570-600`
   - Regex patterns for masking sensitive data
   - Configurable sanitization rules

3. **MCP Protocol** (from Chrome DevTools MCP):
   - Tool design patterns
   - Parameter validation
   - Error handling

4. **WebSocket Communication**:
   - Extension background script maintains persistent connection
   - Heartbeat/ping-pong for health checks
   - Auto-reconnect with exponential backoff

## Timeline

### Phase 1: MVP (2-3 weeks)
- Week 1: Browser extension + WebSocket server
- Week 2: MCP server + basic tools
- Week 3: Testing, debugging, documentation

### Phase 2: Search (1-2 weeks)
- Week 4: Regex search + keyword search
- Week 5: Time/URL filtering, optimization

### Phase 3: Advanced Features (2-3 weeks)
- Week 6: Sanitization
- Week 7: Export + session management
- Week 8: Polish, performance, testing

### Phase 4: Release (1 week)
- Week 9: Documentation, Chrome Web Store submission, npm publish

**Total Estimated Timeline**: 9-10 weeks

## Open Questions

1. Should we support persistent log storage (database) or memory-only?
   - **Recommendation**: Memory-only for MVP, optional persistence in Phase 3

2. Should extension auto-start WebSocket connection or wait for user action?
   - **Recommendation**: Auto-start with option to disable

3. Maximum log retention - file size or time-based?
   - **Recommendation**: Both - 10k logs OR 24 hours, whichever comes first

4. Should we support Firefox extension?
   - **Recommendation**: Post-MVP - focus on Chrome/Edge first

5. Pricing model for Chrome Web Store?
   - **Recommendation**: Free and open-source

## Success Criteria

**MVP is successful when**:
- AI assistant can retrieve real-time console logs from user's browser
- Search with regex works reliably
- Performance remains good with 10k+ logs
- Extension is stable and doesn't crash browser

**Product is successful when**:
- 100+ active users
- Featured in MCP registry
- Positive community feedback
- Adoption by at least 2 AI assistants (Cursor, Claude Code)

---

**Version**: 1.0
**Last Updated**: 2025-01-05
**Status**: Draft
**Owner**: TBD
