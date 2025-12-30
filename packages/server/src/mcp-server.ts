import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { FilterOptions, KeywordSearchParams, SearchParams } from 'console-bridge-shared';
import { ExportEngine } from './export-engine.js';
import type { LogStorage } from './log-storage.js';
import { type ProjectSkill, loadProjectSkills } from './project-skills.js';
import { Sanitizer } from './sanitizer.js';
import { SearchEngine } from './search-engine.js';
import { type SuggestionContext, TabSuggester } from './tab-suggester.js';
import type { ConsoleWebSocketServer } from './websocket-server.js';

export class McpServer {
  private server: Server;
  private storage: LogStorage;
  private wsServer: ConsoleWebSocketServer;
  private searchEngine: SearchEngine;
  private sanitizer: Sanitizer;
  private exportEngine: ExportEngine;
  private tabSuggester: TabSuggester;

  constructor(storage: LogStorage, wsServer: ConsoleWebSocketServer) {
    this.storage = storage;
    this.wsServer = wsServer;
    this.searchEngine = new SearchEngine();
    this.sanitizer = new Sanitizer();
    this.exportEngine = new ExportEngine();
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
                description:
                  'Deprecated: Sanitization is controlled by the extension. This parameter has no effect.',
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
          name: 'console_browser_execute',
          description:
            'Execute JavaScript in the page context. Has full access to page globals (window, document, etc).',
          inputSchema: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                description: 'JavaScript code to execute. Supports async/await.',
              },
              tabId: {
                type: 'number',
                description: 'Target tab (defaults to active tab)',
              },
            },
            required: ['code'],
          },
        },
        {
          name: 'console_browser_query',
          description: 'Query DOM elements by CSS selector and extract properties.',
          inputSchema: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector to query',
              },
              properties: {
                type: 'array',
                items: { type: 'string' },
                description: 'Properties to extract (default: textContent, className, id, tagName)',
              },
              tabId: {
                type: 'number',
                description: 'Target tab (defaults to active tab)',
              },
            },
            required: ['selector'],
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
        {
          name: 'console_skills_list',
          description:
            'List project-specific debugging skills discovered in `.console-bridge/` (without loading markdown bodies).',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to the project root (where `.console-bridge/` lives).',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'console_skills_load',
          description:
            'Load a single project skill by slug and return its full markdown body plus metadata.',
          inputSchema: {
            type: 'object',
            properties: {
              slug: {
                type: 'string',
                description: 'Required skill identifier (see console_skills_list)',
              },
              projectPath: {
                type: 'string',
                description: 'Absolute path to the project root (where `.console-bridge/` lives).',
              },
            },
            required: ['slug', 'projectPath'],
          },
        },
      ],
    }));

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [],
    }));
    this.server.setRequestHandler(ReadResourceRequestSchema, async () => {
      throw new Error('No resources are exposed. Use console_skills_list/load tools instead.');
    });

    // List available prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'use-console-mcp',
          description:
            'Quick shortcut to use Console MCP tools for querying browser console logs. Use this prompt to access console logs with filters, search, and analysis.',
        },
        {
          name: 'create-browser-skill',
          description:
            'Create a browser skill (project-specific debugging playbook) that teaches the AI assistant how to debug this specific project using console-bridge MCP tools.',
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

**console_browser_execute** — Run JavaScript in page context (full access to globals).

**console_browser_query** — Query DOM elements by CSS selector.

**console_snapshot**
- Summarize recent activity (counts, error patterns) over the last 1/5/15 minutes, optionally scoped to a tab.

**console_skills_list / console_skills_load**
- console_skills_list surfaces project-specific skills defined in .console-bridge/*.md.
- console_skills_load fetches the markdown body + metadata for a specific skill (use the id from the list response).

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
- "query DOM" → console_browser_query(selector: ".error-message")
- "toggle feature flag" → console_browser_execute(code: "window.flags.enableBeta()")
- "give me a quick status" → console_snapshot(window: "5m", includeExamples: true)

Use the appropriate Console MCP tools to help the user query and analyze their browser console logs.`,
              },
            },
          ],
        };
      }

      if (request.params.name === 'create-browser-skill') {
        return {
          description: 'Create a browser skill for project-specific debugging',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Create a browser skill (project-specific debugging playbook) that teaches the AI assistant how to debug this specific project using console-bridge MCP tools.

**What are browser skills?**
Markdown files stored in \`.console-bridge/\` that provide project-specific guidance for debugging workflows. They're automatically discovered and exposed via \`console_skills_list\` and \`console_skills_load\` MCP tools.

**File structure:**
- Directory: \`.console-bridge/\` (project root)
- Filename: \`{skill-name}.md\` (kebab-case)
- Format: Markdown with YAML front-matter

**Template:**
\`\`\`markdown
---
title: Skill Title
description: Brief description of what this skill teaches
---

# Skill Title

Detailed markdown content explaining:
- When to use this skill
- Step-by-step workflow
- Common patterns to look for
- Project-specific hints (ports, URLs, feature flags)
- Troubleshooting tips
\`\`\`

**Front-matter fields:**
- \`title\` (required): Human-readable skill name
- \`description\` (required): Brief summary for skill listings

**Available MCP tools for skills:**
| Tool | Description |
|------|-------------|
| \`console_tabs\` | List/suggest browser tabs |
| \`console_logs\` | Query logs (list/get/tail) |
| \`console_search\` | Search logs (regex/keywords) |
| \`console_browser_execute\` | Execute JavaScript in page |
| \`console_browser_query\` | Query DOM elements |
| \`console_snapshot\` | Get log statistics |

**Best practices:**
- Be specific: Include project-specific details (ports, URLs, feature flags)
- Provide context: Explain WHY, not just WHAT
- Keep focused: One skill per debugging scenario

**Workflow:**
1. Identify debugging scenario that needs a playbook
2. Create \`.console-bridge/{skill-name}.md\`
3. Write front-matter (title, description)
4. Write body content in markdown
5. Verify with \`console_skills_list\` (skill should appear)
6. Test with \`console_skills_load(slug: "{skill-name}")\`

Now, help me create a browser skill for this project.`,
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

          case 'console_browser_execute':
            return await this.handleExecuteJS(args as { code: string; tabId?: number });

          case 'console_browser_query':
            return await this.handleQueryDOM(
              args as { selector: string; tabId?: number; properties?: string[] },
            );

          case 'console_snapshot':
            return await this.handleSnapshotTool(args as any);

          case 'console_skills_list':
            return await this.handleSkillsListTool(args as any);

          case 'console_skills_load':
            return await this.handleSkillsLoadTool(args as any);

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

    // Sanitization is handled by the extension, not the server
    // This parameter is kept for backward compatibility but has no effect

    // Plain text format - much more token efficient
    const lines: string[] = [];

    // Header with metadata
    const firstLog = logs[0];
    const commonUrl = logs.every((l) => l.url === firstLog?.url) ? firstLog?.url : undefined;
    if (commonUrl) lines.push(`url: ${commonUrl}`);
    lines.push(`showing ${logs.length}/${total}${offset + limit < total ? ' (hasMore)' : ''}`);
    lines.push('---');

    // Log lines: [level] HH:MM:SS.mmm message (id)
    for (const log of logs) {
      const ts = new Date(log.timestamp);
      const time = `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}.${ts.getMilliseconds().toString().padStart(3, '0')}`;
      let line = `[${log.level}] ${time} ${log.message}`;

      if (args.includeArgs && Array.isArray(log.args) && log.args.length > 0) {
        line += ` | args: ${JSON.stringify(log.args)}`;
      }

      line += ` (${log.id})`;
      lines.push(line);

      if (args.includeStack && log.stack) {
        lines.push(`  ${log.stack.replace(/\n/g, '\n  ')}`);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n'),
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
      // Sanitization is handled by the extension
      return this.handleGetLog({ id: args.logId, sanitize: false });
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

    // Sanitization is handled by the extension
    return this.handleListLogs({
      levels: args.levels,
      tabId: args.tabId,
      urlPattern: args.urlPattern,
      after: args.after,
      before: args.before,
      sessionId: this.resolveSessionIdForScope(sessionScope, args.tabId),
      limit: args.limit,
      offset: args.offset,
      sanitize: false,
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

  private async handleSkillsListTool(args: { projectPath: string }) {
    const { skills, directory } = await loadProjectSkills({ directory: args.projectPath });
    if (!skills.length) {
      return this.buildSkillsMessage({
        total: 0,
        directory,
        message:
          'No project skills detected. Add markdown files to `.console-bridge/` (in the specified project path) to teach the agent about this project.',
      });
    }

    return this.buildSkillsMessage({
      total: skills.length,
      directory,
      skills: skills.map((skill) => this.serializeSkill(skill)),
    });
  }

  private async handleSkillsLoadTool(args: { slug: string; projectPath: string }) {
    const { skills, directory } = await loadProjectSkills({ directory: args.projectPath });
    const skill = skills.find((candidate) => candidate.id === args.slug);
    if (!skill) {
      throw new Error(`Unknown skill: ${args.slug}.`);
    }

    return this.buildSkillsMessage({
      directory,
      skill: this.serializeSkill(skill, { includeBody: true }),
    });
  }

  private resolveSessionIdForScope(
    sessionScope: 'all' | 'current',
    tabId?: number,
  ): string | undefined {
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
        const entry = errorsByMessage.get(key);
        if (!entry) continue;
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

  private serializeSkill(skill: ProjectSkill, options?: { includeBody?: boolean }) {
    return {
      id: skill.id,
      title: skill.title,
      description: skill.description,
      sourcePath: skill.sourcePath,
      body: options?.includeBody ? skill.body : undefined,
    };
  }

  private buildSkillsMessage(payload: Record<string, unknown>) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  private async handleGetLog(args: { id: string; sanitize?: boolean }) {
    const logs = this.storage.getAll();
    const log = logs.find((l) => l.id === args.id);

    if (!log) {
      throw new Error(`Log not found: ${args.id}`);
    }

    // Plain text for single log - full details
    const ts = new Date(log.timestamp);
    const time = `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}.${ts.getMilliseconds().toString().padStart(3, '0')}`;

    const lines: string[] = [
      `[${log.level}] ${time} ${log.message}`,
      `id: ${log.id}`,
      `url: ${log.url}`,
      `tab: ${log.tabId}`,
    ];

    if (log.args?.length) {
      lines.push(`args: ${JSON.stringify(log.args)}`);
    }
    if (log.stack) {
      lines.push(`stack:\n  ${log.stack.replace(/\n/g, '\n  ')}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: lines.join('\n'),
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

    // Plain text output
    const output = this.formatSearchResults(
      result,
      args.pattern,
      args.includeArgs,
      args.includeStack,
    );

    return {
      content: [
        {
          type: 'text',
          text: output,
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

    // Plain text output
    const query = `keywords: ${args.keywords.join(args.logic === 'OR' ? ' OR ' : ' AND ')}`;
    const output = this.formatSearchResults(result, query, args.includeArgs, args.includeStack);

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async handleTailLogs(args: {
    follow?: boolean;
    filter?: FilterOptions;
    lines?: number;
  }) {
    const lineCount = args.lines || 10;
    const allLogs = args.filter ? this.storage.getAll(args.filter) : this.storage.getAll();
    const recentLogs = allLogs.slice(-lineCount);

    // Plain text format
    const output: string[] = [`tail: last ${recentLogs.length} of ${allLogs.length}`, '---'];

    for (const log of recentLogs) {
      const ts = new Date(log.timestamp);
      const time = `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}.${ts.getMilliseconds().toString().padStart(3, '0')}`;
      output.push(`[${log.level}] ${time} ${log.message} (${log.id})`);
    }

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
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

    if (tabStats.length === 0) {
      return {
        content: [{ type: 'text', text: 'No browser tabs connected' }],
      };
    }

    // Plain text table format
    const lines = [`${tabStats.length} tabs connected`, '---'];
    for (const tab of tabStats) {
      const active = tab.isActive ? '*' : ' ';
      lines.push(`${active}[${tab.id}] ${tab.title || '(no title)'}`);
      lines.push(`  url: ${tab.url}`);
      lines.push(`  logs: ${tab.logCount}, session: ${tab.sessionId || 'none'}`);
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
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
            text: 'No browser tabs connected. Ensure Console MCP extension is installed and active.',
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

    // Plain text format
    const lines = [`${topSuggestions.length} suggestions (of ${suggestions.length} total)`, '---'];
    for (const s of topSuggestions) {
      const active = s.tab.isActive ? '*' : ' ';
      lines.push(`${active}[${s.tab.id}] score:${s.score} ${s.tab.title || '(no title)'}`);
      lines.push(`  url: ${s.tab.url}`);
      lines.push(`  logs: ${s.logCount}, reasons: ${s.reasons.join(', ')}`);
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  }

  private formatLogLine(
    log: {
      timestamp: string;
      level: string;
      message: string;
      id: string;
      args?: unknown[];
      stack?: string;
    },
    opts?: { includeArgs?: boolean; includeStack?: boolean; prefix?: string },
  ): string[] {
    const ts = new Date(log.timestamp);
    const time = `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}.${ts.getMilliseconds().toString().padStart(3, '0')}`;
    const prefix = opts?.prefix ?? '';

    let line = `${prefix}[${log.level}] ${time} ${log.message}`;
    if (opts?.includeArgs && Array.isArray(log.args) && log.args.length > 0) {
      line += ` | args: ${JSON.stringify(log.args)}`;
    }
    line += ` (${log.id})`;

    const lines = [line];
    if (opts?.includeStack && log.stack) {
      lines.push(`${prefix}  ${log.stack.replace(/\n/g, `\n${prefix}  `)}`);
    }
    return lines;
  }

  private formatSearchResults(
    result: {
      matches: Array<{ log: any; matchedText: string; context?: { before: any[]; after: any[] } }>;
      total: number;
    },
    query: string,
    includeArgs?: boolean,
    includeStack?: boolean,
  ): string {
    const lines: string[] = [`search: ${query}`, `found: ${result.total} matches`, '---'];

    for (const match of result.matches) {
      // Context before
      if (match.context?.before.length) {
        for (const ctx of match.context.before) {
          lines.push(...this.formatLogLine(ctx, { prefix: '  ' }));
        }
      }

      // Matched log (highlighted with >)
      lines.push(...this.formatLogLine(match.log, { prefix: '> ', includeArgs, includeStack }));

      // Context after
      if (match.context?.after.length) {
        for (const ctx of match.context.after) {
          lines.push(...this.formatLogLine(ctx, { prefix: '  ' }));
        }
      }

      lines.push(''); // blank line between matches
    }

    return lines.join('\n');
  }

  private async handleExecuteJS(args: { code: string; tabId?: number }) {
    const result = await this.wsServer.executeJS(args.code, args.tabId);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
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
      throw new Error(
        `Failed to query DOM: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
