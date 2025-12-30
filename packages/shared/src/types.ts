import { z } from 'zod';

export const CONSOLE_MCP_IDENTIFIER = 'console-logs-mcp';

// Log levels
export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

// Log message structure
export interface LogMessage {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  args: unknown[];
  stack?: string;
  tabId: number;
  url: string;
  sessionId: string;
}

// Tab information
export interface TabInfo {
  id: number;
  url: string;
  title: string;
  sessionId: string;
  isActive: boolean;
  lastNavigationAt: number;
}

// WebSocket protocol - Extension to Server
export type ExtensionMessage =
  | { type: 'log'; data: LogMessage }
  | { type: 'tab_opened'; data: TabInfo }
  | { type: 'tab_updated'; data: TabInfo }
  | { type: 'tab_closed'; data: { tabId: number } }
  | { type: 'heartbeat'; data: { timestamp: number } };

// WebSocket protocol - Server to Extension
export type ServerMessage =
  | { type: 'configure'; data: { logLevels: LogLevel[]; sanitize: boolean } }
  | { type: 'ping'; data: { timestamp: number } }
  | { type: 'execute_js'; data: { requestId: string; code: string; tabId?: number } }
  | { type: 'get_page_info'; data: { requestId: string; tabId?: number; includeHtml?: boolean } }
  | { type: 'query_dom'; data: { requestId: string; selector: string; tabId?: number; properties?: string[] } };

// Browser command responses
export type BrowserCommandResponse =
  | { type: 'execute_js_response'; data: { requestId: string; result?: unknown; error?: string } }
  | { type: 'page_info_response'; data: { requestId: string; title: string; url: string; html?: string; error?: string } }
  | { type: 'query_dom_response'; data: { requestId: string; elements: Array<{ selector: string; properties: Record<string, unknown> }>; error?: string } };

// Filter options for querying logs
export interface FilterOptions {
  levels?: LogLevel[];
  tabId?: number;
  urlPattern?: string;
  after?: string; // ISO timestamp or relative time (e.g., "5m", "1h")
  before?: string;
  sessionId?: string;
}

export interface DiscoveryPayload {
  identifier: string;
  serverId?: string;
  wsHost: string;
  wsPort: number;
  wsUrl: string;
  timestamp: number;
}

// Search parameters
export interface SearchParams {
  pattern: string;
  caseSensitive?: boolean;
  fields?: Array<'message' | 'args' | 'stack'>;
  contextLines?: number;
  limit?: number;
}

export interface KeywordSearchParams {
  keywords: string[];
  logic?: 'AND' | 'OR';
  exclude?: string[];
  limit?: number;
}

// Search result
export interface SearchMatch {
  log: LogMessage;
  matchedField: string;
  matchedText: string;
  context?: {
    before: LogMessage[];
    after: LogMessage[];
  };
}

export interface SearchResult {
  matches: SearchMatch[];
  total: number;
}

// Session information
export interface Session {
  id: string;
  name?: string; // Optional human-readable name
  description?: string; // Optional description
  startTime: number;
  endTime: number;
  logCount: number;
  tabs: number[];
  logs: LogMessage[];
  created: number; // Timestamp when session was created
}

// Zod schemas for runtime validation
export const LogLevelSchema = z.enum(['log', 'info', 'warn', 'error', 'debug']);

export const LogMessageSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  level: LogLevelSchema,
  message: z.string(),
  args: z.array(z.unknown()),
  stack: z.string().optional(),
  tabId: z.number(),
  url: z.string(),
  sessionId: z.string(),
});

export const TabInfoSchema = z.object({
  id: z.number(),
  url: z.string(),
  title: z.string(),
  sessionId: z.string(),
  isActive: z.boolean(),
  lastNavigationAt: z.number(),
});

export const ExtensionMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('log'),
    data: LogMessageSchema,
  }),
  z.object({
    type: z.literal('tab_opened'),
    data: TabInfoSchema,
  }),
  z.object({
    type: z.literal('tab_updated'),
    data: TabInfoSchema,
  }),
  z.object({
    type: z.literal('tab_closed'),
    data: z.object({ tabId: z.number() }),
  }),
  z.object({
    type: z.literal('heartbeat'),
    data: z.object({ timestamp: z.number() }),
  }),
]);

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('configure'),
    data: z.object({
      logLevels: z.array(LogLevelSchema),
      sanitize: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('ping'),
    data: z.object({ timestamp: z.number() }),
  }),
  z.object({
    type: z.literal('execute_js'),
    data: z.object({
      requestId: z.string(),
      code: z.string(),
      tabId: z.number().optional(),
    }),
  }),
  z.object({
    type: z.literal('get_page_info'),
    data: z.object({
      requestId: z.string(),
      tabId: z.number().optional(),
      includeHtml: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal('query_dom'),
    data: z.object({
      requestId: z.string(),
      selector: z.string(),
      tabId: z.number().optional(),
      properties: z.array(z.string()).optional(),
    }),
  }),
]);

export const BrowserCommandResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('execute_js_response'),
    data: z.object({
      requestId: z.string(),
      result: z.unknown().optional(),
      error: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('page_info_response'),
    data: z.object({
      requestId: z.string(),
      title: z.string(),
      url: z.string(),
      html: z.string().optional(),
      error: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('query_dom_response'),
    data: z.object({
      requestId: z.string(),
      elements: z.array(
        z.object({
          selector: z.string(),
          properties: z.record(z.unknown()),
        }),
      ),
      error: z.string().optional(),
    }),
  }),
]);

export const FilterOptionsSchema = z.object({
  levels: z.array(LogLevelSchema).optional(),
  tabId: z.number().optional(),
  urlPattern: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  sessionId: z.string().optional(),
});
