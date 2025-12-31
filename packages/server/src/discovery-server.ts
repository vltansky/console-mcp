import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import {
  CONSOLE_MCP_IDENTIFIER,
  type FilterOptions,
  type NetworkFilterOptions,
} from 'console-bridge-shared';
import type { LogStorage } from './log-storage.js';
import type { NetworkStorage } from './network-storage.js';
import type { ConsoleWebSocketServer } from './websocket-server.js';

export interface DiscoveryConfig {
  wsHost: string;
  wsPort: number;
  discoveryPort?: number;
  identifier?: string;
  serverId?: string;
}

export interface DiscoveryServer {
  listen: () => void;
  close: () => void;
}

export interface MaintenanceHandlers {
  getStats?: () => any;
  clearLogs?: (args: { tabId?: number; before?: string }) => any;
  exportLogs?: (args: {
    format: 'json' | 'csv' | 'txt';
    filter?: FilterOptions;
    fields?: string[];
    prettyPrint?: boolean;
  }) => any;
}

// Extended handlers for bridge mode - allows MCP clients to query data
export interface BridgeHandlers {
  storage: LogStorage;
  networkStorage: NetworkStorage;
  wsServer: ConsoleWebSocketServer;
}

export function createDiscoveryServer(
  config: DiscoveryConfig,
  maintenanceHandlers?: MaintenanceHandlers,
  bridgeHandlers?: BridgeHandlers,
): DiscoveryServer {
  const DISCOVERY_PORT = config.discoveryPort ?? 3332;
  const identifier = config.identifier ?? CONSOLE_MCP_IDENTIFIER;
  const serverId = config.serverId ?? randomUUID();

  const readBody = (req: IncomingMessage): Promise<any> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve(data);
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
    });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    (async () => {
      // Basic CORS for extensions
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/discover') {
        const payload = {
          identifier,
          serverId,
          wsPort: config.wsPort,
          wsHost: config.wsHost,
          wsUrl: `ws://${config.wsHost}:${config.wsPort}`,
          timestamp: Date.now(),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/maintenance/stats') {
        if (!maintenanceHandlers?.getStats) {
          res.writeHead(503);
          res.end('Maintenance handler unavailable');
          return;
        }
        const stats = maintenanceHandlers.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/maintenance/clear') {
        if (!maintenanceHandlers?.clearLogs) {
          res.writeHead(503);
          res.end('Maintenance handler unavailable');
          return;
        }
        const body = await readBody(req);
        maintenanceHandlers.clearLogs(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'cleared' }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/maintenance/export') {
        if (!maintenanceHandlers?.exportLogs) {
          res.writeHead(503);
          res.end('Maintenance handler unavailable');
          return;
        }
        const body = await readBody(req);
        if (!body.format) {
          res.writeHead(400);
          res.end('Missing format');
          return;
        }
        const data = maintenanceHandlers.exportLogs(body);
        const contentType =
          body.format === 'json'
            ? 'application/json'
            : body.format === 'csv'
              ? 'text/csv'
              : 'text/plain';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
        return;
      }

      // ─────────────────────────────────────────────────────────────
      // Bridge API endpoints for MCP clients
      // ─────────────────────────────────────────────────────────────

      if (bridgeHandlers) {
        const { storage, networkStorage, wsServer } = bridgeHandlers;

        // GET /api/logs - Query logs with filters
        if (req.method === 'POST' && url.pathname === '/api/logs') {
          const body = await readBody(req);
          const logs = storage.getAll(body.filter);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ logs, count: logs.length }));
          return;
        }

        // GET /api/network - Query network entries with filters
        if (req.method === 'POST' && url.pathname === '/api/network') {
          const body = await readBody(req);
          let entries;
          if (body.action === 'slow') {
            entries = networkStorage.getSlow(body.minDuration ?? 300, body.filter);
          } else if (body.action === 'errors') {
            entries = networkStorage.getErrors(body.filter);
          } else {
            entries = networkStorage.getAll(body.filter);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ entries, count: entries.length }));
          return;
        }

        // GET /api/tabs - Get connected tabs
        if (req.method === 'GET' && url.pathname === '/api/tabs') {
          const tabs = wsServer.getTabs();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tabs, connectionCount: wsServer.getConnectionCount() }));
          return;
        }

        // POST /api/execute - Execute JS in browser
        if (req.method === 'POST' && url.pathname === '/api/execute') {
          const body = await readBody(req);
          try {
            const result = await wsServer.executeJS(body.code, body.tabId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result }));
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
          return;
        }

        // POST /api/query-dom - Query DOM elements
        if (req.method === 'POST' && url.pathname === '/api/query-dom') {
          const body = await readBody(req);
          try {
            const elements = await wsServer.queryDOM(body.selector, body.tabId, body.properties);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ elements }));
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
          return;
        }

        // POST /api/snapshot - Get DOM snapshot
        if (req.method === 'POST' && url.pathname === '/api/snapshot') {
          const body = await readBody(req);
          try {
            const snapshot = await wsServer.getDomSnapshot(body.tabId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ snapshot }));
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
          return;
        }

        // POST /api/search - Search logs
        if (req.method === 'POST' && url.pathname === '/api/search') {
          const body = await readBody(req);
          // Import search engine dynamically to avoid circular deps
          const { SearchEngine } = await import('./search-engine.js');
          const searchEngine = new SearchEngine();
          const allLogs = storage.getAll(body.filter);
          const results =
            body.action === 'keywords'
              ? searchEngine.keywordSearch(allLogs, body.keywords ?? [], {
                  logic: body.logic,
                  exclude: body.exclude,
                })
              : searchEngine.regexSearch(allLogs, body.pattern ?? '', {
                  caseSensitive: body.caseSensitive,
                  fields: body.fields,
                  contextLines: body.contextLines,
                });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ results, count: results.length }));
          return;
        }
      }

      res.writeHead(404);
      res.end();
    })().catch((error) => {
      res.writeHead(500);
      res.end((error as Error).message);
    });
  });

  return {
    listen: () => {
      server.listen(DISCOVERY_PORT, 'localhost', () => {
        // Log to stderr to avoid interfering with MCP stdio
        process.stderr.write(
          `[Discovery] Listening on http://localhost:${DISCOVERY_PORT}/discover -> ws://${config.wsHost}:${config.wsPort} (id: ${serverId})\n`,
        );
      });
      server.on('error', (error) => {
        process.stderr.write(`[Discovery] Server error: ${(error as Error).message}\n`);
      });
    },
    close: () => {
      server.close();
    },
  };
}
