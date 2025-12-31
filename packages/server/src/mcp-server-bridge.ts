/**
 * Bridge MCP Server
 *
 * MCP server that communicates with the bridge server via HTTP.
 * Enables multiple MCP instances to share the same bridge.
 */

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
import type { FilterOptions, InitiatorType, NetworkFilterOptions } from 'console-bridge-shared';
import type { BridgeClient } from './bridge-client.js';
import { type ProjectSkill, loadProjectSkills } from './project-skills.js';
import { type SuggestionContext, TabSuggester } from './tab-suggester.js';

interface TabsToolArgs {
  action?: 'list' | 'suggest';
  urlPatterns?: string[];
  workingDirectory?: string;
  ports?: number[];
  domains?: string[];
  limit?: number;
}

interface LogsToolArgs {
  action?: 'list' | 'get' | 'tail';
  levels?: string[];
  tabId?: number;
  urlPattern?: string;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
  includeArgs?: boolean;
  includeStack?: boolean;
  logId?: string;
  lines?: number;
  sessionScope?: 'all' | 'current';
}

interface SearchToolArgs {
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
}

interface NetworkToolArgs {
  action?: 'list' | 'slow' | 'errors';
  tabId?: number;
  urlPattern?: string;
  initiatorTypes?: InitiatorType[];
  minDuration?: number;
  limit?: number;
  offset?: number;
  sessionScope?: 'all' | 'current';
  after?: string;
  before?: string;
}

export class BridgeMcpServer {
  private server: Server;
  private bridgeClient: BridgeClient;
  private tabSuggester: TabSuggester;

