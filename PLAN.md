# Console MCP Implementation Plan

Based on PRD.md analysis and research of:
- MCP TypeScript SDK (modelcontextprotocol/typescript-sdk)
- WebSocket reconnection patterns (jjxxs/websocket-ts)
- Chrome extension frameworks (extension.js, crxjs)

──────────────────────────────────────────────────────────────

## Phase 1: Project Foundation (Week 1)

### 1.1 Initialize Monorepo Structure

```bash
console-mcp/
├── packages/
│   ├── server/           # MCP + WebSocket server
│   ├── extension/        # Chrome extension
│   └── shared/           # Shared types
├── docs/
├── scripts/
└── package.json
```

**Actions:**
- [ ] Create monorepo with npm/pnpm workspaces
- [ ] Set up TypeScript 5.x with strict mode
- [ ] Configure tsup for server bundling
- [ ] Configure esbuild/vite for extension bundling
- [ ] Add Biome for linting/formatting
- [ ] Set up Vitest for testing

**Dependencies:**
```json
{
  "server": ["@modelcontextprotocol/sdk", "ws", "zod"],
  "extension": ["@types/chrome"],
  "dev": ["typescript", "tsup", "vitest", "@biomejs/biome"]
}
```

──────────────────────────────────────────────────────────────

### 1.2 Define Shared Types

**File:** `packages/shared/types.ts`

```typescript
// Log message structure
interface LogMessage {
  id: string;
  timestamp: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  args: unknown[];
  stack?: string;
  tabId: number;
  url: string;
  sessionId: string;
}

// WebSocket protocol
type ExtensionMessage =
  | { type: 'log'; data: LogMessage }
  | { type: 'tab_opened'; data: TabInfo }
  | { type: 'tab_updated'; data: TabInfo }
  | { type: 'tab_closed'; data: { tabId: number } }
  | { type: 'heartbeat' };

type ServerMessage =
  | { type: 'configure'; data: { logLevels: string[]; sanitize: boolean } }
  | { type: 'ping' };
```

**Actions:**
- [ ] Create shared types package
- [ ] Define LogMessage interface per PRD line 123-133
- [ ] Define WebSocket message types per PRD line 142-152
- [ ] Export FilterOptions type
- [ ] Add Zod schemas for runtime validation

──────────────────────────────────────────────────────────────

## Phase 2: Browser Extension (Week 1-2)

### 2.1 Create Extension Manifest

**File:** `packages/extension/public/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Console MCP Capture",
  "version": "0.1.0",
  "permissions": ["activeTab", "storage", "tabs"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content-script.js"],
    "run_at": "document_start",
    "all_frames": true
  }]
}
```

**Actions:**
- [ ] Create Manifest V3 configuration
- [ ] Request minimal permissions (activeTab, storage, tabs)
- [ ] Configure service worker for background script
- [ ] Set up content script injection at document_start

──────────────────────────────────────────────────────────────

### 2.2 Build Console Interceptor

**File:** `packages/extension/src/lib/console-interceptor.ts`

**Pattern from PRD lines 175-191:**

```typescript
const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;

export function interceptConsole(onLog: (data: LogMessage) => void) {
  levels.forEach(level => {
    const original = console[level];
    console[level] = function(...args) {
      onLog({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        level,
        message: args[0]?.toString() || '',
        args: args.map(serializeArg),
        stack: new Error().stack,
        tabId: getTabId(),
        url: window.location.href,
        sessionId: getSessionId()
      });
      return original.apply(console, args);
    };
  });
}
```

**Actions:**
- [ ] Implement console method interception
- [ ] Add argument serialization (handle objects, errors, DOM)
- [ ] Capture stack traces for errors
- [ ] Intercept unhandled errors (`window.onerror`)
- [ ] Intercept unhandled promise rejections (`unhandledrejection`)
- [ ] Add CSP/Permissions-Policy warning capture

──────────────────────────────────────────────────────────────

### 2.3 Build WebSocket Client with Reconnection

**File:** `packages/extension/src/lib/websocket-client.ts`

**Based on jjxxs/websocket-ts pattern:**

```typescript
export class WebSocketClient {
  private ws?: WebSocket;
  private reconnectAttempts = 0;
  private messageQueue: ExtensionMessage[] = [];

  constructor(private url: string) {}

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.flushQueue();
    };
    this.ws.onclose = () => this.reconnect();
    this.ws.onerror = () => this.reconnect();
  }

  private reconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    setTimeout(() => this.connect(), delay);
    this.reconnectAttempts++;
  }

  send(message: ExtensionMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }
}
```

