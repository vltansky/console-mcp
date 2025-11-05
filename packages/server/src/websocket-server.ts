import { WebSocketServer, WebSocket } from 'ws';
import type {
  ExtensionMessage,
  ServerMessage,
  TabInfo,
} from '@console-mcp/shared';
import { ExtensionMessageSchema } from '@console-mcp/shared';
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

export class ConsoleWebSocketServer {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientInfo>();
  private tabs = new Map<number, TabInfo>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly storage: LogStorage;
  private readonly config: Required<WebSocketServerConfig>;

  constructor(storage: LogStorage, config: WebSocketServerConfig = {}) {
    this.storage = storage;
    this.config = {
      port: config.port ?? 3333,
      host: config.host ?? 'localhost',
      heartbeatInterval: config.heartbeatInterval ?? 30000,
    };

    this.wss = new WebSocketServer({
      port: this.config.port,
      host: this.config.host,
    });

    this.wss.on('connection', this.handleConnection);
    this.wss.on('error', (error) => {
      console.error('[WebSocket] Server error:', error);
    });

    this.startHeartbeat();

    console.log(
      `[WebSocket] Server listening on ${this.config.host}:${this.config.port}`,
    );
  }

  private handleConnection = (ws: WebSocket): void => {
    console.log('[WebSocket] Client connected');

    const clientInfo: ClientInfo = {
      ws,
      isAlive: true,
      lastHeartbeat: Date.now(),
    };
    this.clients.set(ws, clientInfo);

    ws.on('message', (data: Buffer) => {
      try {
        const rawMessage = JSON.parse(data.toString());
        const message = ExtensionMessageSchema.parse(rawMessage);
        this.handleMessage(message, clientInfo);
      } catch (error) {
        console.error('[WebSocket] Invalid message:', error);
      }
    });

    ws.on('pong', () => {
      clientInfo.isAlive = true;
      clientInfo.lastHeartbeat = Date.now();
    });

    ws.on('close', () => {
      console.log('[WebSocket] Client disconnected');
      this.clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('[WebSocket] Client error:', error);
    });
  };

  private handleMessage(message: ExtensionMessage, client: ClientInfo): void {
    switch (message.type) {
      case 'log':
        this.storage.add(message.data);
        break;

      case 'tab_opened':
        this.tabs.set(message.data.id, message.data);
        console.log(
          `[WebSocket] Tab opened: ${message.data.id} - ${message.data.url}`,
        );
        break;

      case 'tab_closed':
        this.tabs.delete(message.data.tabId);
        console.log(`[WebSocket] Tab closed: ${message.data.tabId}`);
        break;

      case 'heartbeat':
        client.lastHeartbeat = message.data.timestamp;
        client.isAlive = true;
        break;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [ws, client] of this.clients.entries()) {
        if (!client.isAlive) {
          console.log('[WebSocket] Terminating inactive client');
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }

        client.isAlive = false;
        ws.ping();

        // Send ping message
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

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.wss.close();
    console.log('[WebSocket] Server closed');
  }
}
