import type { FilterOptions, KeywordSearchParams, SearchParams } from 'console-logs-mcp-shared';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ExportEngine } from './export-engine.js';
import type { LogStorage } from './log-storage.js';
import { Sanitizer } from './sanitizer.js';
import { SearchEngine } from './search-engine.js';
import { SessionManager } from './session-manager.js';
import { TabSuggester, type SuggestionContext } from './tab-suggester.js';
import type { ConsoleWebSocketServer } from './websocket-server.js';

export class McpServer {
  private server: Server;
  private storage: LogStorage;
  private wsServer: ConsoleWebSocketServer;
  private searchEngine: SearchEngine;
  private sanitizer: Sanitizer;
  private exportEngine: ExportEngine;
  private sessionManager: SessionManager;
  private tabSuggester: TabSuggester;

  constructor(storage: LogStorage, wsServer: ConsoleWebSocketServer) {
    this.storage = storage;
    this.wsServer = wsServer;
    this.searchEngine = new SearchEngine();
    this.sanitizer = new Sanitizer();
    this.exportEngine = new ExportEngine();
    this.sessionManager = new SessionManager();
    this.tabSuggester = new TabSuggester();

    this.server = new Server(
      {
        name: 'console-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
          resources: {},
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
          name: 'console_tabs',
          description: 'List or intelligently suggest browser tabs to investigate.',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'suggest'],
                description: 'Whether to list all tabs or request ranked suggestions',
                default: 'list',
              },
              urlPatterns: {
                type: 'array',
                items: { type: 'string' },
                description: 'URL patterns to match when action = suggest',
              },
              workingDirectory: {
                type: 'string',
                description: 'Working directory for project context when action = suggest',
              },
              ports: {
                type: 'array',
                items: { type: 'number' },
                description: 'Expected ports when action = suggest',
              },
              domains: {
                type: 'array',
                items: { type: 'string' },
                description: 'Expected domains when action = suggest',
              },
              limit: {
                type: 'number',
                default: 5,
                description: 'Max suggestions to return',
              },
            },
          },
        },
        {
          name: 'console_logs',
          description:
            'Unified log access surface. List paginated logs, fetch a single log, or tail streaming logs.',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'get', 'tail'],
                default: 'list',
                description: 'Select list/get/tail behavior',
              },
              // list arguments
              levels: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['log', 'info', 'warn', 'error', 'debug'],
                },
                description: 'Log levels filter (list action)',
              },
              tabId: {
                type: 'number',
                description: 'Tab filter (list/tail actions)',
              },
              urlPattern: {
                type: 'string',
                description: 'URL regex filter (list/tail actions)',
              },
              after: {
                type: 'string',
                description: 'Relative/absolute start time (list action)',
              },
              before: {
                type: 'string',
                description: 'Relative/absolute end time (list action)',
              },
              limit: {
                type: 'number',
                default: 50,
                description: 'Page size for list action',
              },
              offset: {
                type: 'number',
                default: 0,
                description: 'Pagination offset for list action',
              },
              sanitize: {
                type: 'boolean',
                default: false,
                description: 'Mask sensitive data (list/get)',
              },
              includeArgs: {
                type: 'boolean',
                default: false,
                description: 'Include args array (list action)',
              },
              includeStack: {
                type: 'boolean',
                default: false,
                description: 'Include stack traces (list action)',
              },
              sessionScope: {
                type: 'string',
                enum: ['all', 'current'],
                default: 'all',
                description:
                  'Use "current" to limit results to the latest navigation/session for the selected tab (requires tabId).',
              },
              // get arguments
              logId: {
                type: 'string',
                description: 'Log ID when action = get',
              },
              // tail arguments
              follow: {
                type: 'boolean',
                default: true,
                description: 'Follow new logs when action = tail',
              },
              lines: {
                type: 'number',
                default: 10,
                description: 'Initial history count when action = tail',
              },
            },
          },
        },
        {
          name: 'console_search',
          description: 'Search console logs using regex or keyword logic.',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['regex', 'keywords'],
                description: 'Choose regex or keyword search mode',
                default: 'regex',
              },
              pattern: {
                type: 'string',
                description: 'Regex pattern when action = regex',
              },
              caseSensitive: {
                type: 'boolean',
                default: false,
                description: 'Case sensitive regex search',
              },
              fields: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['message', 'args', 'stack'],
                },
                default: ['message'],
                description: 'Fields to search (regex)',
              },
              contextLines: {
                type: 'number',
                default: 0,
                description: 'Context lines before/after match (regex)',
              },
              limit: {
                type: 'number',
                default: 50,
                description: 'Maximum results',
              },
              levels: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['log', 'info', 'warn', 'error', 'debug'],
                },
                description: 'Optional log-level filter',
              },
              tabId: {
                type: 'number',
                description: 'Target tab ID when scoping search',
              },
              urlPattern: {
                type: 'string',
                description: 'URL regex filter',
              },
              after: {
                type: 'string',
                description: 'Relative/absolute start time',
              },
              before: {
                type: 'string',
                description: 'Relative/absolute end time',
              },
              sessionScope: {
                type: 'string',
                enum: ['all', 'current'],
                default: 'all',
                description:
                  'Set to "current" to reuse only the latest navigation/session for the target tab (requires tabId).',
              },
              includeArgs: {
                type: 'boolean',
                default: false,
                description: 'Include args in matches',
              },
              includeStack: {
                type: 'boolean',
                default: false,
                description: 'Include stack traces in matches',
              },
              keywords: {
                type: 'array',
                items: { type: 'string' },
                description: 'Keyword array when action = keywords',
              },
              logic: {
                type: 'string',
                enum: ['AND', 'OR'],
                default: 'AND',
                description: 'Keyword logic',
              },
              exclude: {
                type: 'array',
                items: { type: 'string' },
                description: 'Words to exclude (keywords)',
              },
            },
          },
        },
        {
          name: 'console_sessions',
          description: 'Manage saved log sessions (save, load, list).',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['save', 'load', 'list'],
                default: 'list',
                description: 'Session action to perform',
              },
              filter: {
                type: 'object',
                description: 'Filters when saving sessions',
              },
              name: {
                type: 'string',
                description: 'Optional session name when saving',
              },
              description: {
                type: 'string',
                description: 'Optional session description when saving',
              },
              sessionId: {
                type: 'string',
                description: 'Session name/ID when loading',
              },
            },
          },
        },
        {
          name: 'console_browser_info',
          description: 'Get current page title/URL (and optional HTML) for a tab.',
          inputSchema: {
            type: 'object',
            properties: {
              tabId: {
                type: 'number',
                description: 'Target tab (defaults to active tab when omitted)',
              },
              includeHtml: {
                type: 'boolean',
                default: false,
                description: 'Include full HTML dump (use sparingly to save tokens)',
              },
            },
          },
        },
        {
          name: 'console_browser_execute',
          description: 'Run JavaScript in the page context or query DOM nodes.',
          inputSchema: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                enum: ['execute_js', 'query_dom'],
                default: 'execute_js',
                description: 'Select raw JS execution or DOM query mode',
              },
              code: {
                type: 'string',
                description: 'JavaScript snippet to execute when mode = execute_js',
              },
              selector: {
                type: 'string',
                description: 'CSS selector when mode = query_dom',
              },
              properties: {
                type: 'array',
                items: { type: 'string' },
                description: 'DOM properties to extract (query mode)',
              },
              tabId: {
                type: 'number',
                description: 'Target tab (defaults to active tab)',
              },
            },
          },
        },
        {
          name: 'console_snapshot',
          description: 'Quick digest of recent console activity (top errors, warnings, trends).',
          inputSchema: {
            type: 'object',
            properties: {
              window: {
                type: 'string',
                enum: ['1m', '5m', '15m'],
                default: '5m',
                description: 'Time window for snapshot (e.g., last 5 minutes)',
              },
              tabId: {
                type: 'number',
                description: 'Optional tab to scope the snapshot',
              },
              includeExamples: {
                type: 'boolean',
                default: false,
                description: 'Include sample log IDs/messages for each section',
              },
            },
          },
        },
      ],
    }));

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
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