**Actions:**
- [ ] Implement WebSocket client class
- [ ] Add exponential backoff reconnection (PRD line 199)
- [ ] Implement message queuing during disconnection
- [ ] Add heartbeat/ping-pong (every 30s)
- [ ] Track connection status
- [ ] Implement batch sending (50 msgs / 100ms per PRD line 545)

──────────────────────────────────────────────────────────────

### 2.4 Create Background Service Worker

**File:** `packages/extension/src/background.ts`

```typescript
import { WebSocketClient } from './lib/websocket-client';

const wsClient = new WebSocketClient('ws://localhost:9847');
const tabLogs = new Map<number, number>(); // tabId -> log count

chrome.runtime.onInstalled.addListener(() => {
  wsClient.connect();
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'console_log' && sender.tab?.id) {
    wsClient.send({
      type: 'log',
      data: {
        ...message.data,
        tabId: sender.tab.id
      }
    });
    tabLogs.set(sender.tab.id, (tabLogs.get(sender.tab.id) || 0) + 1);
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  wsClient.send({ type: 'tab_closed', data: { tabId } });
  tabLogs.delete(tabId);
});
```

**Actions:**
- [ ] Initialize WebSocket on extension install
- [ ] Listen for messages from content scripts
- [ ] Forward logs to WebSocket server
- [ ] Track tab lifecycle (opened/closed)
- [ ] Maintain tab log counts
- [ ] Load settings from chrome.storage

──────────────────────────────────────────────────────────────

### 2.5 Create Content Script

**File:** `packages/extension/src/content-script.ts`

```typescript
import { interceptConsole } from './lib/console-interceptor';

interceptConsole((logData) => {
  chrome.runtime.sendMessage({
    type: 'console_log',
    data: logData
  });
});
```

**Actions:**
- [ ] Inject console interceptor on page load
- [ ] Send captured logs to background script via chrome.runtime
- [ ] Handle script injection timing (document_start)

──────────────────────────────────────────────────────────────

### 2.6 Build Extension Popup UI

**File:** `packages/extension/src/popup/popup.html`

**Features per PRD lines 376-383:**

```html
<div>
  <div class="status">
    <span id="connection-status">●</span>
    <span>Connected</span>
  </div>
  <div class="tabs-list" id="tabs"></div>
  <div class="settings">
    <label><input type="checkbox" id="sanitize" checked> Sanitize logs</label>
    <button id="clear">Clear logs</button>
  </div>
</div>
```

**Actions:**
- [ ] Create popup HTML/CSS
- [ ] Show connection status indicator
- [ ] Display active tabs with log counts
- [ ] Add quick settings (log levels, sanitization)
- [ ] Add clear logs button
- [ ] Add enable/disable toggle

──────────────────────────────────────────────────────────────

## Phase 3: MCP Server Core (Week 2-3)

### 3.1 Build WebSocket Server

**File:** `packages/server/src/websocket-server.ts`

```typescript
import { WebSocketServer } from 'ws';

export class ConsoleWebSocketServer {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(port: number = 9847) {
    this.wss = new WebSocketServer({ port, host: 'localhost' });
    this.wss.on('connection', this.handleConnection);
  }

  private handleConnection = (ws: WebSocket) => {
    this.clients.add(ws);

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ExtensionMessage;
      this.handleMessage(message);
    });

    ws.on('close', () => this.clients.delete(ws));
  };

  private handleMessage(message: ExtensionMessage) {
    switch (message.type) {
      case 'log': this.storage.add(message.data); break;
      case 'tab_opened': this.tabs.add(message.data); break;
      case 'tab_closed': this.tabs.remove(message.data.tabId); break;
    }
  }
}
```

**Actions:**
- [ ] Create WebSocket server on port 9847
- [ ] Listen on localhost only (security)
- [ ] Handle client connections/disconnections
- [ ] Parse and validate incoming messages
- [ ] Forward logs to storage
- [ ] Implement ping-pong heartbeat
- [ ] Add connection health monitoring

──────────────────────────────────────────────────────────────

### 3.2 Implement Log Storage

**File:** `packages/server/src/log-storage.ts`

