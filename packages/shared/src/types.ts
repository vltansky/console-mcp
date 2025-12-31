import { z } from 'zod';

export const CONSOLE_MCP_IDENTIFIER = 'console-bridge';

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

// Network performance entry
export type InitiatorType =
  | 'fetch'
  | 'xmlhttprequest'
  | 'script'
  | 'link'
  | 'css'
  | 'img'
  | 'image'
  | 'font'
  | 'audio'
  | 'video'
  | 'beacon'
  | 'other';

export interface NetworkEntry {
  id: string;
  timestamp: number;
  tabId: number;
  sessionId: string;
  url: string; // resource URL
  pageUrl: string; // page that loaded it

  // Timing (all in ms)
  duration: number;
  dnsTime?: number;
  connectionTime?: number;
  tlsTime?: number;
  ttfb?: number; // time to first byte (server response time)
  downloadTime?: number;
  stallTime?: number; // queue/stall time

  // Resource info
  initiatorType: InitiatorType;
  status?: number; // HTTP status code
  size?: number; // encoded body size in bytes
  decodedSize?: number; // decoded body size
  headerSize?: number;
  protocol?: string; // h2, http/1.1, etc.
  cached?: boolean;

  // Flags
  isError: boolean; // status >= 400 or responseStatus === 0
  isBlocking?: boolean; // render blocking
}

// Network filter options
export interface NetworkFilterOptions {
  tabId?: number;
  urlPattern?: string;
  initiatorTypes?: InitiatorType[];
  minDuration?: number;
  maxDuration?: number;
  isError?: boolean;
  after?: string;
  before?: string;
  sessionId?: string;
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
  | { type: 'network_entry'; data: NetworkEntry }
  | { type: 'tab_opened'; data: TabInfo }
  | { type: 'tab_updated'; data: TabInfo }
  | { type: 'tab_closed'; data: { tabId: number } }
  | { type: 'heartbeat'; data: { timestamp: number } }
  | { type: 'inject_marker'; data: { tabId: number; marker: string } };

// WebSocket protocol - Server to Extension
export type ServerMessage =
  | { type: 'configure'; data: { logLevels: LogLevel[]; sanitize: boolean } }
  | { type: 'ping'; data: { timestamp: number } }
  | { type: 'execute_js'; data: { requestId: string; code: string; tabId?: number } }
  | { type: 'get_page_info'; data: { requestId: string; tabId?: number; includeHtml?: boolean } }
  | {
      type: 'query_dom';
      data: { requestId: string; selector: string; tabId?: number; properties?: string[] };
    }
  | { type: 'get_dom_snapshot'; data: { requestId: string; tabId?: number } };

// DOM snapshot node
export interface DomSnapshotNode {
  role: string;
  name?: string;
  value?: string;
  description?: string;
  properties?: Record<string, unknown>;
  children?: DomSnapshotNode[];
}

// Browser command responses
export type BrowserCommandResponse =
  | { type: 'execute_js_response'; data: { requestId: string; result?: unknown; error?: string } }
  | {
      type: 'page_info_response';
      data: { requestId: string; title: string; url: string; html?: string; error?: string };
    }
  | {
      type: 'query_dom_response';
      data: {
        requestId: string;
        elements: Array<{ selector: string; properties: Record<string, unknown> }>;
        error?: string;
      };
    }
  | {
      type: 'dom_snapshot_response';
      data: { requestId: string; snapshot?: DomSnapshotNode; error?: string };
    };

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

// Zod schemas for runtime validation
export const LogLevelSchema = z.enum(['log', 'info', 'warn', 'error', 'debug']);

export const InitiatorTypeSchema = z.enum([
  'fetch',
  'xmlhttprequest',
  'script',
  'link',
  'css',
  'img',
  'image',
  'font',
  'audio',
  'video',
  'beacon',
  'other',
]);

export const NetworkEntrySchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  tabId: z.number(),
  sessionId: z.string(),
  url: z.string(),
  pageUrl: z.string(),
  duration: z.number(),
  dnsTime: z.number().optional(),
  connectionTime: z.number().optional(),
  tlsTime: z.number().optional(),
  ttfb: z.number().optional(),
  downloadTime: z.number().optional(),
  stallTime: z.number().optional(),
  initiatorType: InitiatorTypeSchema,
  status: z.number().optional(),
  size: z.number().optional(),
  decodedSize: z.number().optional(),
  headerSize: z.number().optional(),
  protocol: z.string().optional(),
  cached: z.boolean().optional(),
  isError: z.boolean(),
  isBlocking: z.boolean().optional(),
});

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
    type: z.literal('network_entry'),
    data: NetworkEntrySchema,
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
  z.object({
    type: z.literal('inject_marker'),
    data: z.object({ tabId: z.number(), marker: z.string() }),
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
  z.object({
    type: z.literal('get_dom_snapshot'),
    data: z.object({
      requestId: z.string(),
      tabId: z.number().optional(),
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
  z.object({
    type: z.literal('dom_snapshot_response'),
    data: z.object({
      requestId: z.string(),
      snapshot: z
        .object({
          role: z.string(),
          name: z.string().optional(),
          value: z.string().optional(),
          description: z.string().optional(),
          properties: z.record(z.unknown()).optional(),
          children: z.lazy(() => z.array(z.any())).optional(),
        })
        .optional(),
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