**console_tabs** — action: list | suggest
- list: show all tabs with log counts.
- suggest: provide ranked suggestions using working directory, URL patterns, domains, or ports.
- Each tab entry includes sessionId, lastNavigationAt, and an isActive flag so you can prioritize the focused tab or most recent navigation.

**console_logs** — action: list | get | tail
- list: filter by level, tab, URL, or time window.
- get: fetch a single log by ID (include args/stack as needed).
- tail: stream the most recent logs with optional filters.
- Use sessionScope: "current" (with tabId) to focus on logs captured after the latest page refresh/navigation.

**console_search** — action: regex | keywords
- regex: search message/args/stack with regex + context lines.
- keywords: boolean keyword search with AND/OR/exclusions.

**console_sessions** — action: save | load | list
- save: capture current logs (optionally filtered) under a name/description.
- load: restore a saved session by ID or name.
- list: enumerate available sessions.

**console_browser_info**
- Return current page title/URL and optionally HTML for a specific or active tab.

**console_browser_execute** — mode: execute_js | query_dom
- execute_js: run JS in tab context (provide code + optional tabId).
- query_dom: extract DOM properties via CSS selectors.

**console_snapshot**
- Summarize recent activity (counts, error patterns) over the last 1/5/15 minutes, optionally scoped to a tab.