```typescript
export class LogStorage {
  private logs: LogMessage[] = [];
  private readonly maxLogs: number = 10000;

  add(log: LogMessage) {
    this.logs.push(log);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Circular buffer
    }
  }

  getAll(filter?: FilterOptions): LogMessage[] {
    return this.filter(this.logs, filter);
  }

  clear(filter?: { tabId?: number; before?: string }) {
    if (!filter) {
      this.logs = [];
      return;
    }
    this.logs = this.logs.filter(log => {
      if (filter.tabId && log.tabId !== filter.tabId) return true;
      if (filter.before && log.timestamp >= new Date(filter.before).getTime()) return true;
      return false;
    });
  }
}
```

**Actions:**
- [ ] Create in-memory log storage (circular buffer)
- [ ] Implement max size limit (10k default, PRD line 389)
- [ ] Add FIFO eviction when full
- [ ] Implement getAll with filtering
- [ ] Add clear by tabId/timestamp
- [ ] Track total log count
- [ ] Index logs by tabId for performance

──────────────────────────────────────────────────────────────

### 3.3 Build Filter Engine

**File:** `packages/server/src/filter-engine.ts`

```typescript
export class FilterEngine {
  filter(logs: LogMessage[], options: FilterOptions): LogMessage[] {
    let filtered = logs;

    // Level filter
    if (options.levels?.length) {
      filtered = filtered.filter(log => options.levels!.includes(log.level));
    }

    // Time filter
    if (options.after) {
      const after = this.parseTime(options.after);
      filtered = filtered.filter(log => log.timestamp >= after);
    }

    // URL filter
    if (options.urlPattern) {
      const regex = new RegExp(options.urlPattern);
      filtered = filtered.filter(log => regex.test(log.url));
    }

    // Tab filter
    if (options.tabId) {
      filtered = filtered.filter(log => log.tabId === options.tabId);
    }

    return filtered;
  }

  private parseTime(time: string): number {
    // Handle "5m", "1h", "24h", ISO timestamps
    if (/^\d+[mh]$/.test(time)) {
      const value = parseInt(time);
      const unit = time.slice(-1);
      const multiplier = unit === 'h' ? 3600000 : 60000;
      return Date.now() - (value * multiplier);
    }
    return new Date(time).getTime();
  }
}
```

**Actions:**
- [ ] Implement log level filtering (PRD line 219)
- [ ] Add time-based filtering (absolute + relative, PRD line 278)
- [ ] Add URL/tab filtering (PRD line 288)
- [ ] Support multiple filter combinations (AND logic)
- [ ] Optimize for large log sets

──────────────────────────────────────────────────────────────

### 3.4 Create MCP Server

**File:** `packages/server/src/mcp-server.ts`

**Based on modelcontextprotocol/typescript-sdk:**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'console-mcp',
  version: '0.1.0'
});

// Register tools
server.registerTool(
  'console_list_logs',
  {
    description: 'List captured console logs with pagination and filtering',
    inputSchema: {
      type: 'object',
      properties: {
        levels: { type: 'array', items: { type: 'string' } },
        tabId: { type: 'number' },
        limit: { type: 'number', default: 100 },
        offset: { type: 'number', default: 0 }
      }
    }
  },
  async (params) => {
    const logs = storage.getAll({
      levels: params.levels,
      tabId: params.tabId
    });
    const paginated = logs.slice(params.offset, params.offset + params.limit);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          logs: paginated,
          total: logs.length,
          hasMore: logs.length > (params.offset + params.limit)
        }, null, 2)
      }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Actions:**
- [ ] Initialize MCP server with SDK
- [ ] Set up stdio transport
- [ ] Register `console_list_logs` tool (PRD line 410)
- [ ] Register `console_get_log` tool
- [ ] Register `console_stream_logs` tool (PRD line 468)
- [ ] Register `console_get_tabs` tool (PRD line 486)
- [ ] Register `console_clear_logs` tool (PRD line 503)
- [ ] Implement pagination logic
- [ ] Add error handling and validation

──────────────────────────────────────────────────────────────

### 3.5 Build Main Entry Point

**File:** `packages/server/src/index.ts`

```typescript
import { ConsoleWebSocketServer } from './websocket-server';
import { startMcpServer } from './mcp-server';
import { LogStorage } from './log-storage';

const storage = new LogStorage({
  maxLogs: parseInt(process.env.CONSOLE_MCP_MAX_LOGS || '10000')
});

const wsServer = new ConsoleWebSocketServer(
  parseInt(process.env.CONSOLE_MCP_PORT || '9847'),
  storage
);

await startMcpServer(storage);
```