  constructor(bridgeClient: BridgeClient) {
    this.bridgeClient = bridgeClient;
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
    // List available tools - same as original
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
                default: 'list',
              },
              urlPatterns: { type: 'array', items: { type: 'string' } },
              workingDirectory: { type: 'string' },
              ports: { type: 'array', items: { type: 'number' } },
              domains: { type: 'array', items: { type: 'string' } },
              limit: { type: 'number', default: 5 },
            },
          },
        },
        {
          name: 'console_logs',
          description: 'Unified log access surface. List paginated logs, fetch a single log, or tail streaming logs.',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'get', 'tail'], default: 'list' },
              levels: { type: 'array', items: { type: 'string', enum: ['log', 'info', 'warn', 'error', 'debug'] } },
              tabId: { type: 'number' },
              urlPattern: { type: 'string' },
              after: { type: 'string' },
              before: { type: 'string' },
              limit: { type: 'number', default: 50 },
              offset: { type: 'number', default: 0 },
              includeArgs: { type: 'boolean', default: false },
              includeStack: { type: 'boolean', default: false },
              sessionScope: { type: 'string', enum: ['all', 'current'], default: 'all' },
              logId: { type: 'string' },
              lines: { type: 'number', default: 10 },
            },
          },
        },
        {
          name: 'console_search',
          description: 'Search console logs using regex or keyword logic.',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['regex', 'keywords'], default: 'regex' },
              pattern: { type: 'string' },
              caseSensitive: { type: 'boolean', default: false },
              fields: { type: 'array', items: { type: 'string', enum: ['message', 'args', 'stack'] }, default: ['message'] },
              contextLines: { type: 'number', default: 0 },
              limit: { type: 'number', default: 50 },
              levels: { type: 'array', items: { type: 'string' } },
              tabId: { type: 'number' },
              urlPattern: { type: 'string' },
              after: { type: 'string' },
              before: { type: 'string' },
              sessionScope: { type: 'string', enum: ['all', 'current'], default: 'all' },
              includeArgs: { type: 'boolean', default: false },
              includeStack: { type: 'boolean', default: false },
              keywords: { type: 'array', items: { type: 'string' } },
              logic: { type: 'string', enum: ['AND', 'OR'], default: 'AND' },
              exclude: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        {
          name: 'console_browser_execute',
          description: 'Execute JavaScript in the page context.',
          inputSchema: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              tabId: { type: 'number' },
            },
            required: ['code'],
          },
        },
        {
          name: 'console_browser_query',
          description: 'Query DOM elements by CSS selector.',
          inputSchema: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              properties: { type: 'array', items: { type: 'string' } },
              tabId: { type: 'number' },
            },
            required: ['selector'],
          },
        },
        {
          name: 'console_dom_snapshot',
          description: 'Capture DOM snapshot of the current page.',
          inputSchema: {
            type: 'object',
            properties: {
              tabId: { type: 'number' },
            },
          },
        },
        {
          name: 'console_skills_list',
          description: 'List project-specific debugging skills.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string' },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'console_skills_load',
          description: 'Load a single project skill by slug.',
          inputSchema: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              projectPath: { type: 'string' },
            },
            required: ['slug', 'projectPath'],
          },
        },
        {
          name: 'console_network',
          description: 'Query network performance entries.',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['list', 'slow', 'errors'], default: 'list' },
              tabId: { type: 'number' },
              urlPattern: { type: 'string' },
              initiatorTypes: { type: 'array', items: { type: 'string' } },
              minDuration: { type: 'number', default: 300 },
              limit: { type: 'number', default: 50 },
              offset: { type: 'number', default: 0 },
              after: { type: 'string' },
              before: { type: 'string' },
              sessionScope: { type: 'string', enum: ['all', 'current'], default: 'all' },
            },
          },
        },
      ],
    }));

    // Resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
    this.server.setRequestHandler(ReadResourceRequestSchema, async () => {
      throw new Error('No resources are exposed.');
    });

    // Prompts - same as original
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        { name: 'use-console-mcp', description: 'Quick shortcut to use Console MCP tools.' },
        { name: 'create-browser-skill', description: 'Create a browser skill.' },
      ],
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name === 'use-console-mcp') {
        return {
          description: 'Use Console MCP to query browser console logs',
          messages: [{ role: 'user', content: { type: 'text', text: 'Use Console MCP tools to query browser console logs.' } }],
        };
      }
      if (request.params.name === 'create-browser-skill') {
        return {
          description: 'Create a browser skill',
          messages: [{ role: 'user', content: { type: 'text', text: 'Create a browser skill for project-specific debugging.' } }],
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
            return await this.handleTabsTool(args as TabsToolArgs);
          case 'console_logs':
            return await this.handleLogsTool(args as LogsToolArgs);
          case 'console_search':
            return await this.handleSearchTool(args as SearchToolArgs);
          case 'console_browser_execute':
            return await this.handleExecuteJS(args as { code: string; tabId?: number });
          case 'console_browser_query':
            return await this.handleQueryDOM(args as { selector: string; tabId?: number; properties?: string[] });
          case 'console_dom_snapshot':
            return await this.handleDomSnapshot(args as { tabId?: number });
          case 'console_skills_list':
            return await this.handleSkillsList(args as { projectPath: string });
          case 'console_skills_load':
            return await this.handleSkillsLoad(args as { slug: string; projectPath: string });
          case 'console_network':
            return await this.handleNetworkTool(args as NetworkToolArgs);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    });
  }

  private async handleTabsTool(args: TabsToolArgs) {
    const action = args?.action || 'list';
    const { tabs, connectionCount } = await this.bridgeClient.getTabs();

    if (action === 'suggest') {
      if (tabs.length === 0) {
        return { content: [{ type: 'text', text: 'No browser tabs connected.' }] };
      }

      // Get logs for tab suggestion scoring
      const context: SuggestionContext = {
        urlPatterns: args.urlPatterns,
        workingDirectory: args.workingDirectory || process.cwd(),
        ports: args.ports,
        domains: args.domains,
      };

      // For suggestion, we need logs - fetch from bridge
      const { logs } = await this.bridgeClient.getLogs();
      const getLogsForTab = (tabId: number) => logs.filter((l) => l.tabId === tabId);

      const suggestions = this.tabSuggester.suggestTabs(tabs, getLogsForTab, context);
      const limit = args.limit || 5;
      const topSuggestions = suggestions.slice(0, limit);

      const lines = [`${topSuggestions.length} suggestions (of ${suggestions.length} total)`, '---'];
      for (const s of topSuggestions) {
        const active = s.tab.isActive ? '*' : ' ';
        lines.push(`${active}[${s.tab.id}] score:${s.score} ${s.tab.title || '(no title)'}`);
        lines.push(`  url: ${s.tab.url}`);
        lines.push(`  logs: ${s.logCount}, reasons: ${s.reasons.join(', ')}`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // List mode
    if (tabs.length === 0) {
      return { content: [{ type: 'text', text: 'No browser tabs connected' }] };
    }

    const lines = [`${tabs.length} tabs connected`, '---'];
    for (const tab of tabs) {
      const active = tab.isActive ? '*' : ' ';
      lines.push(`${active}[${tab.id}] ${tab.title || '(no title)'}`);
      lines.push(`  url: ${tab.url}`);
      lines.push(`  session: ${tab.sessionId || 'none'}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  private async handleLogsTool(args: LogsToolArgs) {
    const action = args?.action || 'list';

    const filter: FilterOptions = {
      levels: args.levels as any,
      tabId: args.tabId,
      urlPattern: args.urlPattern,
      after: args.after,
      before: args.before,
    };

    const { logs, count } = await this.bridgeClient.getLogs(filter);
    const total = count;

    if (action === 'get' && args.logId) {
      const log = logs.find((l) => l.id === args.logId);
      if (!log) throw new Error(`Log not found: ${args.logId}`);

      const ts = new Date(log.timestamp);
      const time = this.formatTime(ts);
      const lines = [
        `[${log.level}] ${time} ${log.message}`,
        `id: ${log.id}`,
        `url: ${log.url}`,
        `tab: ${log.tabId}`,
      ];
      if (log.args?.length) lines.push(`args: ${JSON.stringify(log.args)}`);
      if (log.stack) lines.push(`stack:\n  ${log.stack.replace(/\n/g, '\n  ')}`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (action === 'tail') {
      const lineCount = args.lines || 10;
      const recentLogs = logs.slice(-lineCount);
      const output = [`tail: last ${recentLogs.length} of ${total}`, '---'];
      for (const log of recentLogs) {
        const ts = new Date(log.timestamp);
        output.push(`[${log.level}] ${this.formatTime(ts)} ${log.message} (${log.id})`);
      }
      return { content: [{ type: 'text', text: output.join('\n') }] };
    }

    // List mode
    const offset = args.offset || 0;
    const limit = args.limit || 50;
    const paginated = logs.slice(offset, offset + limit);

    const lines: string[] = [];
    lines.push(`showing ${paginated.length}/${total}${offset + limit < total ? ' (hasMore)' : ''}`);
    lines.push('---');

    for (const log of paginated) {
      const ts = new Date(log.timestamp);
      let line = `[${log.level}] ${this.formatTime(ts)} ${log.message}`;
      if (args.includeArgs && log.args?.length) line += ` | args: ${JSON.stringify(log.args)}`;
      line += ` (${log.id})`;
      lines.push(line);
      if (args.includeStack && log.stack) lines.push(`  ${log.stack.replace(/\n/g, '\n  ')}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  private async handleSearchTool(args: SearchToolArgs) {
    const action = args?.action || 'regex';

    const filter: FilterOptions = {
      levels: args.levels as any,
      tabId: args.tabId,
      urlPattern: args.urlPattern,
      after: args.after,
      before: args.before,
    };

    const { results, count } = await this.bridgeClient.searchLogs({
      action,
      pattern: args.pattern,
      keywords: args.keywords,
      filter,
      caseSensitive: args.caseSensitive,
      fields: args.fields,
      contextLines: args.contextLines,
      logic: args.logic,
      exclude: args.exclude,
    });

    const query = action === 'keywords' ? `keywords: ${args.keywords?.join(' ')}` : args.pattern || '';
    const lines = [`search: ${query}`, `found: ${count} matches`, '---'];

    for (const log of results.slice(0, args.limit || 50)) {
      const ts = new Date(log.timestamp);
      let line = `> [${log.level}] ${this.formatTime(ts)} ${log.message}`;
      if (args.includeArgs && log.args?.length) line += ` | args: ${JSON.stringify(log.args)}`;
      line += ` (${log.id})`;
      lines.push(line);
      if (args.includeStack && log.stack) lines.push(`  ${log.stack.replace(/\n/g, '\n  ')}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  private async handleExecuteJS(args: { code: string; tabId?: number }) {
    const result = await this.bridgeClient.executeJS(args.code, args.tabId);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private async handleQueryDOM(args: { selector: string; tabId?: number; properties?: string[] }) {
    const elements = await this.bridgeClient.queryDOM(args.selector, args.tabId, args.properties);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ selector: args.selector, elements, count: elements.length }, null, 2),
      }],
    };
  }

  private async handleDomSnapshot(args: { tabId?: number }) {
    const snapshot = await this.bridgeClient.getDomSnapshot(args.tabId);
    return { content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }] };
  }

  private async handleSkillsList(args: { projectPath: string }) {
    const { skills, directory } = await loadProjectSkills({ directory: args.projectPath });
    if (!skills.length) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ total: 0, directory, message: 'No project skills detected.' }, null, 2),
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          total: skills.length,
          directory,
          skills: skills.map((s) => ({ id: s.id, title: s.title, description: s.description })),
        }, null, 2),
      }],
    };
  }

  private async handleSkillsLoad(args: { slug: string; projectPath: string }) {
    const { skills, directory } = await loadProjectSkills({ directory: args.projectPath });
    const skill = skills.find((s) => s.id === args.slug);
    if (!skill) throw new Error(`Unknown skill: ${args.slug}`);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          directory,
          skill: { id: skill.id, title: skill.title, description: skill.description, body: skill.body },
        }, null, 2),
      }],
    };
  }

  private async handleNetworkTool(args: NetworkToolArgs) {
    const action = args.action || 'list';

    const filter: NetworkFilterOptions = {
      tabId: args.tabId,
      urlPattern: args.urlPattern,
      initiatorTypes: args.initiatorTypes,
      after: args.after,
      before: args.before,
    };

    const { entries, count } = await this.bridgeClient.getNetwork({
      action,
      filter,
      minDuration: args.minDuration,
    });

    const total = count;
    const offset = args.offset || 0;
    const limit = args.limit || 50;
    const paginated = entries.slice(offset, offset + limit);

    const lines: string[] = [];
    lines.push(`network entries: ${paginated.length}/${total}${offset + limit < total ? ' (hasMore)' : ''}`);
    lines.push(`action: ${action}${action === 'slow' ? ` (>${args.minDuration || 300}ms)` : ''}`);
    lines.push('---');

    for (const entry of paginated) {
      const ts = new Date(entry.timestamp);
      const time = this.formatTime(ts);
      const status = entry.status ? `[${entry.status}]` : '';
      const error = entry.isError ? ' ERR' : '';
      const cached = entry.cached ? ' (cached)' : '';
      const size = entry.size ? ` ${Math.round(entry.size / 1024)}KB` : '';

      lines.push(`${time} ${entry.initiatorType.padEnd(6)} ${entry.duration.toString().padStart(5)}ms${status}${error}${cached}${size}`);
      lines.push(`  ${entry.url}`);

      const timingParts: string[] = [];
      if (entry.dnsTime) timingParts.push(`dns:${entry.dnsTime}ms`);
      if (entry.connectionTime) timingParts.push(`conn:${entry.connectionTime}ms`);
      if (entry.tlsTime) timingParts.push(`tls:${entry.tlsTime}ms`);
      if (entry.ttfb) timingParts.push(`ttfb:${entry.ttfb}ms`);
      if (entry.downloadTime) timingParts.push(`dl:${entry.downloadTime}ms`);
      if (entry.stallTime && entry.stallTime > 0) timingParts.push(`stall:${entry.stallTime}ms`);

      if (timingParts.length > 0) {
        lines.push(`  timing: ${timingParts.join(' | ')}`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  private formatTime(ts: Date): string {
    return `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}.${ts.getMilliseconds().toString().padStart(3, '0')}`;
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
