import type { ExtensionMessage, ServerMessage, TabInfo, BrowserCommandResponse } from 'console-logs-mcp-shared';
import { ExtensionMessageSchema, BrowserCommandResponseSchema } from 'console-logs-mcp-shared';
import { WebSocket, WebSocketServer } from 'ws';
import type { LogStorage } from './log-storage.js';

export interface WebSocketServerConfig {
  port?: number;
  host?: string;
  heartbeatInterval?: number;
}

interface ClientInfo {
  ws: WebSocket;
  isAlive: boolean;
  lastHeartbeat: number;
}

interface PendingCommand {
  resolve: (response: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class ConsoleWebSocketServer {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientInfo>();
  private tabs = new Map<number, TabInfo>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly storage: LogStorage;
  private readonly config: Required<WebSocketServerConfig>;
  private pendingCommands = new Map<string, PendingCommand>(); // requestId -> pending command

  constructor(storage: LogStorage, config: WebSocketServerConfig = {}) {
    this.storage = storage;
    this.config = {
      port: config.port ?? 9847,
      host: config.host ?? 'localhost',
      heartbeatInterval: config.heartbeatInterval ?? 30000,
    };

    this.wss = new WebSocketServer({
      port: this.config.port,
      host: this.config.host,
    });

    this.wss.on('connection', this.handleConnection);
    this.wss.on('error', (error) => {
      // Log to stderr to avoid interfering with MCP stdio
      process.stderr.write(`[WebSocket Server] Error: ${error.message}\n`);
    });

    this.wss.on('listening', () => {
      process.stderr.write(
        `[WebSocket Server] Listening on ws://${this.config.host}:${this.config.port}\n`,
      );
    });

    this.startHeartbeat();
  }

  private handleConnection = (ws: WebSocket): void => {
    const clientInfo: ClientInfo = {
      ws,
      isAlive: true,
      lastHeartbeat: Date.now(),
    };
    this.clients.set(ws, clientInfo);
    process.stderr.write(`[WebSocket Server] New client connected (total: ${this.clients.size})\n`);

    ws.on('message', (data: Buffer) => {
      try {
        const rawMessage = JSON.parse(data.toString());

        // Try to parse as extension message first
        try {
          const message = ExtensionMessageSchema.parse(rawMessage);
          this.handleMessage(message, clientInfo);
          return;
        } catch {
          // Not an extension message, try browser command response
        }

        // Try to parse as browser command response
        try {
          const response = BrowserCommandResponseSchema.parse(rawMessage);
          this.handleCommandResponse(response);
          return;
        } catch {
          // Not a command response either
        }

        throw new Error('Unknown message type');
      } catch (error) {
        // Log validation errors to help debug
        if (error instanceof Error) {
          process.stderr.write(`[WebSocket Server] Message validation error: ${error.message}\n`);
          process.stderr.write(`[WebSocket Server] Raw message: ${data.toString().substring(0, 200)}\n`);
        }
      }
    });

    ws.on('pong', () => {
      clientInfo.isAlive = true;
      clientInfo.lastHeartbeat = Date.now();
    });

    ws.on('close', () => {
      process.stderr.write(`[WebSocket Server] Client disconnected (remaining: ${this.clients.size - 1})\n`);
      this.clients.delete(ws);
    });

    ws.on('error', (_error) => {
      // Silently handle client errors
    });
  };

  private handleMessage(message: ExtensionMessage, client: ClientInfo): void {
    switch (message.type) {
      case 'log':
        this.storage.add(message.data);
        process.stderr.write(`[WebSocket Server] Received log: ${message.data.level} from tab ${message.data.tabId}\n`);
        break;

      case 'tab_opened':
        this.tabs.set(message.data.id, message.data);
        break;

      case 'tab_updated':
        this.tabs.set(message.data.id, message.data);
        break;

      case 'tab_closed':
        this.tabs.delete(message.data.tabId);
        break;

      case 'heartbeat':
        client.lastHeartbeat = message.data.timestamp;
        client.isAlive = true;
        break;
    }
  }

  private handleCommandResponse(response: BrowserCommandResponse): void {
    const requestId = response.data.requestId;
    const pending = this.pendingCommands.get(requestId);

    if (!pending) {
      process.stderr.write(`[WebSocket Server] Received response for unknown request: ${requestId}\n`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingCommands.delete(requestId);

    switch (response.type) {
      case 'execute_js_response':
        if (response.data.error) {
          pending.reject(new Error(response.data.error));
        } else {
          pending.resolve(response.data.result);
        }
        break;

      case 'page_info_response':
        if (response.data.error) {
          pending.reject(new Error(response.data.error));
        } else {
          pending.resolve({
            title: response.data.title,
            url: response.data.url,
            html: response.data.html,
          });
        }
        break;

      case 'query_dom_response':
        if (response.data.error) {
          pending.reject(new Error(response.data.error));
        } else {
          pending.resolve(response.data.elements);
        }
        break;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [ws, client] of this.clients.entries()) {
        if (!client.isAlive) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }

        client.isAlive = false;
        ws.ping();

        const message: ServerMessage = {
          type: 'ping',
          data: { timestamp: now },
        };
        this.send(ws, message);
      }
    }, this.config.heartbeatInterval);
  }

  send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcast(message: ServerMessage): void {
    for (const { ws } of this.clients.values()) {
      this.send(ws, message);
    }
  }

  getTabs(): TabInfo[] {
    return Array.from(this.tabs.values());
  }

  getTab(tabId: number): TabInfo | undefined {
    return this.tabs.get(tabId);
  }

  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Execute JavaScript code in browser tab
   */
  async executeJS(code: string, tabId?: number): Promise<unknown> {
    if (this.clients.size === 0) {
      throw new Error('No browser clients connected');
    }

    const requestId = crypto.randomUUID();
    const message: ServerMessage = {
      type: 'execute_js',
      data: { requestId, code, tabId },
    };

    return this.sendCommand(message, requestId);
  }

  /**
   * Get page information (title, URL, optionally HTML)
   */
  async getPageInfo(tabId?: number, includeHtml?: boolean): Promise<{ title: string; url: string; html?: string }> {
    if (this.clients.size === 0) {
      throw new Error('No browser clients connected');
    }

    const requestId = crypto.randomUUID();
    const message: ServerMessage = {
      type: 'get_page_info',
      data: { requestId, tabId, includeHtml },
    };

    return this.sendCommand(message, requestId);
  }

  /**
   * Query DOM elements using CSS selector
   */
  async queryDOM(selector: string, tabId?: number, properties?: string[]): Promise<Array<{ selector: string; properties: Record<string, unknown> }>> {
    if (this.clients.size === 0) {
      throw new Error('No browser clients connected');
    }

    const requestId = crypto.randomUUID();
    const message: ServerMessage = {
      type: 'query_dom',
      data: { requestId, selector, tabId, properties },
    };

    return this.sendCommand(message, requestId);
  }

  /**
   * Send command to browser and wait for response
   */
  private sendCommand<T>(message: ServerMessage, requestId: string, timeout = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      this.pendingCommands.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      // Broadcast to all clients (extension will route to correct tab)
      this.broadcast(message);
    });
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Clear all pending commands
    for (const [requestId, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('WebSocket server closing'));
    }
    this.pendingCommands.clear();

    this.wss.close();
  }
}