**Actions:**
- [ ] Start WebSocket server
- [ ] Start MCP server
- [ ] Load configuration from env vars (PRD line 531)
- [ ] Handle graceful shutdown
- [ ] Add startup logging

──────────────────────────────────────────────────────────────

## Phase 4: Search Engine (Week 3-4)

### 4.1 Implement Regex Search

**File:** `packages/server/src/search-engine.ts`

```typescript
export class SearchEngine {
  search(logs: LogMessage[], params: SearchParams): SearchResult {
    const regex = new RegExp(
      params.pattern,
      params.caseSensitive ? 'g' : 'gi'
    );

    const matches: SearchMatch[] = [];

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const fields = params.fields || ['message', 'args', 'stack'];

      for (const field of fields) {
        const text = this.getFieldText(log, field);
        if (regex.test(text)) {
          matches.push({
            log,
            matchedField: field,
            matchedText: text.match(regex)?.[0] || '',
            context: this.getContext(logs, i, params.contextLines || 0)
          });
          if (matches.length >= (params.limit || 100)) {
            return { matches, total: matches.length };
          }
        }
      }
    }

    return { matches, total: matches.length };
  }

  private getContext(logs: LogMessage[], index: number, lines: number) {
    if (lines === 0) return undefined;
    return {
      before: logs.slice(Math.max(0, index - lines), index),
      after: logs.slice(index + 1, index + 1 + lines)
    };
  }
}
```

**Actions:**
- [ ] Implement regex pattern matching (PRD line 227)
- [ ] Support case-sensitive/insensitive modes
- [ ] Search across message, args, stack fields
- [ ] Add context lines (before/after, PRD line 243)
- [ ] Implement result limiting
- [ ] Handle multiline regex (PRD line 232)

──────────────────────────────────────────────────────────────

### 4.2 Add Keyword Search

**File:** `packages/server/src/search-engine.ts` (extend)

```typescript
searchKeywords(logs: LogMessage[], params: KeywordSearchParams): SearchResult {
  return logs.filter(log => {
    const text = `${log.message} ${JSON.stringify(log.args)}`.toLowerCase();

    const matches = params.keywords.map(kw =>
      text.includes(kw.toLowerCase())
    );

    if (params.logic === 'OR') {
      return matches.some(m => m);
    }

    const hasAllRequired = matches.every(m => m);
    const hasExcluded = params.exclude?.some(ex =>
      text.includes(ex.toLowerCase())
    );

    return hasAllRequired && !hasExcluded;
  });
}
```

**Actions:**
- [ ] Implement AND logic for keywords (PRD line 258)
- [ ] Implement OR logic
- [ ] Add exclude keywords support (PRD line 260)
- [ ] Consider fuzzy matching option
- [ ] Optimize for performance

──────────────────────────────────────────────────────────────

### 4.3 Register Search MCP Tools

**File:** `packages/server/src/mcp-server.ts` (extend)

**Actions:**
- [ ] Register `console_search_logs` tool (PRD line 437)
- [ ] Register `console_search_keywords` tool
- [ ] Implement search result formatting
- [ ] Add context display in results
- [ ] Test search performance (<100ms for 10k logs, PRD line 629)

──────────────────────────────────────────────────────────────

## Phase 5: Advanced Features (Week 5-6)

### 5.1 Build Sanitizer

**File:** `packages/server/src/sanitizer.ts`

**Based on browserloop patterns (PRD lines 308-317):**

```typescript
export class Sanitizer {
  private patterns = [
    { pattern: /\b[A-Za-z0-9_-]{20,}\b/g, replacement: '[API_KEY_MASKED]' },
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL_MASKED]' },
    { pattern: /\bey[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*\b/g, replacement: '[JWT_MASKED]' },
    { pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_-]+/gi, replacement: '[AUTH_MASKED]' },
    { pattern: /\b(?:password|secret|api_?key)\s*[:=]\s*[^\s,}]*/gi, replacement: '$1: [MASKED]' },
    { pattern: /\b\d{13,16}\b/g, replacement: '[CC_MASKED]' } // Credit cards
  ];

  sanitize(log: LogMessage): LogMessage {
    let message = log.message;
    let args = JSON.stringify(log.args);

    for (const { pattern, replacement } of this.patterns) {
      message = message.replace(pattern, replacement);
      args = args.replace(pattern, replacement);
    }

    return {
      ...log,
      message,
      args: JSON.parse(args)
    };
  }
}
```