**Maintenance**
- Use the extension popup controls to clear logs or download exports directly (outside MCP tools).

**Tab Selection Strategy**
1. If the user's query is about a specific project/site, call console_tabs with action: "suggest".
   - Provide relevant urlPatterns/domains/ports based on the project (e.g., ["localhost"], ports: [3000, 5173]).
2. Review the ranked suggestions and choose the top-scoring tab.
3. Prefer results where isActive = true or lastNavigationAt is most recent when the user references "current tab".
4. If multiple tabs look similar, ask the user for clarification.
4. Use the chosen tabId in console_logs / console_search / console_browser_* calls.

**Common usage patterns**
- "show errors" → console_tabs(action: "suggest") → console_logs(action: "list", levels: ["error"], tabId: X)
- "from last X minutes" → console_logs(action: "list", after: "5m")
- "only the latest after refresh" → console_logs(action: "list", tabId: X, sessionScope: "current")
- "search for X" → console_search(action: "regex", pattern: "X", tabId: X)
- "save this investigation" → console_sessions(action: "save", name: "checkout-bug")
- "get current page HTML" → console_browser_info(includeHtml: true)
- "poke DOM" → console_browser_execute(mode: "query_dom", selector: ".error-message")
- "toggle feature flag" → console_browser_execute(mode: "execute_js", code: "window.flags.enableBeta()")
- "give me a quick status" → console_snapshot(window: "5m", includeExamples: true)

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
          case 'console_tabs':
            return await this.handleTabsTool(args as any);

          case 'console_logs':
            return await this.handleLogsTool(args as any);

          case 'console_search':
            return await this.handleSearchTool(args as any);

          case 'console_sessions':
            return await this.handleSessionsTool(args as any);

          case 'console_browser_info':
            return await this.handleBrowserInfoTool(args as any);

          case 'console_browser_execute':
            return await this.handleBrowserExecuteTool(args as any);

          case 'console_snapshot':
            return await this.handleSnapshotTool(args as any);

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
    includeArgs?: boolean;
    includeStack?: boolean;
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
    const limit = args.limit || 50;
    logs = logs.slice(offset, offset + limit);

    // Sanitize if requested
    if (args.sanitize) {
      logs = this.sanitizer.sanitizeMultiple(logs);
    }

    // By default, exclude args and stack (minimal response)
    // User can opt-in to include them
    logs = logs.map((log) => {
      const minimal: any = {
        id: log.id,
        timestamp: log.timestamp,
        level: log.level,
        message: log.message,
        tabId: log.tabId,
        url: log.url,
        sessionId: log.sessionId,
      };

      if (args.includeArgs && Array.isArray(log.args) && log.args.length > 0) {
        minimal.args = log.args;
      }

      if (args.includeStack && log.stack) {
        minimal.stack = log.stack;
      }

      return minimal;
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            logs,
            total,
            offset,
            limit,
            hasMore: offset + limit < total,
          }),
        },
      ],
    };
  }

  private async handleTabsTool(args: {
    action?: 'list' | 'suggest';
    urlPatterns?: string[];
    workingDirectory?: string;
    ports?: number[];
    domains?: string[];
    limit?: number;
  }) {
    const action = args?.action || 'list';

    if (action === 'suggest') {
      return this.handleSuggestTab({
        urlPatterns: args.urlPatterns,
        workingDirectory: args.workingDirectory,
        ports: args.ports,
        domains: args.domains,
        limit: args.limit,
      });
    }

    return this.handleGetTabs();
  }

  private async handleLogsTool(args: {
    action?: 'list' | 'get' | 'tail';
    levels?: string[];
    tabId?: number;
    urlPattern?: string;
    after?: string;
    before?: string;
    limit?: number;
    offset?: number;
    sanitize?: boolean;
    includeArgs?: boolean;
    includeStack?: boolean;
    logId?: string;
    follow?: boolean;
    filter?: FilterOptions;
    lines?: number;
    sessionScope?: 'all' | 'current';
  }) {
    const action = args?.action || 'list';
    const sessionScope = args?.sessionScope || 'all';

    if (action === 'get') {
      if (!args?.logId) {
        throw new Error('Missing logId for console_logs action=get');
      }
      return this.handleGetLog({ id: args.logId, sanitize: args.sanitize });
    }

    if (action === 'tail') {
      const baseFilter = this.buildFilterFromScopeArgs({
        levels: args.levels,
        tabId: args.tabId,
        urlPattern: args.urlPattern,
        after: args.after,
        before: args.before,
      });
      const resolvedFilter = this.applySessionScopeToFilter(baseFilter, sessionScope);
      return this.handleTailLogs({
        follow: args.follow,
        filter: resolvedFilter,
        lines: args.lines,
      });
    }

    return this.handleListLogs({
      levels: args.levels,
      tabId: args.tabId,
      urlPattern: args.urlPattern,
      after: args.after,
      before: args.before,
      sessionId: this.resolveSessionIdForScope(sessionScope, args.tabId),
      limit: args.limit,
      offset: args.offset,
      sanitize: args.sanitize,
      includeArgs: args.includeArgs,
      includeStack: args.includeStack,
    });
  }

  private async handleSearchTool(args: {
    action?: 'regex' | 'keywords';
    pattern?: string;
    caseSensitive?: boolean;
    fields?: Array<'message' | 'args' | 'stack'>;
    contextLines?: number;
    limit?: number;
    includeArgs?: boolean;
    includeStack?: boolean;
    keywords?: string[];
    logic?: 'AND' | 'OR';
    exclude?: string[];
    sessionScope?: 'all' | 'current';
    tabId?: number;
    levels?: string[];
    urlPattern?: string;
    after?: string;
    before?: string;
  }) {
    const action = args?.action || 'regex';
    const sessionScope = args?.sessionScope || 'all';
    const baseFilter = this.buildFilterFromScopeArgs({
      levels: args.levels,
      tabId: args.tabId,
      urlPattern: args.urlPattern,
      after: args.after,
      before: args.before,
    });
    const filter = this.applySessionScopeToFilter(baseFilter, sessionScope);

    if (action === 'keywords') {
      if (!args?.keywords || args.keywords.length === 0) {
        throw new Error('keywords array is required for console_search action=keywords');
      }
      return this.handleSearchKeywords({
        keywords: args.keywords,
        logic: args.logic,
        exclude: args.exclude,
        limit: args.limit,
        filter,
        includeArgs: args.includeArgs,
        includeStack: args.includeStack,
      });
    }

    if (!args?.pattern) {
      throw new Error('pattern is required for console_search action=regex');
    }

    return this.handleSearchLogs({
      pattern: args.pattern,
      caseSensitive: args.caseSensitive,
      fields: args.fields,
      contextLines: args.contextLines,
      limit: args.limit,
      filter,
      includeArgs: args.includeArgs,
      includeStack: args.includeStack,
    });
  }

  private async handleSessionsTool(args: {
    action?: 'save' | 'load' | 'list';
    filter?: FilterOptions;
    name?: string;
    description?: string;
    sessionId?: string;
  }) {
    const action = args?.action || 'list';

    if (action === 'save') {
      return this.handleSaveSession({
        filter: args.filter,
        name: args.name,
        description: args.description,
      });
    }

    if (action === 'load') {
      if (!args?.sessionId) {
        throw new Error('sessionId is required for console_sessions action=load');
      }
      return this.handleLoadSession({ sessionId: args.sessionId });
    }

    return this.handleListSessions();
  }

  private async handleBrowserInfoTool(args: { tabId?: number; includeHtml?: boolean }) {
    return this.handleGetPageInfo({
      tabId: args.tabId,
      includeHtml: args.includeHtml,
    });
  }

  private async handleBrowserExecuteTool(args: {
    mode?: 'execute_js' | 'query_dom';
    code?: string;
    tabId?: number;
    selector?: string;
    properties?: string[];
  }) {
    const mode = args?.mode || 'execute_js';

    if (mode === 'query_dom') {
      if (!args?.selector) {
        throw new Error('selector is required for console_browser_execute mode=query_dom');
      }
      return this.handleQueryDOM({
        selector: args.selector,
        tabId: args.tabId,
        properties: args.properties,
      } as any);
    }

    if (!args?.code) {
      throw new Error('code is required for console_browser_execute mode=execute_js');
    }
    return this.handleExecuteJS({ code: args.code, tabId: args.tabId });
  }

  private async handleSnapshotTool(args: {
    window?: '1m' | '5m' | '15m';
    tabId?: number;
    includeExamples?: boolean;
  }) {
    const windowMap: Record<'1m' | '5m' | '15m', number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
    };
    const windowKey = args.window || '5m';
    const windowMs = windowMap[windowKey];
    const since = Date.now() - windowMs;

    const baseFilter: FilterOptions = {
      tabId: args.tabId,
      after: new Date(since).toISOString(),
    };
    const recentLogs = this.storage.getAll(baseFilter);

    const summary = this.buildSnapshotSummary(recentLogs, since, {
      includeExamples: args.includeExamples,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }

  private resolveSessionIdForScope(sessionScope: 'all' | 'current', tabId?: number): string | undefined {
    if (sessionScope !== 'current') {
      return undefined;
    }

    if (tabId === undefined) {
      throw new Error('sessionScope "current" requires tabId to be specified.');
    }

    const latestSession = this.storage.getLatestSession(tabId);
    if (!latestSession) {
      throw new Error(
        `No session information available for tab ${tabId}. Trigger activity in the tab to capture logs first.`,
      );
    }
    return latestSession.sessionId;
  }

  private applySessionScopeToFilter(
    filter: FilterOptions | undefined,
    sessionScope: 'all' | 'current',
  ): FilterOptions | undefined {
    if (!filter) {
      if (sessionScope === 'current') {
        throw new Error('sessionScope "current" requires a tabId to scope the filter.');
      }
      return undefined;
    }

    if (sessionScope === 'all' || filter.sessionId) {
      return filter;
    }

    if (filter.tabId === undefined) {
      throw new Error('sessionScope "current" requires filter.tabId to be set.');
    }

    const latestSession = this.storage.getLatestSession(filter.tabId);
    if (!latestSession) {
      throw new Error(
        `No session information available for tab ${filter.tabId}. Trigger activity in the tab to capture logs first.`,
      );
    }

    return {
      ...filter,
      sessionId: latestSession.sessionId,
    };
  }

  private buildFilterFromScopeArgs(args: {
    levels?: string[];
    tabId?: number;
    urlPattern?: string;
    after?: string;
    before?: string;
  }): FilterOptions | undefined {
    if (
      args.levels === undefined &&
      args.tabId === undefined &&
      args.urlPattern === undefined &&
      args.after === undefined &&
      args.before === undefined
    ) {
      return undefined;
    }

    return {
      levels: args.levels as any,
      tabId: args.tabId,
      urlPattern: args.urlPattern,
      after: args.after,
      before: args.before,
    };
  }

  private buildSnapshotSummary(
    logs: any[],
    sinceTimestamp: number,
    options: { includeExamples?: boolean },
  ) {
    const windowMinutes = Math.max(1, Math.round((Date.now() - sinceTimestamp) / (60 * 1000)));

    const countsByLevel: Record<string, number> = {};
    const errorsByMessage = new Map<string, { count: number; samples: any[] }>();
    let newestLog: any | undefined;

    for (const log of logs) {
      countsByLevel[log.level] = (countsByLevel[log.level] || 0) + 1;

      if (log.level === 'error') {
        const key = log.message.slice(0, 200);
        if (!errorsByMessage.has(key)) {
          errorsByMessage.set(key, { count: 0, samples: [] });
        }
        const entry = errorsByMessage.get(key)!;
        entry.count += 1;
        if (options.includeExamples && entry.samples.length < 3) {
          entry.samples.push({ id: log.id, tabId: log.tabId, timestamp: log.timestamp });
        }
      }

      if (!newestLog || log.timestamp > newestLog.timestamp) {
        newestLog = log;
      }
    }

    const topErrors = Array.from(errorsByMessage.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([message, data]) => ({
        message,
        count: data.count,
        samples: options.includeExamples ? data.samples : undefined,
      }));

    return {
      windowMinutes,
      totalLogs: logs.length,
      countsByLevel,
      topErrors,
      latestLog:
        newestLog && options.includeExamples
          ? {
              id: newestLog.id,
              level: newestLog.level,
              message: newestLog.message,
              timestamp: newestLog.timestamp,
              tabId: newestLog.tabId,
            }
          : undefined,
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
    includeArgs?: boolean;
    includeStack?: boolean;
  }) {
    const logs = args.filter ? this.storage.getAll(args.filter) : this.storage.getAll();

    const searchParams: SearchParams = {
      pattern: args.pattern,
      caseSensitive: args.caseSensitive,
      fields: args.fields || ['message'],
      contextLines: args.contextLines,
      limit: args.limit,
    };

    const result = this.searchEngine.search(logs, searchParams);

    // Strip args/stack from results unless explicitly requested
    if (!args.includeArgs || !args.includeStack) {
      result.matches = result.matches.map((match) => ({
        ...match,
        log: this.stripLogFields(match.log, args.includeArgs, args.includeStack),
        context: match.context
          ? {
              before: match.context.before.map((log) =>
                this.stripLogFields(log, args.includeArgs, args.includeStack),
              ),
              after: match.context.after.map((log) =>
                this.stripLogFields(log, args.includeArgs, args.includeStack),
              ),
            }
          : undefined,
      }));
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result),
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
    includeArgs?: boolean;
    includeStack?: boolean;
  }) {
    const logs = args.filter ? this.storage.getAll(args.filter) : this.storage.getAll();

    const searchParams: KeywordSearchParams = {
      keywords: args.keywords,
      logic: args.logic,
      exclude: args.exclude,
      limit: args.limit,
    };

    const result = this.searchEngine.searchKeywords(logs, searchParams);

    // Strip args/stack from results unless explicitly requested
    if (!args.includeArgs || !args.includeStack) {
      result.matches = result.matches.map((match) => ({
        ...match,
        log: this.stripLogFields(match.log, args.includeArgs, args.includeStack),
        context: match.context
          ? {
              before: match.context.before.map((log) =>
                this.stripLogFields(log, args.includeArgs, args.includeStack),
              ),
              after: match.context.after.map((log) =>
                this.stripLogFields(log, args.includeArgs, args.includeStack),
              ),
            }
          : undefined,
      }));
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result),
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

  public clearLogs(filter?: { tabId?: number; before?: string }) {
    this.storage.clear(filter);
  }

  public exportLogsSnapshot(args: {
    format: 'json' | 'csv' | 'txt';
    filter?: FilterOptions;
    fields?: string[];
    prettyPrint?: boolean;
  }) {
    const logs = args.filter ? this.storage.getAll(args.filter) : this.storage.getAll();
    return this.exportEngine.export(logs, args.format, {
      fields: args.fields as any,
      prettyPrint: args.prettyPrint,
    });
  }

  public getStatsSnapshot() {
    return {
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
  }

  private async handleClearLogs(args: { tabId?: number; before?: string }) {
    this.clearLogs(args);
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
    const exported = this.exportLogsSnapshot(args);

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
    description?: string;
  }) {
    const logs = args.filter ? this.storage.getAll(args.filter) : this.storage.getAll();
    const sessionId = this.sessionManager.save(logs, args.name, args.description);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              sessionId,
              name: args.name,
              description: args.description,
              logCount: logs.length,
              message: args.name
                ? `Session saved as "${args.name}" (ID: ${sessionId})`
                : `Session saved with ID: ${sessionId}`,
            },
            null,
            2,
          ),
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
    const stats = this.getStatsSnapshot();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }

  private async handleSuggestTab(args: {
    urlPatterns?: string[];
    workingDirectory?: string;
    ports?: number[];
    domains?: string[];
    limit?: number;
  }) {
    const tabs = this.wsServer.getTabs();

    if (tabs.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                suggestions: [],
                message:
                  'No browser tabs currently connected. Make sure the Console MCP extension is installed and active.',
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const context: SuggestionContext = {
      urlPatterns: args.urlPatterns,
      workingDirectory: args.workingDirectory || process.cwd(),
      ports: args.ports,
      domains: args.domains,
    };

    const suggestions = this.tabSuggester.suggestTabs(
      tabs,
      (tabId) => this.storage.getAll({ tabId }),
      context,
    );

    const limit = args.limit || 5;
    const topSuggestions = suggestions.slice(0, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              suggestions: topSuggestions.map((s) => ({
                tabId: s.tab.id,
                url: s.tab.url,
                title: s.tab.title,
                isActive: s.tab.isActive,
                lastNavigationAt: s.tab.lastNavigationAt,
                score: s.score,
                reasons: s.reasons,
                logCount: s.logCount,
                lastActivity: s.lastActivity,
              })),
              total: suggestions.length,
              context: {
                workingDirectory: context.workingDirectory,
                appliedFilters: {
                  urlPatterns: args.urlPatterns,
                  ports: args.ports,
                  domains: args.domains,
                },
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private stripLogFields(log: any, includeArgs?: boolean, includeStack?: boolean): any {
    const minimal: any = {
      id: log.id,
      timestamp: log.timestamp,
      level: log.level,
      message: log.message,
      tabId: log.tabId,
      url: log.url,
      sessionId: log.sessionId,
    };

    if (includeArgs && Array.isArray(log.args) && log.args.length > 0) {
      minimal.args = log.args;
    }

    if (includeStack && log.stack) {
      minimal.stack = log.stack;
    }

    return minimal;
  }

  private async handleExecuteJS(args: { code: string; tabId?: number }) {
    try {
      const result = await this.wsServer.executeJS(args.code, args.tabId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                result,
                code: args.code,
                tabId: args.tabId,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to execute JavaScript: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleGetPageInfo(args: { tabId?: number; includeHtml?: boolean }) {
    try {
      const pageInfo = await this.wsServer.getPageInfo(args.tabId, args.includeHtml);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                title: pageInfo.title,
                url: pageInfo.url,
                html: pageInfo.html,
                tabId: args.tabId,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get page info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleQueryDOM(args: { selector: string; tabId?: number; properties?: string[] }) {
    try {
      const elements = await this.wsServer.queryDOM(args.selector, args.tabId, args.properties);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                selector: args.selector,
                elements,
                count: elements.length,
                tabId: args.tabId,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to query DOM: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
