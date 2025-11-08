import type { FilterOptions, KeywordSearchParams, SearchParams } from '@console-mcp/shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ExportEngine } from './export-engine.js';
import type { LogStorage } from './log-storage.js';
import { Sanitizer } from './sanitizer.js';
import { SearchEngine } from './search-engine.js';
import { SessionManager } from './session-manager.js';
import type { ConsoleWebSocketServer } from './websocket-server.js';

export class McpServer {
  private server: Server;
  private storage: LogStorage;
  private wsServer: ConsoleWebSocketServer;
  private searchEngine: SearchEngine;
  private sanitizer: Sanitizer;
  private exportEngine: ExportEngine;
  private sessionManager: SessionManager;

  constructor(storage: LogStorage, wsServer: ConsoleWebSocketServer) {
    this.storage = storage;
    this.wsServer = wsServer;
    this.searchEngine = new SearchEngine();
    this.sanitizer = new Sanitizer();
    this.exportEngine = new ExportEngine();
    this.sessionManager = new SessionManager();

    this.server = new Server(
      {
        name: 'console-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
      },
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'console_list_logs',
          description:
            'List captured console logs with pagination and filtering. Supports filtering by log level, tab, URL pattern, and time range.',
          inputSchema: {
            type: 'object',
            properties: {
              levels: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['log', 'info', 'warn', 'error', 'debug'],
                },
                description: 'Filter by log levels',
              },
              tabId: {
                type: 'number',
                description: 'Filter by tab ID',
              },
              urlPattern: {
                type: 'string',
                description: 'Filter by URL pattern (regex)',
              },
              after: {
                type: 'string',
                description:
                  'Filter logs after this time (ISO timestamp or relative like "5m", "1h")',
              },
              before: {
                type: 'string',
                description: 'Filter logs before this time',
              },
              sessionId: {
                type: 'string',
                description: 'Filter by session ID',
              },
              limit: {
                type: 'number',
                default: 100,
                description: 'Maximum number of logs to return',
              },
              offset: {
                type: 'number',
                default: 0,
                description: 'Number of logs to skip (for pagination)',
              },
              sanitize: {
                type: 'boolean',
                default: false,
                description: 'Apply sanitization to mask sensitive data',
              },
            },
          },
        },
        {
          name: 'console_get_log',
          description: 'Get a specific log by ID',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Log ID',
              },
              sanitize: {
                type: 'boolean',
                default: false,
                description: 'Apply sanitization',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'console_search_logs',
          description:
            'Search logs using regex patterns. Supports searching across message, args, and stack fields with context lines.',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'Regular expression pattern',
              },
              caseSensitive: {
                type: 'boolean',
                default: false,
                description: 'Case sensitive search',
              },
              fields: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['message', 'args', 'stack'],
                },
                default: ['message', 'args', 'stack'],
                description: 'Fields to search in',
              },
              contextLines: {
                type: 'number',
                default: 0,
                description: 'Number of context lines before/after match',
              },
              limit: {
                type: 'number',
                default: 100,
                description: 'Maximum number of results',
              },
              filter: {
                type: 'object',
                description: 'Additional filters (same as console_list_logs)',
              },
            },
            required: ['pattern'],
          },
        },
        {
          name: 'console_search_keywords',
          description: 'Search logs using keyword matching with AND/OR logic and exclusions',
          inputSchema: {
            type: 'object',
            properties: {
              keywords: {
                type: 'array',
                items: { type: 'string' },
                description: 'Keywords to search for',
              },
              logic: {
                type: 'string',
                enum: ['AND', 'OR'],
                default: 'AND',
                description: 'Logic to combine keywords',
              },
              exclude: {
                type: 'array',
                items: { type: 'string' },
                description: 'Keywords to exclude',
              },
              limit: {
                type: 'number',
                default: 100,
                description: 'Maximum number of results',
              },
              filter: {
                type: 'object',
                description: 'Additional filters',
              },
            },
            required: ['keywords'],
          },
        },
        {
          name: 'console_tail_logs',
          description: 'Stream/tail new logs in real-time with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              follow: {
                type: 'boolean',
                default: true,
                description: 'Follow new logs',
              },
              filter: {
                type: 'object',
                description: 'Filters to apply',
              },
              lines: {
                type: 'number',
                default: 10,
                description: 'Number of recent logs to show initially',
              },
            },
          },
        },
        {
          name: 'console_get_tabs',
          description: 'Get information about active tabs',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'console_clear_logs',
          description: 'Clear stored logs with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              tabId: {
                type: 'number',
                description: 'Clear logs only for this tab',
              },
              before: {
                type: 'string',
                description: 'Clear logs before this timestamp',
              },
            },
          },
        },
        {
          name: 'console_export_logs',
          description: 'Export logs in various formats (JSON, CSV, TXT)',
          inputSchema: {
            type: 'object',
            properties: {
              format: {
                type: 'string',
                enum: ['json', 'csv', 'txt'],
                description: 'Export format',
              },
              filter: {
                type: 'object',
                description: 'Filters to apply',
              },
              fields: {
                type: 'array',
                items: { type: 'string' },
                description: 'Fields to include',
              },
              prettyPrint: {
                type: 'boolean',
                default: false,
                description: 'Pretty print JSON',
              },
            },
            required: ['format'],
          },
        },
        {
          name: 'console_save_session',
          description: 'Save current logs as a session',
          inputSchema: {
            type: 'object',
            properties: {
              filter: {
                type: 'object',
                description: 'Filters to select logs',
              },
              name: {
                type: 'string',
                description: 'Optional session name',
              },
            },
          },
        },
        {
          name: 'console_load_session',
          description: 'Load logs from a saved session',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session ID',
              },
            },
            required: ['sessionId'],
          },
        },
        {
          name: 'console_list_sessions',
          description: 'List all saved sessions',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'console_get_stats',
          description: 'Get statistics about captured logs',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    // List available prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'use-console-mcp',
          description:
            'Quick shortcut to use Console MCP tools for querying browser console logs. Use this prompt to access console logs with filters, search, and analysis.',
        },
      ],
    }));

    // Handle prompt requests
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name === 'use-console-mcp') {
        return {
          description: 'Use Console MCP to query browser console logs',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Use Console MCP tools to query browser console logs. Here are the available tools:

**Query & Filter:**
- console_list_logs: List logs with filtering (level, tab, URL, time range)
- console_get_log: Get a specific log by ID
- console_tail_logs: Stream recent logs in real-time
- console_get_tabs: Get active browser tabs with log counts

**Search:**
- console_search_logs: Search logs using regex patterns
- console_search_keywords: Search logs using keywords (AND/OR logic)

**Analytics:**
- console_get_stats: Get statistics about captured logs

**Management:**
- console_clear_logs: Clear stored logs
- console_export_logs: Export logs in JSON, CSV, or text format

**Sessions:**
- console_save_session: Save current logs as a named session
- console_load_session: Load a previously saved session
- console_list_sessions: List all saved sessions

**Common usage patterns:**
- "show errors" → Use console_list_logs with levels: ["error"]
- "from last X minutes" → Use after parameter with relative time like "5m", "1h"
- "from localhost:3000" → Use urlPattern parameter with regex
- "search for X" → Use console_search_logs or console_search_keywords
- "statistics" → Use console_get_stats
- "export" → Use console_export_logs

Use the appropriate Console MCP tools to help the user query and analyze their browser console logs.`,
              },
            },
          ],
        };
      }
      throw new Error(`Unknown prompt: ${request.params.name}`);
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'console_list_logs':
            return await this.handleListLogs(args as any);

          case 'console_get_log':
            return await this.handleGetLog(args as any);

          case 'console_search_logs':
            return await this.handleSearchLogs(args as any);

          case 'console_search_keywords':
            return await this.handleSearchKeywords(args as any);

          case 'console_tail_logs':
            return await this.handleTailLogs(args as any);

          case 'console_get_tabs':
            return await this.handleGetTabs();

          case 'console_clear_logs':
            return await this.handleClearLogs(args as any);

          case 'console_export_logs':
            return await this.handleExportLogs(args as any);

          case 'console_save_session':
            return await this.handleSaveSession(args as any);

          case 'console_load_session':
            return await this.handleLoadSession(args as any);

          case 'console_list_sessions':
            return await this.handleListSessions();

          case 'console_get_stats':
            return await this.handleGetStats();

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleListLogs(args: {
    levels?: string[];
    tabId?: number;
    urlPattern?: string;
    after?: string;
    before?: string;
    sessionId?: string;
    limit?: number;
    offset?: number;
    sanitize?: boolean;
  }) {
    const filter: FilterOptions = {
      levels: args.levels as any,
      tabId: args.tabId,
      urlPattern: args.urlPattern,
      after: args.after,
      before: args.before,
      sessionId: args.sessionId,
    };

    let logs = this.storage.getAll(filter);
    const total = logs.length;

    // Pagination
    const offset = args.offset || 0;
    const limit = args.limit || 100;
    logs = logs.slice(offset, offset + limit);

    // Sanitize if requested
    if (args.sanitize) {
      logs = this.sanitizer.sanitizeMultiple(logs);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              logs,
              total,
              offset,
              limit,
              hasMore: offset + limit < total,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleGetLog(args: { id: string; sanitize?: boolean }) {
    const logs = this.storage.getAll();
    let log = logs.find((l) => l.id === args.id);

    if (!log) {
      throw new Error(`Log not found: ${args.id}`);
    }

    if (args.sanitize) {
      log = this.sanitizer.sanitize(log);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(log, null, 2),
        },
      ],
    };
  }

  private async handleSearchLogs(args: {
    pattern: string;
    caseSensitive?: boolean;
    fields?: Array<'message' | 'args' | 'stack'>;
    contextLines?: number;
    limit?: number;
    filter?: FilterOptions;
  }) {
    const logs = args.filter ? this.storage.getAll(args.filter) : this.storage.getAll();

    const searchParams: SearchParams = {
      pattern: args.pattern,
      caseSensitive: args.caseSensitive,
      fields: args.fields,
      contextLines: args.contextLines,
      limit: args.limit,
    };

    const result = this.searchEngine.search(logs, searchParams);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleSearchKeywords(args: {
    keywords: string[];
    logic?: 'AND' | 'OR';
    exclude?: string[];
    limit?: number;
    filter?: FilterOptions;
  }) {
    const logs = args.filter ? this.storage.getAll(args.filter) : this.storage.getAll();

    const searchParams: KeywordSearchParams = {
      keywords: args.keywords,
      logic: args.logic,
      exclude: args.exclude,
      limit: args.limit,
    };

    const result = this.searchEngine.searchKeywords(logs, searchParams);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleTailLogs(args: {
    follow?: boolean;
    filter?: FilterOptions;
    lines?: number;
  }) {
    const lines = args.lines || 10;
    const allLogs = args.filter ? this.storage.getAll(args.filter) : this.storage.getAll();
    const recentLogs = allLogs.slice(-lines);

    // Note: This is a simplified implementation
    // In a real streaming scenario, we'd use MCP's sampling feature
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              logs: recentLogs,
              total: allLogs.length,
              message: 'Note: Real-time streaming requires MCP sampling support',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleGetTabs() {
    const tabs = this.wsServer.getTabs();
    const tabStats = tabs.map((tab) => ({
      ...tab,
      logCount: this.storage.getTabCount(tab.id),
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              tabs: tabStats,
              total: tabs.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleClearLogs(args: { tabId?: number; before?: string }) {
    this.storage.clear(args);
    return {
      content: [
        {
          type: 'text',
          text: 'Logs cleared successfully',
        },
      ],
    };
  }

  private async handleExportLogs(args: {
    format: 'json' | 'csv' | 'txt';
    filter?: FilterOptions;
    fields?: string[];
    prettyPrint?: boolean;
  }) {
    const logs = args.filter ? this.storage.getAll(args.filter) : this.storage.getAll();
    const exported = this.exportEngine.export(logs, args.format, {
      fields: args.fields as any,
      prettyPrint: args.prettyPrint,
    });

    return {
      content: [
        {
          type: 'text',
          text: exported,
        },
      ],
    };
  }

  private async handleSaveSession(args: {
    filter?: FilterOptions;
    name?: string;
  }) {
    const logs = args.filter ? this.storage.getAll(args.filter) : this.storage.getAll();
    const sessionId = this.sessionManager.save(logs, args.name);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ sessionId, logCount: logs.length }, null, 2),
        },
      ],
    };
  }

  private async handleLoadSession(args: { sessionId: string }) {
    const logs = this.sessionManager.load(args.sessionId);
    if (!logs) {
      throw new Error(`Session not found: ${args.sessionId}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ logs, total: logs.length }, null, 2),
        },
      ],
    };
  }

  private async handleListSessions() {
    const sessions = this.sessionManager.list();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ sessions, total: sessions.length }, null, 2),
        },
      ],
    };
  }

  private async handleGetStats() {
    const stats = {
      totalLogs: this.storage.getTotalCount(),
      activeTabs: this.storage.getAllTabs().length,
      wsConnections: this.wsServer.getConnectionCount(),
      sessions: this.sessionManager.getCount(),
      tabs: this.wsServer.getTabs().map((tab) => ({
        id: tab.id,
        url: tab.url,
        logCount: this.storage.getTabCount(tab.id),
      })),
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