**Actions:**
- [ ] Implement API key masking
- [ ] Add JWT token masking
- [ ] Add email masking
- [ ] Add password/secret masking
- [ ] Add credit card masking
- [ ] Add URL credential masking
- [ ] Make patterns configurable
- [ ] Add enable/disable option (PRD line 539)

──────────────────────────────────────────────────────────────

### 5.2 Implement Tail/Streaming

**File:** `packages/server/src/log-storage.ts` (extend)

```typescript
export class LogStorage {
  private subscribers = new Set<(log: LogMessage) => void>();

  subscribe(callback: (log: LogMessage) => void, filter?: FilterOptions) {
    const wrappedCallback = (log: LogMessage) => {
      if (!filter || this.matchesFilter(log, filter)) {
        callback(log);
      }
    };
    this.subscribers.add(wrappedCallback);
    return () => this.subscribers.delete(wrappedCallback);
  }

  add(log: LogMessage) {
    // ... existing code ...
    this.subscribers.forEach(cb => cb(log));
  }
}
```

**File:** `packages/server/src/mcp-server.ts` (extend)

**Actions:**
- [ ] Implement log subscription system
- [ ] Add `console_tail_logs` tool with streaming (PRD line 468)
- [ ] Apply filters to stream (PRD line 364)
- [ ] Implement buffer size limiting (PRD line 367)
- [ ] Add follow mode (auto-scroll)
- [ ] Handle stream stop/resume

──────────────────────────────────────────────────────────────

### 5.3 Add Export Functionality

**File:** `packages/server/src/export-engine.ts`

```typescript
export class ExportEngine {
  export(logs: LogMessage[], format: 'json' | 'csv' | 'txt'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(logs, null, 2);

      case 'csv':
        const header = 'timestamp,level,message,url\n';
        const rows = logs.map(log =>
          `${log.timestamp},${log.level},"${log.message}","${log.url}"`
        ).join('\n');
        return header + rows;

      case 'txt':
        return logs.map(log =>
          `[${new Date(log.timestamp).toISOString()}] ${log.level.toUpperCase()}: ${log.message}`
        ).join('\n');
    }
  }
}
```

**Actions:**
- [ ] Implement JSON export
- [ ] Implement CSV export
- [ ] Implement plain text export
- [ ] Add field selection
- [ ] Add timestamp formatting options
- [ ] Register `console_export_logs` tool (PRD line 515)

──────────────────────────────────────────────────────────────

### 5.4 Session Management

**File:** `packages/server/src/session-manager.ts`

```typescript
export class SessionManager {
  private sessions = new Map<string, Session>();

  save(logs: LogMessage[]): string {
    const sessionId = crypto.randomUUID();
    const session: Session = {
      id: sessionId,
      startTime: logs[0]?.timestamp || Date.now(),
      endTime: logs[logs.length - 1]?.timestamp || Date.now(),
      logCount: logs.length,
      tabs: [...new Set(logs.map(l => l.tabId))],
      logs
    };
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  load(sessionId: string): LogMessage[] | null {
    return this.sessions.get(sessionId)?.logs || null;
  }
}
```

**Actions:**
- [ ] Implement session save/load
- [ ] Add session metadata (PRD line 349)
- [ ] Add list sessions functionality
- [ ] Add delete sessions
- [ ] Consider optional persistence to disk

──────────────────────────────────────────────────────────────

## Phase 6: Testing (Week 7)

### 6.1 Unit Tests

**Actions:**
- [ ] Test console interceptor with various argument types
- [ ] Test WebSocket reconnection logic
- [ ] Test log storage circular buffer
- [ ] Test filter engine with all filter types
- [ ] Test search engine (regex + keywords)
- [ ] Test sanitizer patterns
- [ ] Test export formats

──────────────────────────────────────────────────────────────

### 6.2 Integration Tests

**Actions:**
- [ ] Test extension → WebSocket → storage flow
- [ ] Test MCP tool responses
- [ ] Test tail/streaming functionality
- [ ] Test with 10,000+ logs (performance, PRD line 625)
- [ ] Test WebSocket disconnection/reconnection
- [ ] Test concurrent tab tracking

──────────────────────────────────────────────────────────────

### 6.3 Extension Testing

**Actions:**
- [ ] Test in Chrome/Chromium
- [ ] Test in Edge
- [ ] Test console capture accuracy
- [ ] Test popup UI functionality
- [ ] Test settings persistence
- [ ] Test with various web apps

──────────────────────────────────────────────────────────────

## Phase 7: Documentation (Week 8)

### 7.1 User Documentation

**Files:**
```
docs/
├── SETUP.md          # Installation & configuration
├── API.md            # MCP tools reference
├── ARCHITECTURE.md   # Technical details
└── EXAMPLES.md       # Usage examples
```

**Actions:**
- [ ] Write installation guide
- [ ] Document all MCP tools with examples
- [ ] Create architecture diagrams
- [ ] Add troubleshooting guide
- [ ] Document configuration options (PRD lines 528-576)

──────────────────────────────────────────────────────────────

### 7.2 Code Documentation

**Actions:**
- [ ] Add TSDoc comments to public APIs
- [ ] Document WebSocket protocol
- [ ] Add inline comments for complex logic
- [ ] Create CONTRIBUTING.md
- [ ] Add security documentation

──────────────────────────────────────────────────────────────

### 7.3 README

**Actions:**
- [ ] Write compelling README with screenshots
- [ ] Add quick start guide
- [ ] List features and roadmap
- [ ] Add badge links (npm, license, stars)
- [ ] Include MCP configuration example (PRD line 549)

──────────────────────────────────────────────────────────────

## Phase 8: Release (Week 9)

### 8.1 Package Configuration

**Actions:**
- [ ] Configure npm package publishing
- [ ] Add package.json metadata (keywords, license)
- [ ] Create release scripts
- [ ] Set up semantic versioning
- [ ] Add bundling for distribution

──────────────────────────────────────────────────────────────

### 8.2 Chrome Web Store

**Actions:**
- [ ] Create extension assets (icons, screenshots)
- [ ] Write store description
- [ ] Submit for review
- [ ] Address review feedback

──────────────────────────────────────────────────────────────

### 8.3 MCP Registry

**Actions:**
- [ ] Submit to MCP registry
- [ ] Add to awesome-mcp-servers
- [ ] Create demo video
- [ ] Write blog post/announcement

──────────────────────────────────────────────────────────────

## Success Metrics Checklist

**MVP Success Criteria (PRD lines 620-625):**
- [ ] Extension captures and sends logs via WebSocket
- [ ] MCP server receives and stores logs
- [ ] AI assistant can list and filter logs
- [ ] Real-time tail mode works
- [ ] Handles 1000+ logs without degradation

**Search Success Criteria (PRD lines 627-631):**
- [ ] Regex search with complex patterns
- [ ] Search <100ms for 10k logs
- [ ] Keyword AND/OR logic works
- [ ] Time-based filtering accurate

**Advanced Features (PRD lines 633-636):**
- [ ] Sanitization masks sensitive patterns
- [ ] Export works for all formats
- [ ] Session management functional

──────────────────────────────────────────────────────────────

## Configuration Summary

**Environment Variables:**
```bash
CONSOLE_MCP_PORT=9847
CONSOLE_MCP_MAX_LOGS=10000
CONSOLE_MCP_SANITIZE_LOGS=true
CONSOLE_MCP_BATCH_SIZE=50
CONSOLE_MCP_BATCH_INTERVAL_MS=100
```

**MCP Configuration (Claude Code/Cursor):**
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

──────────────────────────────────────────────────────────────

## Key Technical Decisions

1. **WebSocket over HTTP**: Bidirectional, lower latency for real-time streaming
2. **Circular buffer**: Memory-efficient, prevents unbounded growth
3. **Extension-based**: Captures real browsing sessions (vs Playwright)
4. **In-memory storage**: Fast, MVP-appropriate (optional persistence later)
5. **TypeScript**: Type safety, better DX
6. **Monorepo**: Shared types, coordinated releases

──────────────────────────────────────────────────────────────

## Timeline Summary

| Week | Phase | Deliverable |
|------|-------|-------------|
| 1 | Foundation + Extension | Working extension capturing logs |
| 2-3 | MCP Server Core | Basic MCP tools functional |
| 3-4 | Search Engine | Regex + keyword search working |
| 5-6 | Advanced Features | Sanitization, export, sessions |
| 7 | Testing | Comprehensive test coverage |
| 8 | Documentation | Complete docs |
| 9 | Release | Published to npm + Chrome Store |

**Total: 9 weeks**

──────────────────────────────────────────────────────────────

*Powered by Octocode MCP ⭐🐙 [GitHub](https://github.com/bgauryy/octocode-mcp)*
